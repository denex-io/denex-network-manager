import { assert, assertEquals, assertRejects } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { NetworkManager } from '../../src/docker/network.ts';
import type { DockerClient } from '../../src/docker/client.ts';
import type {
  ContainerInfo,
  ContainerSpec,
  NetworkInfo,
  VolumeInfo,
} from '../../src/docker/types.ts';
import { parseLocalNetConfig } from '../../src/schemas/localnet-config.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';

// Fake-Docker tests for start() rollback. The dedicated basePort keeps these
// clear of the integration ranges (see agents/testing.md).
const BASE_PORT = 41000;
const ID = 'rbtest';
const VOLUME = `${ID}-postgres-data`;

const LAYER_1 = [`${ID}-postgres`];
const LAYER_2 = [`${ID}-canton`, `${ID}-keycloak`];
const LAYER_3 = [`${ID}-splice`];
const LAYER_4 = [
  `${ID}-wallet-web-ui-sv`,
  `${ID}-wallet-web-ui-validator-1`,
  `${ID}-sv-web-ui`,
  `${ID}-scan-web-ui`,
];
const LAYER_5 = [`${ID}-nginx`];
const ALL_NAMES = [...LAYER_1, ...LAYER_2, ...LAYER_3, ...LAYER_4, ...LAYER_5];

const MUTATING = [
  'createNetwork',
  'removeNetwork',
  'createVolume',
  'removeVolume',
  'createContainer',
  'startContainer',
  'stopContainer',
  'removeContainer',
];

type FakeState = 'running' | 'exited' | 'created' | 'paused' | 'restarting';

/** Records every Docker call; only the methods start() touches are implemented. */
class FakeDockerClient {
  calls: string[] = [];
  containers = new Map<string, { id: string; state: FakeState; created?: number }>();
  networkExists = false;
  volumeExists = false;
  failStart = new Set<string>();
  /** Like failStart, but only the first start of each name fails. */
  failStartOnce = new Set<string>();
  failCreate = new Set<string>();
  /** createContainer for these names rejects with an HTTP 409 name conflict. */
  conflictCreate = new Set<string>();
  /** findContainer rejects with this error for these names (a transient inspect failure). */
  inspectError = new Map<string, Error>();
  findNetworkError: Error | null = null;
  findVolumeError: Error | null = null;
  /** These containers are not running right after startContainer returns. */
  exitsAfterStart = new Set<string>();
  /** stopContainer for these names waits on the given promise before finishing. */
  stopGate = new Map<string, Promise<void>>();
  /** createContainer for these names waits on the given promise. */
  latch = new Map<string, Promise<void>>();
  private configJson = '';

  constructor(private labelPrefix: string) {}

  setConfig(json: string) {
    this.configJson = json;
  }

  /** Mutating calls only, as "method:arg". */
  get mutations(): string[] {
    return this.calls.filter((c) => MUTATING.some((m) => c.startsWith(`${m}:`)));
  }

  seedExisting(names: string[], state: FakeState = 'exited') {
    for (const n of names) this.containers.set(n, { id: `old-${n}`, state });
    this.networkExists = true;
    this.volumeExists = true;
  }

  private info(
    name: string,
    c: { id: string; state: FakeState; created?: number },
  ): ContainerInfo {
    return {
      id: c.id,
      created: c.created,
      name,
      state: c.state,
      status: c.state,
      image: 'img',
      ports: [],
      health: c.state === 'running' ? 'healthy' : 'none',
      labels: {
        [`${this.labelPrefix}.instance`]: ID,
        [`${this.labelPrefix}.config`]: this.configJson,
      },
    };
  }

