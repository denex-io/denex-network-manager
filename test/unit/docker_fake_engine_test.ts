import { assert, assertEquals, assertRejects } from '@std/assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { DockerClient } from '../../src/docker/client.ts';

// A fake Docker Engine API on a loopback TCP port. It speaks just enough of
// the protocol (inspect, logs, exec create/start/inspect) to exercise the real
// DockerClient + dockerode + docker-modem stack without a daemon.

const enc = new TextEncoder();

function frame(type: 1 | 2 | 3, text: string): Buffer {
  const payload = Buffer.from(enc.encode(text));
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

interface Engine {
  tty: boolean;
  /** Handles GET /containers/:id/logs. */
  logs: (req: IncomingMessage, res: ServerResponse) => void;
  /** Handles the hijacked exec start (101 upgrade). */
  execUpgrade: ((req: IncomingMessage, socket: Socket) => void) | null;
  /** Handles a plain (non-upgrade) POST /exec/:id/start. */
  execStart: (req: IncomingMessage, res: ServerResponse) => void;
  /** Successive GET /exec/:id/json bodies; the last one repeats. */
  execInspect: Record<string, unknown>[];
  execInspectCalls: number;
  sockets: Set<Socket>;
}

interface Running {
  engine: Engine;
  client: DockerClient;
  close: () => Promise<void>;
}

async function startEngine(overrides: Partial<Engine> = {}): Promise<Running> {
  const engine: Engine = {
    tty: false,
    logs: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
      res.end();
    },
    execUpgrade: null,
    execStart: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
      res.end();
    },
    execInspect: [{ Running: false, ExitCode: 0 }],
    execInspectCalls: 0,
    sockets: new Set(),
    ...overrides,
  };

  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '').replace(/^\/v[\d.]+/, '');
    const path = url.split('?')[0];
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && /^\/containers\/[^/]+\/json$/.test(path)) {
      return json(200, { Id: 'c1', Config: { Tty: engine.tty } });
    }
    if (req.method === 'GET' && /^\/containers\/[^/]+\/logs$/.test(path)) {
      return engine.logs(req, res);
    }
    if (req.method === 'POST' && /^\/containers\/[^/]+\/exec$/.test(path)) {
      req.resume();
      return json(201, { Id: 'exec1' });
    }
    if (req.method === 'POST' && /^\/exec\/[^/]+\/start$/.test(path)) {
      req.resume();
      return engine.execStart(req, res);
    }
    if (req.method === 'GET' && /^\/exec\/[^/]+\/json$/.test(path)) {
      const i = Math.min(engine.execInspectCalls++, engine.execInspect.length - 1);
      return json(200, engine.execInspect[i]);
    }
    json(404, { message: `unexpected ${req.method} ${url}` });
  });
  server.on('connection', (s) => {
    engine.sockets.add(s);
    s.on('close', () => engine.sockets.delete(s));
  });
  // Without an 'upgrade' listener Node serves upgrade requests as plain ones,
  // which is how a daemon that ignores the Upgrade header behaves.
  const upgradeHandler = engine.execUpgrade;
  if (upgradeHandler) {
    server.on('upgrade', (req, socket) => {
      socket.write(
        'HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.multiplexed-stream\r\n' +
          'Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
      );
      upgradeHandler(req, socket as Socket);
    });
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const client = new DockerClient({ dockerOptions: { host: '127.0.0.1', port } });
  return {
    engine,
    client,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of engine.sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function eventually(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > ms) return reject(new Error('condition not met in time'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  name: 'fake engine - logs follow:false returns clean text from framed output (#22)',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      logs: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        res.end(Buffer.concat([frame(1, 'line one\n'), frame(2, 'line two\n')]));
      },
    });
    try {
      const text = await readAll(await client.getContainerLogs('c1', { follow: false }));
      assertEquals(text, 'line one\nline two\n');
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - logs follow:true demuxes frames split across writes',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      logs: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        const data = Buffer.concat([frame(1, 'alpha\n'), frame(2, 'beta\n'), frame(1, 'gamma\n')]);
        const cuts = [3, 11, 20, 27];
        let prev = 0;
        for (const cut of [...cuts, data.length]) {
          res.write(data.subarray(prev, cut));
          prev = cut;
        }
        res.end();
      },
    });
    try {
      const text = await readAll(await client.getContainerLogs('c1', { follow: true }));
      assertEquals(text, 'alpha\nbeta\ngamma\n');
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - logs on a TTY container are passed through unchanged',
  ...opts,
  async fn() {
    for (const follow of [false, true]) {
      const { client, close } = await startEngine({
        tty: true,
        logs: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' });
          res.end('plain tty output\r\nsecond\r\n');
        },
      });
      try {
        const text = await readAll(await client.getContainerLogs('c1', { follow }));
        assertEquals(text, 'plain tty output\r\nsecond\r\n', `follow=${follow}`);
      } finally {
        await close();
      }
    }
  },
});

