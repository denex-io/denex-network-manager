import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
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

/** Stand-in DAR bytes; the client does not parse them, Canton validates. */
const DAR_BYTES = new TextEncoder().encode('dar-bytes');

Deno.test('CantonClient.uploadDar - sends a raw octet-stream body', async () => {
  const { calls, restore } = installFetchMock(() => json({}));
  try {
    await newClient().uploadDar(DAR_BYTES);
    assertEquals(calls.length, 1);
    const call = calls[0];
    assertEquals(call.url, 'http://canton.test:7575/v2/dars');
    assertEquals(call.init?.method, 'POST');
    const headers = call.init?.headers as Record<string, string>;
    assertEquals(headers['Content-Type'], 'application/octet-stream');
    assertEquals(headers['Accept'], 'application/json');
    assertEquals(headers['Authorization'], 'Bearer tok');
    assertEquals(call.init?.body instanceof FormData, false);
    assertEquals(new Uint8Array(call.init?.body as Uint8Array), DAR_BYTES);
  } finally {
    restore();
  }
});

Deno.test('CantonClient.uploadDar - HTTP 400 becomes CantonApiError', async () => {
  const { restore } = installFetchMock(() => new Response('bad dar', { status: 400 }));
  try {
    const err = await assertRejects(
      () => newClient().uploadDar(DAR_BYTES),
      CantonApiError,
      'DAR upload failed: bad dar',
    );
    assertEquals((err as CantonApiError).statusCode, 400);
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