  private find(idOrName: string) {
    for (const [name, c] of this.containers) {
      if (name === idOrName || c.id === idOrName) return { name, c };
    }
    return null;
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  listContainers(): Promise<ContainerInfo[]> {
    return Promise.resolve([...this.containers].map(([n, c]) => this.info(n, c)));
  }

  getContainerInfo(idOrName: string): Promise<ContainerInfo | null> {
    const f = this.find(idOrName);
    return Promise.resolve(f ? this.info(f.name, f.c) : null);
  }

  findContainer(idOrName: string): Promise<ContainerInfo | null> {
    const err = this.inspectError.get(idOrName);
    if (err) return Promise.reject(err);
    return this.getContainerInfo(idOrName);
  }

  imageExists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  pullImage(): Promise<void> {
    return Promise.resolve();
  }

  async createContainer(spec: ContainerSpec): Promise<string> {
    const gate = this.latch.get(spec.name);
    if (gate) await gate;
    if (this.failCreate.has(spec.name)) throw new Error(`create failed: ${spec.name}`);
    if (this.conflictCreate.has(spec.name)) {
      throw Object.assign(new Error('name conflict'), { statusCode: 409 });
    }
    const id = `new-${spec.name}`;
    this.containers.set(spec.name, { id, state: 'exited' });
    this.calls.push(`createContainer:${spec.name}`);
    return id;
  }

  startContainer(idOrName: string): Promise<void> {
    const f = this.find(idOrName);
    if (f && (this.failStart.has(f.name) || this.failStartOnce.delete(f.name))) {
      // Not a mutation: recorded so tests can split calls before and after a failure.
      this.calls.push(`startFailed:${idOrName}`);
      return Promise.reject(new Error(`start failed: ${f.name}`));
    }
    // Docker counts a container in restart backoff as running: a start is a 304 no-op.
    if (f && f.c.state !== 'restarting') {
      f.c.state = this.exitsAfterStart.has(f.name) ? 'exited' : 'running';
    }
    this.calls.push(`startContainer:${idOrName}`);
    return Promise.resolve();
  }

  async stopContainer(idOrName: string): Promise<void> {
    const f = this.find(idOrName);
    if (f) f.c.state = 'exited';
    this.calls.push(`stopContainer:${idOrName}`);
    const gate = f ? this.stopGate.get(f.name) : undefined;
    if (gate) await gate;
    this.calls.push(`stopDone:${idOrName}`);
  }

  removeContainer(idOrName: string): Promise<void> {
    const f = this.find(idOrName);
    if (f) this.containers.delete(f.name);
    this.calls.push(`removeContainer:${idOrName}`);
    return Promise.resolve();
  }

  findNetwork(name: string): Promise<NetworkInfo | null> {
    if (this.findNetworkError) return Promise.reject(this.findNetworkError);
    return Promise.resolve(
      this.networkExists
        ? { id: `net-${name}`, name, driver: 'bridge', scope: 'local', containers: [] }
        : null,
    );
  }

  getNetworkInfo(name: string): Promise<NetworkInfo | null> {
    return this.findNetwork(name).catch(() => null);
  }

  createNetwork(name: string): Promise<string> {
    this.networkExists = true;
    this.calls.push(`createNetwork:${name}`);
    return Promise.resolve(`net-${name}`);
  }

  removeNetwork(name: string): Promise<void> {
    this.networkExists = false;
    this.calls.push(`removeNetwork:${name}`);
    return Promise.resolve();
  }

  findVolume(name: string): Promise<VolumeInfo | null> {
    if (this.findVolumeError) return Promise.reject(this.findVolumeError);
    return Promise.resolve(
      this.volumeExists ? { name, driver: 'local', mountpoint: '/x' } : null,
    );
  }

  createVolume(name: string): Promise<string> {
    this.volumeExists = true;
    this.calls.push(`createVolume:${name}`);
    return Promise.resolve(name);
  }

  removeVolume(name: string): Promise<void> {
    this.volumeExists = false;
    this.calls.push(`removeVolume:${name}`);
    return Promise.resolve();
  }

  listVolumes(): Promise<VolumeInfo[]> {
    return Promise.resolve([]);
  }
}

async function withFakeNet(
  fn: (net: LocalNet, fake: FakeDockerClient) => Promise<void>,
): Promise<void> {
  // Keycloak bootstrap-admin cleanup runs after a successful start; never let
  // it reach a real server.
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('fetch is stubbed in this test'));
  try {
    const config = createMinimalConfig(1);
    config.basePort = BASE_PORT;
    const net = await LocalNet.fromConfig(config, { instanceId: ID });
    const prefix = net.getOptions().labelPrefix;
    const fake = new FakeDockerClient(prefix);
    fake.setConfig(JSON.stringify(parseLocalNetConfig(net.getConfig())));
    const client = fake as unknown as DockerClient;
    Reflect.set(net, 'client', client);
    Reflect.set(net, 'networkManager', new NetworkManager(client, { prefix }));
    await fn(net, fake);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const START = { skipHealthChecks: true, skipInitialization: true } as const;

Deno.test('start rollback - failed resume (timeout) removes and stops nothing', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    await assertRejects(() => net.start({ ...START, timeout: -1 }), Error, 'Startup timeout');
    assertEquals(fake.mutations, []);
    assertEquals(fake.containers.size, ALL_NAMES.length);
    assert(fake.networkExists && fake.volumeExists);
  });
});