Deno.test({
  name:
    'fake engine - cancelling a followed log closes the connection and does not crash on a late write',
  ...opts,
  async fn() {
    let serverRes: ServerResponse | undefined;
    let clientGone = false;
    const { client, close } = await startEngine({
      logs: (_req, res) => {
        serverRes = res;
        res.on('close', () => clientGone = true);
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        res.write(frame(1, 'first\n'));
      },
    });
    try {
      const stream = await client.getContainerLogs('c1', { follow: true });
      const reader = stream.getReader();
      const first = await reader.read();
      assertEquals(new TextDecoder().decode(first.value), 'first\n');
      await reader.cancel();
      await eventually(() => clientGone);
      // Late frames after cancel must not raise an uncaught error.
      serverRes?.write(frame(1, 'late\n'));
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - exec over a 101 upgrade returns clean stdout, stderr and exit code (#23)',
  ...opts,
  async fn() {
    const { client, close, engine } = await startEngine({
      execUpgrade: (_req, socket) => {
        socket.write(Buffer.concat([frame(1, 'out\n'), frame(2, 'err\n')]));
        socket.end();
      },
      execInspect: [{ Running: false, ExitCode: 3 }],
    });
    try {
      const result = await client.execInContainer('c1', ['sh', '-c', 'x']);
      assertEquals(result, { exitCode: 3, output: 'out\nerr\n', stdout: 'out\n', stderr: 'err\n' });
      assertEquals(engine.execInspectCalls, 1);
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - exec over a non-upgrade 200 response is demultiplexed',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      execStart: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        res.end(frame(1, 'hello world\n'));
      },
    });
    try {
      const result = await client.execInContainer('c1', ['echo', 'hello world']);
      assertEquals(result.output, 'hello world\n');
      assertEquals(result.exitCode, 0);
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - exec settles when the server closes the socket after the output',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      execUpgrade: (_req, socket) => {
        socket.write(frame(1, 'done\n'));
        setTimeout(() => socket.destroy(), 20);
      },
    });
    try {
      const result = await client.execInContainer('c1', ['true']);
      assertEquals(result.output, 'done\n');
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - exec retries inspect while Running or ExitCode is null',
  ...opts,
  async fn() {
    const { client, close, engine } = await startEngine({
      execUpgrade: (_req, socket) => {
        socket.write(frame(1, 'x'));
        socket.end();
      },
      execInspect: [
        { Running: true, ExitCode: null },
        { Running: false, ExitCode: null },
        { Running: false, ExitCode: 3 },
      ],
    });
    try {
      const result = await client.execInContainer('c1', ['sh']);
      assertEquals(result.exitCode, 3);
      assertEquals(engine.execInspectCalls, 3);
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - exec surfaces output truncated mid-frame',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      execUpgrade: (_req, socket) => {
        socket.write(frame(1, 'complete\n'));
        socket.write(frame(1, 'cut off').subarray(0, 12));
        socket.end();
      },
    });
    try {
      const err = await assertRejects(() => client.execInContainer('c1', ['sh']));
      assert(String(err).includes('truncated'));
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - exec settles on a stream that closes without emitting end',
  ...opts,
  async fn() {
    const client = new DockerClient();
    const stream = new PassThrough();
    const stub = {
      getContainer: () => ({
        exec: () =>
          Promise.resolve({
            start: () => Promise.resolve(stream),
            inspect: () => Promise.resolve({ Running: false, ExitCode: 0 }),
          }),
      }),
    };
    (client as unknown as { docker: unknown }).docker = stub;
    const pending = client.execInContainer('c1', ['true']);
    await new Promise((r) => setTimeout(r, 10));
    stream.write(frame(1, 'done\n'));
    // destroy() emits 'close' but never 'end'.
    stream.destroy();
    const result = await pending;
    assertEquals(result.output, 'done\n');
    assertEquals(result.exitCode, 0);
  },
});

Deno.test({
  name: 'fake engine - logs follow:true errors on a truncated frame at end',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      logs: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        res.write(frame(1, 'whole\n'));
        res.end(frame(1, 'cut off').subarray(0, 12));
      },
    });
    try {
      const err = await assertRejects(async () =>
        await readAll(await client.getContainerLogs('c1', { follow: true }))
      );
      assert(String(err).includes('truncated'), String(err));
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - logs follow:true errors when the connection closes before end',
  ...opts,
  async fn() {
    const { client, close } = await startEngine({
      logs: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        res.write(frame(1, 'whole\n'));
        setTimeout(() => res.socket?.resetAndDestroy(), 20);
      },
    });
    try {
      const err = await assertRejects(async () =>
        await readAll(await client.getContainerLogs('c1', { follow: true }))
      );
      assert(err instanceof Error);
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - logs follow:true pauses the socket while the consumer is not reading',
  ...opts,
  async fn() {
    let serverRes: ServerResponse | undefined;
    let backpressured = false;
    const { client, close } = await startEngine({
      logs: (_req, res) => {
        serverRes = res;
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
        res.flushHeaders();
      },
    });
    try {
      const stream = await client.getContainerLogs('c1', { follow: true });
      await eventually(() => serverRes !== undefined);
      const chunk = frame(1, 'x'.repeat(16 * 1024));
      // Nobody reads the stream: once the client pauses, the server's writes back up.
      for (let i = 0; i < 4000 && !backpressured; i++) {
        if (!serverRes!.write(chunk)) {
          backpressured = true;
        } else if (i % 50 === 49) {
          await new Promise((r) => setTimeout(r, 5));
        }
      }
      assert(backpressured, 'server never saw backpressure from the client');
      await stream.cancel();
    } finally {
      await close();
    }
  },
});

Deno.test({
  name: 'fake engine - logs report a daemon error frame (type 3) instead of passing it as output',
  ...opts,
  async fn() {
    for (const follow of [false, true]) {
      const { client, close } = await startEngine({
        logs: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/vnd.docker.multiplexed-stream' });
          res.end(Buffer.concat([frame(1, 'ok\n'), frame(3, 'Error grabbing logs: boom\n')]));
        },
      });
      try {
        const err = await assertRejects(async () =>
          await readAll(await client.getContainerLogs('c1', { follow }))
        );
        assert(
          String(err).includes('error from daemon in stream: Error grabbing logs: boom'),
          `follow=${follow}: ${err}`,
        );
      } finally {
        await close();
      }
    }
  },
});
