import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { KeycloakAdminClient } from '../../src/api/keycloak-admin.ts';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchMock(handler: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function tokenResponse(accessToken = 'test-token-abc', expiresIn = 300): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

Deno.test('KeycloakAdminClient - constructs with credentials', () => {
  const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
  assertExists(client);
});

Deno.test('KeycloakAdminClient - getToken caches across sequential calls', async () => {
  let tokenFetchCount = 0;
  const { restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      tokenFetchCount++;
      return tokenResponse();
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
    const t1 = await client.getToken();
    const t2 = await client.getToken();
    const t3 = await client.getToken();

    assertEquals(t1, 'test-token-abc');
    assertEquals(t2, 'test-token-abc');
    assertEquals(t3, 'test-token-abc');
    assertEquals(tokenFetchCount, 1, 'sequential calls within TTL must reuse cached token');
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - getToken dedupes 5 concurrent calls into 1 fetch', async () => {
  let tokenFetchCount = 0;
  let resolveFetch: (() => void) | null = null;
  const fetchGate = new Promise<void>((resolve) => { resolveFetch = resolve; });

  const { restore } = installFetchMock(async (call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      tokenFetchCount++;
      // Delay resolution so multiple callers pile up while a fetch is in flight.
      await fetchGate;
      return tokenResponse();
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');

    const concurrent = Promise.all([
      client.getToken(),
      client.getToken(),
      client.getToken(),
      client.getToken(),
      client.getToken(),
    ]);

    // Allow microtasks to run so all 5 callers register before the fetch resolves.
    await new Promise((resolve) => setTimeout(resolve, 10));

    resolveFetch!();
    const tokens = await concurrent;

    assertEquals(tokens.length, 5);
    for (const t of tokens) {
      assertEquals(t, 'test-token-abc');
    }
    assertEquals(
      tokenFetchCount,
      1,
      `5 concurrent getToken() calls must result in EXACTLY 1 underlying fetch (got ${tokenFetchCount})`,
    );
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - getToken refreshes after 401', async () => {
  let tokenFetchCount = 0;
  const { calls, restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      tokenFetchCount++;
      return tokenResponse(`token-${tokenFetchCount}`);
    }
    if (call.url.includes('/admin/realms/')) {
      const auth = (call.init?.headers as Record<string, string> | undefined)?.['Authorization'];
      // First call uses token-1 (return 401); after refresh use token-2 (return empty list).
      if (auth === 'Bearer token-1') {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
    const result = await client.findUser('SV', 'someone');

    assertEquals(result, null);
    assertEquals(tokenFetchCount, 2, '401 must trigger one token refresh');
    const tokenCalls = calls.filter((c) => c.url.includes('/protocol/openid-connect/token')).length;
    const adminCalls = calls.filter((c) => c.url.includes('/admin/realms/')).length;
    assertEquals(tokenCalls, 2);
    assertEquals(adminCalls, 2);
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - getToken throws on token-grant failure', async () => {
  const { restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      return new Response('bad credentials', { status: 401 });
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'wrong');
    await assertRejects(
      () => client.getToken(),
      Error,
      'Keycloak admin token grant failed',
    );
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - findUser returns null when no users match', async () => {
  const { restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      return tokenResponse();
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
    const result = await client.findUser('SV', 'nobody');
    assertEquals(result, null);
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - findUser returns id when user exists', async () => {
  const { calls, restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      return tokenResponse();
    }
    return new Response(
      JSON.stringify([{ id: 'user-uuid-123', username: 'alice' }]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
    const result = await client.findUser('Validator1', 'alice');

    assertEquals(result, { id: 'user-uuid-123' });
    const adminCall = calls.find((c) => c.url.includes('/admin/realms/'));
    assertExists(adminCall);
    if (
      !adminCall.url.includes('username=alice') ||
      !adminCall.url.includes('exact=true') ||
      !adminCall.url.includes('/admin/realms/Validator1/users')
    ) {
      throw new Error(`unexpected findUser URL: ${adminCall.url}`);
    }
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - createUser sends requiredActions:[] and enabled:true', async () => {
  const { calls, restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      return tokenResponse();
    }
    if (call.init?.method === 'GET' && call.url.includes('/admin/realms/')) {
      // findUser returns empty -> user does not exist yet.
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (call.init?.method === 'POST' && call.url.endsWith('/users')) {
      return new Response(null, {
        status: 201,
        headers: { Location: 'http://kc/admin/realms/Validator1/users/new-user-uuid' },
      });
    }
    return new Response('unexpected', { status: 500 });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
    const result = await client.createUser('Validator1', { username: 'alice', password: 'alice' });

    assertEquals(result, { id: 'new-user-uuid' });

    const postCall = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/users'));
    assertExists(postCall);
    const createdBody = JSON.parse(postCall.init!.body as string) as Record<string, unknown>;
    assertEquals(createdBody.username, 'alice');
    assertEquals(createdBody.enabled, true);
    assertEquals(createdBody.requiredActions, []);
    const creds = createdBody.credentials as Array<Record<string, unknown>>;
    assertEquals(creds.length, 1);
    assertEquals(creds[0].type, 'password');
    assertEquals(creds[0].value, 'alice');
    assertEquals(creds[0].temporary, false);
  } finally {
    restore();
  }
});

Deno.test('KeycloakAdminClient - createUser is idempotent when user already exists', async () => {
  let createCallCount = 0;
  const { restore } = installFetchMock((call) => {
    if (call.url.includes('/protocol/openid-connect/token')) {
      return tokenResponse();
    }
    if (call.init?.method === 'GET' && call.url.includes('/admin/realms/')) {
      return new Response(
        JSON.stringify([{ id: 'existing-user-uuid', username: 'alice' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (call.init?.method === 'POST') {
      createCallCount++;
      return new Response(null, { status: 500 });
    }
    return new Response('unexpected', { status: 500 });
  });

  try {
    const client = new KeycloakAdminClient('http://localhost:5082', 'admin', 'admin');
    const result = await client.createUser('Validator1', { username: 'alice', password: 'alice' });

    assertEquals(result, { id: 'existing-user-uuid' });
    assertEquals(createCallCount, 0, 'must skip POST when user already exists');
  } finally {
    restore();
  }
});