Deno.test('start rollback - failure in a later layer stops resumed containers, removes nothing', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    assertEquals(fake.mutations.filter((m) => m.startsWith('remove')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('create')), []);
    // The container whose start call failed is recorded first, so it is stopped too.
    const stops = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    assertEquals(
      stops.sort(),
      [...LAYER_1, ...LAYER_2, ...LAYER_3].map((n) => `stopContainer:old-${n}`).sort(),
    );
    for (const n of ALL_NAMES) assert(fake.containers.has(n), `${n} must still exist`);
    assert(fake.networkExists && fake.volumeExists);
    assertEquals(net.currentState, 'stopped');
  });
});

Deno.test('start rollback - failed fresh start removes containers, network and volume', async () => {
  await withFakeNet(async (net, fake) => {
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    assertEquals(fake.containers.size, 0);
    assertEquals(fake.networkExists, false);
    assertEquals(fake.volumeExists, false);
    assert(fake.mutations.some((m) => m.startsWith('createNetwork:')));
    assert(fake.mutations.includes(`removeVolume:${VOLUME}`));
    assertEquals(net.getContainerId(`${ID}-postgres`), undefined);
  });
});

Deno.test('start rollback - existing network and volume without containers are kept', async () => {
  await withFakeNet(async (net, fake) => {
    fake.networkExists = true;
    fake.volumeExists = true;
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    assertEquals(fake.containers.size, 0);
    assert(fake.networkExists && fake.volumeExists);
    assertEquals(fake.mutations.filter((m) => m.startsWith('createNetwork')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('createVolume')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('removeNetwork')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('removeVolume')), []);
  });
});

Deno.test('start rollback - a failing sibling never races a still-creating one', async () => {
  await withFakeNet(async (net, fake) => {
    let release!: () => void;
    // Both are in layer 4: the failing create must wait for the latched one.
    fake.latch.set(`${ID}-sv-web-ui`, new Promise<void>((r) => (release = r)));
    fake.failCreate.add(`${ID}-scan-web-ui`);
    setTimeout(() => release(), 50);

    await assertRejects(() => net.start(START), Error, 'create failed');

    // The latched sibling finished its create before rollback began, so it was
    // removed with everything else and nothing was created after a removal.
    assertEquals(fake.containers.size, 0);
    const firstRemoval = fake.mutations.findIndex((m) => m.startsWith('removeContainer:'));
    assert(firstRemoval >= 0);
    const late = fake.mutations.slice(firstRemoval).filter((m) =>
      m.startsWith('createContainer:') || m.startsWith('startContainer:')
    );
    assertEquals(late, []);
    assert(fake.mutations.includes(`removeContainer:new-${ID}-sv-web-ui`));
  });
});

Deno.test('start rollback - a non-404 inspect error removes no network or volume', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.findNetworkError = new Error('docker daemon exploded');
    await assertRejects(() => net.start(START), Error, 'docker daemon exploded');
    assertEquals(fake.mutations, []);
    assert(fake.networkExists && fake.volumeExists);
  });
});

Deno.test('start rollback - stops finish layer by layer, dependents before dependencies', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.failStart.add(`${ID}-splice`);
    // Splice (layer 3) takes a while to stop; no earlier layer may begin
    // stopping until it has finished.
    let release!: () => void;
    fake.stopGate.set(`${ID}-splice`, new Promise<void>((r) => (release = r)));
    setTimeout(() => release(), 50);

    await assertRejects(() => net.start(START), Error, 'start failed');

    const events = fake.calls.filter((c) => c.startsWith('stop'));
    const at = (e: string) => events.indexOf(e);
    const spliceDone = at(`stopDone:old-${ID}-splice`);
    assert(spliceDone >= 0);
    for (const n of LAYER_2) assert(at(`stopContainer:old-${n}`) > spliceDone);
    const layer2Done = Math.max(...LAYER_2.map((n) => at(`stopDone:old-${n}`)));
    assert(at(`stopContainer:old-${ID}-postgres`) > layer2Done);
  });
});

