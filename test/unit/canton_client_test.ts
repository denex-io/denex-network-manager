import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { CantonApiError, CantonClient } from '../../src/api/canton.ts';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchMock(handler: (call: FetchCall) => Response): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call: FetchCall = { url: typeof input === 'string' ? input : input.toString(), init };
    if (!call.url.includes('/protocol/openid-connect/token')) calls.push(call);
    if (call.url.includes('/protocol/openid-connect/token')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 300, token_type: 'Bearer' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(handler(call));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function newClient(): CantonClient {
  return new CantonClient({
    baseUrl: 'http://canton.test:7575',
    keycloakUrl: 'http://keycloak.test:8082',
    realm: 'AppProvider',
    clientId: 'app-provider-validator',
    clientSecret: 'secret',
  });
}

/** A tiny but valid DAR: stored zip with a manifest and one DALF. */
function tinyDar(): { bytes: Uint8Array; packageId: string } {
  const encoder = new TextEncoder();
  const payload = encoder.encode('payload');
  const packageId = createHash('sha256').update(payload).digest('hex');
  const field = (n: number, v: Uint8Array) => {
    const out = new Uint8Array(2 + v.length);
    out[0] = n * 8 + 2;
    out[1] = v.length;
    out.set(v, 2);
    return out;
  };
  const dalf = new Uint8Array([...field(3, payload), ...field(4, encoder.encode(packageId))]);
  const u16 = (n: number) => [n & 0xff, n >>> 8];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24];
  const entries = [
    { name: 'META-INF/MANIFEST.MF', data: encoder.encode('Main-Dalf: a.dalf\n') },
    { name: 'a.dalf', data: dalf },
  ];
  const parts: number[] = [];
  const central: number[] = [];
  for (const e of entries) {
    const body = new Uint8Array(deflateRawSync(e.data));
    const name = encoder.encode(e.name);
    const offset = parts.length;
    parts.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(8),
      ...u32(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(e.data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...body,
    );
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(8),
      ...u32(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(e.data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
  }
  const dirOffset = parts.length;
  parts.push(
    ...central,
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(central.length),
    ...u32(dirOffset),
    ...u16(0),
  );
  return { bytes: new Uint8Array(parts), packageId };
}

Deno.test('CantonClient.uploadDar - sends raw octet-stream body and returns the computed id', async () => {
  const { bytes, packageId } = tinyDar();
  const { calls, restore } = installFetchMock(() => json({}));
  try {
    const id = await newClient().uploadDar(bytes);
    assertEquals(id, packageId);
    assertEquals(calls.length, 1);
    const call = calls[0];
    assertEquals(call.url, 'http://canton.test:7575/v2/dars');
    assertEquals(call.init?.method, 'POST');
    const headers = call.init?.headers as Record<string, string>;
    assertEquals(headers['Content-Type'], 'application/octet-stream');
    assertEquals(headers['Accept'], 'application/json');
    assertEquals(headers['Authorization'], 'Bearer tok');
    assertEquals(call.init?.body instanceof FormData, false);
    assertEquals(new Uint8Array(call.init?.body as Uint8Array), bytes);
  } finally {
    restore();
  }
});

Deno.test('CantonClient.uploadDar - HTTP 400 becomes CantonApiError', async () => {
  const { bytes } = tinyDar();
  const { restore } = installFetchMock(() => new Response('bad dar', { status: 400 }));
  try {
    const err = await assertRejects(() => newClient().uploadDar(bytes), CantonApiError);
    assertEquals((err as CantonApiError).statusCode, 400);
  } finally {
    restore();
  }
});

Deno.test('CantonClient.uploadDar - invalid DAR throws before any upload request', async () => {
  const { calls, restore } = installFetchMock(() => json({}));
  try {
    await assertRejects(
      () => newClient().uploadDar(new TextEncoder().encode('nope')),
      Error,
      'Invalid DAR:',
    );
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test('CantonClient.listPackages - reads packageIds', async () => {
  const { restore } = installFetchMock(() => json({ packageIds: ['aa', 'bb'] }));
  try {
    assertEquals(await newClient().listPackages(), ['aa', 'bb']);
  } finally {
    restore();
  }
  const empty = installFetchMock(() => json({}));
  try {
    assertEquals(await newClient().listPackages(), []);
  } finally {
    empty.restore();
  }
});

Deno.test('CantonClient.allocateParty - body carries the displayName annotation', async () => {
  const { calls, restore } = installFetchMock(() =>
    json({ partyDetails: { party: 'alice::1220ab', isLocal: true } })
  );
  try {
    await newClient().allocateParty('alice', 'Alice');
    const body = JSON.parse(calls[0].init?.body as string);
    assertEquals(body.partyIdHint, 'alice');
    assertEquals(body.localMetadata.annotations, { displayName: 'Alice' });
  } finally {
    restore();
  }
});

Deno.test('CantonClient.listParties - follows nextPageToken across pages', async () => {
  const pages: Record<string, unknown> = {
    '/v2/parties': { partyDetails: [{ party: 'a::1' }], nextPageToken: 'tok/1+x' },
    '/v2/parties?pageToken=tok%2F1%2Bx': {
      partyDetails: [{ party: 'b::1' }],
      nextPageToken: 'tok2',
    },
    '/v2/parties?pageToken=tok2': { partyDetails: [{ party: 'c::1' }], nextPageToken: '' },
  };
  const { calls, restore } = installFetchMock((call) =>
    json(pages[new URL(call.url).pathname + new URL(call.url).search])
  );
  try {
    const parties = await newClient().listParties();
    assertEquals(parties.map((p) => p.party), ['a::1', 'b::1', 'c::1']);
    assertEquals(calls.length, 3);
    assertEquals(calls[1].url, 'http://canton.test:7575/v2/parties?pageToken=tok%2F1%2Bx');
    assertEquals(calls[2].url, 'http://canton.test:7575/v2/parties?pageToken=tok2');
  } finally {
    restore();
  }
});

Deno.test('CantonClient.listParties - empty or absent token stops after one request', async () => {
  for (
    const body of [{ partyDetails: [{ party: 'a::1' }] }, { partyDetails: [], nextPageToken: '' }]
  ) {
    const { calls, restore } = installFetchMock(() => json(body));
    try {
      await newClient().listParties();
      assertEquals(calls.length, 1);
    } finally {
      restore();
    }
  }
});

Deno.test('CantonClient.listParties - {} yields [] and absent isLocal stays undefined', async () => {
  const empty = installFetchMock(() => json({}));
  try {
    assertEquals(await newClient().listParties(), []);
  } finally {
    empty.restore();
  }
  const absent = installFetchMock(() => json({ partyDetails: [{ party: 'a::1' }] }));
  try {
    const [party] = await newClient().listParties();
    assertEquals(party.isLocal, undefined);
  } finally {
    absent.restore();
  }
});

Deno.test('CantonClient.listParties - a repeated page token throws', async () => {
  const { restore } = installFetchMock(() => json({ partyDetails: [], nextPageToken: 'same' }));
  try {
    const err = await assertRejects(() => newClient().listParties(), Error);
    assertInstanceOf(err, Error);
    assertEquals(err.message, 'listParties: pagination did not terminate');
  } finally {
    restore();
  }
});

Deno.test('CantonClient.listParties - gives up after 1000 pages', async () => {
  let n = 0;
  const { calls, restore } = installFetchMock(() =>
    json({ partyDetails: [], nextPageToken: `t${n++}` })
  );
  try {
    await assertRejects(() => newClient().listParties(), Error, 'pagination did not terminate');
    assertEquals(calls.length, 1000);
  } finally {
    restore();
  }
});