Deno.test('start rollback - a failed health wait stops resumed containers, removes nothing', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.exitsAfterStart.add(`${ID}-canton`);
    await assertRejects(
      () => net.start({ skipInitialization: true }),
      Error,
      `${ID}-canton`,
    );

    assertEquals(fake.mutations.filter((m) => m.startsWith('remove')), []);
    const stops = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    assertEquals(
      stops.sort(),
      [...LAYER_1, ...LAYER_2].map((n) => `stopContainer:old-${n}`).sort(),
    );
    for (const n of ALL_NAMES) assert(fake.containers.has(n), `${n} must still exist`);
    assert(fake.networkExists && fake.volumeExists);
    assertEquals(net.currentState, 'stopped');
  });
});

Deno.test('start rollback - a non-404 volume lookup error removes only the network this call created', async () => {
  await withFakeNet(async (net, fake) => {
    fake.findVolumeError = new Error('volume lookup exploded');
    await assertRejects(() => net.start(START), Error, 'volume lookup exploded');

    assertEquals(fake.mutations, [
      `createNetwork:denex.localnet-${ID}`,
      `removeNetwork:denex.localnet-${ID}`,
    ]);
    assertEquals(fake.networkExists, false);
  });
});

// Repair of partially running instances.

const ALL_BUT = (...skip: string[]) => ALL_NAMES.filter((n) => !skip.includes(n));
const WEB_UIS = LAYER_4;

Deno.test('start repair - all containers running: no mutations', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    await net.start(START);
    assertEquals(fake.mutations, []);
    assertEquals(net.currentState, 'running');
  });
});

Deno.test('start repair - splice exited: splice is started and its dependents restart', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    fake.containers.get(`${ID}-splice`)!.state = 'exited';
    await net.start(START);

    const start = fake.mutations.filter((m) => m.startsWith('startContainer:'));
    assertEquals(
      start.sort(),
      [...LAYER_3, ...LAYER_4, ...LAYER_5].map((n) => `startContainer:old-${n}`).sort(),
    );
    const stops = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    assertEquals(
      stops.sort(),
      [...LAYER_4, ...LAYER_5].map((n) => `stopContainer:old-${n}`).sort(),
    );
    for (const n of [...LAYER_1, ...LAYER_2]) {
      assert(!fake.mutations.some((m) => m.endsWith(`old-${n}`)), `${n} must be untouched`);
    }
    assertEquals(
      fake.mutations.filter((m) => m.startsWith('create') || m.startsWith('remove')),
      [],
    );
    assertEquals(net.currentState, 'running');
    assertEquals(net.getContainerId(`${ID}-postgres`), `old-${ID}-postgres`);
  });
});

Deno.test('start repair - splice exited and no dependents exist: nothing running is stopped', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(...LAYER_4, ...LAYER_5), 'running');
    fake.containers.get(`${ID}-splice`)!.state = 'exited';
    await net.start(START);
    assert(fake.mutations.includes(`startContainer:old-${ID}-splice`));
    assertEquals(fake.mutations.filter((m) => m.startsWith('stop')), []);
  });
});

Deno.test('start repair - a web UI exited: only that UI and nginx are started', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    fake.containers.get(`${ID}-sv-web-ui`)!.state = 'exited';
    await net.start(START);

    assertEquals(
      fake.mutations.filter((m) => m.startsWith('startContainer:')).sort(),
      [`startContainer:old-${ID}-sv-web-ui`, `startContainer:old-${ID}-nginx`].sort(),
    );
    assertEquals(fake.mutations.filter((m) => m.startsWith('stopContainer:')), [
      `stopContainer:old-${ID}-nginx`,
    ]);
  });
});

Deno.test('start repair - splice missing: it is created', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(`${ID}-splice`), 'running');
    await net.start(START);
    assert(fake.mutations.includes(`createContainer:${ID}-splice`));
    assertEquals(fake.mutations.filter((m) => m === `createContainer:${ID}-postgres`), []);
    assert(fake.containers.get(`${ID}-splice`)?.state === 'running');
  });
});

Deno.test('start repair - a failed repair does not stop containers that were running before', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    fake.containers.get(`${ID}-splice`)!.state = 'exited';
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    const stops = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    assertEquals(stops, [`stopContainer:old-${ID}-splice`]);
    for (const n of ALL_BUT(`${ID}-splice`)) {
      assertEquals(fake.containers.get(n)?.state, 'running', `${n} must still run`);
    }
    assertEquals(net.currentState, 'stopped');
  });
});

Deno.test('start repair - a failure after restarting dependents leaves them running', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    fake.containers.get(`${ID}-splice`)!.state = 'exited';
    fake.failStartOnce.add(`${ID}-nginx`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    // nginx was stopped for the restart and its start failed: rollback starts it again.
    assertEquals(fake.containers.get(`${ID}-nginx`)?.state, 'running');
    // Restarted web UIs (not in rb.started) are not stopped by the rollback.
    const stops = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    for (const n of WEB_UIS) {
      assertEquals(stops.filter((s) => s === `stopContainer:old-${n}`).length, 1);
    }
    assertEquals(fake.containers.get(`${ID}-sv-web-ui`)?.state, 'running');
  });
});

/** Mutations issued after the failed start of `idOrName`, i.e. by the rollback. */
function rollbackMutations(fake: FakeDockerClient, idOrName: string): string[] {
  const failedAt = fake.calls.indexOf(`startFailed:${idOrName}`);
  assert(failedAt >= 0, `expected a failed start of ${idOrName}`);
  return fake.calls.slice(failedAt + 1).filter((c) => MUTATING.some((m) => c.startsWith(`${m}:`)));
}

Deno.test('start repair - rollback starts restarted dependents before stopping their upstreams', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    fake.containers.get(`${ID}-splice`)!.state = 'exited';
    fake.failStartOnce.add(`${ID}-nginx`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    // nginx resolves its upstreams only at startup, so it must start before splice stops.
    const rollback = rollbackMutations(fake, `old-${ID}-nginx`);
    assertEquals(rollback[0], `startContainer:old-${ID}-nginx`);
    assert(rollback.includes(`stopContainer:old-${ID}-splice`));
  });
});

Deno.test('start repair - rollback starts restarted dependents before removing created upstreams', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(`${ID}-splice`), 'running');
    fake.failStartOnce.add(`${ID}-nginx`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    const rollback = rollbackMutations(fake, `old-${ID}-nginx`);
    assertEquals(rollback[0], `startContainer:old-${ID}-nginx`);
    assert(rollback.includes(`removeContainer:new-${ID}-splice`));
  });
});

Deno.test('start repair - a 409 on create aborts without stopping containers this call did not start', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(`${ID}-splice`), 'running');
    fake.conflictCreate.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'starting in another process');

    assertEquals(fake.mutations.filter((m) => m.startsWith('stop') || m.startsWith('remove')), []);
    for (const n of ALL_BUT(`${ID}-splice`)) assertEquals(fake.containers.get(n)?.state, 'running');
    assertEquals(net.currentState, 'stopped');
  });
});

Deno.test('start repair - a 409 does not stop pre-existing containers this call started', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(`${ID}-splice`), 'running');
    fake.containers.get(`${ID}-postgres`)!.state = 'exited';
    fake.conflictCreate.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'starting in another process');

    // Running dependents of postgres were restarted and are started back; postgres is not stopped.
    assertEquals(fake.mutations.includes(`stopContainer:old-${ID}-postgres`), false);
    assertEquals(fake.containers.get(`${ID}-postgres`)?.state, 'running');
  });
});

Deno.test('start repair - a young created container aborts and mutates nothing', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(`${ID}-splice`), 'running');
    fake.containers.set(`${ID}-splice`, {
      id: 'c1',
      state: 'created',
      created: Math.floor(Date.now() / 1000) - 10,
    });
    await assertRejects(
      () => net.start(START),
      Error,
      `'${ID}-splice' created `,
    );
    assertEquals(fake.mutations, []);
  });
});

Deno.test('start repair - an old created container is started normally', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_BUT(`${ID}-splice`), 'running');
    fake.containers.set(`${ID}-splice`, {
      id: 'c1',
      state: 'created',
      created: Math.floor(Date.now() / 1000) - 120,
    });
    await net.start(START);
    assert(fake.mutations.includes('startContainer:c1'));
    assertEquals(fake.containers.get(`${ID}-splice`)?.state, 'running');
  });
});

Deno.test('start repair - a paused container is refused with an unpause hint', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    fake.containers.get(`${ID}-canton`)!.state = 'paused';
    await assertRejects(() => net.start(START), Error, `docker unpause ${ID}-canton`);
    assertEquals(fake.mutations, []);
  });
});

Deno.test('start repair - nginx alone running (daemon restart) repairs everything else', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'exited');
    fake.containers.get(`${ID}-nginx`)!.state = 'running';
    await net.start(START);
    for (const n of ALL_NAMES) assertEquals(fake.containers.get(n)?.state, 'running', n);
    assertEquals(net.currentState, 'running');
  });
});

Deno.test('state - a missing expected container makes the instance partial, not running', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'running');
    assertEquals(await net.state(), 'running');
    assertEquals(await net.isRunning(), true);
    fake.containers.delete(`${ID}-splice`);
    assertEquals(await net.state(), 'partial');
    assertEquals(await net.isRunning(), false);
  });
});

Deno.test('start repair - nginx crash-looping (restarting) is stopped and started, with health checks', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'exited');
    fake.containers.get(`${ID}-nginx`)!.state = 'restarting';
    await net.start({ skipInitialization: true });
    for (const n of ALL_NAMES) assertEquals(fake.containers.get(n)?.state, 'running', n);
    assert(fake.mutations.includes(`stopContainer:old-${ID}-nginx`));
    assertEquals(net.currentState, 'running');
  });
});

Deno.test('start rollback - a 409 leaves the network and volume this call created', async () => {
  await withFakeNet(async (net, fake) => {
    fake.conflictCreate.add(`${ID}-postgres`);
    await assertRejects(() => net.start(START), Error, 'starting in another process');
    assert(fake.mutations.some((m) => m.startsWith('createNetwork:')));
    assertEquals(fake.mutations.filter((m) => m.startsWith('removeNetwork')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('removeVolume')), []);
    assert(fake.networkExists && fake.volumeExists);
  });
});

Deno.test('start rollback - a transient inspect error is not mistaken for a 409', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES, 'exited');
    // The container exists, so a create would 409; the inspect error must abort first.
    fake.inspectError.set(`${ID}-splice`, new Error('socket hang up'));
    fake.conflictCreate.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'socket hang up');
    // Not a conflict: everything this call started is stopped again.
    for (const n of [...LAYER_1, ...LAYER_2]) {
      assertEquals(fake.containers.get(n)?.state, 'exited', n);
    }
    assertEquals(net.currentState, 'stopped');
  });
});

// --- detectConfigMismatch compares through the stored-label (silent, lenient) parse ---

Deno.test('detectConfigMismatch - a label carrying parties[].validator matches the YAML without it', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    const stored = {
      ...parseLocalNetConfig(net.getConfig()),
      validators: [{ name: 'validator-1', parties: [{ hint: 'p', validator: 'validator-1' }] }],
    };
    fake.setConfig(JSON.stringify(stored));
    Reflect.set(
      net,
      'config',
      parseLocalNetConfig({
        ...net.getConfig(),
        validators: [{ name: 'validator-1', parties: [{ hint: 'p' }] }],
      }),
    );
    assertEquals((await net.detectConfigMismatch()).hasMismatch, false);
  });
});

Deno.test('detectConfigMismatch - a label that fails the input rules does not throw', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.setConfig(JSON.stringify({
      ...net.getConfig(),
      validators: [{ name: 'a' }, { name: 'A' }],
    }));
    const result = await net.detectConfigMismatch();
    assertEquals(result.hasMismatch, true);
    assertEquals(result.actual.validators, ['a', 'A']);
  });
});
