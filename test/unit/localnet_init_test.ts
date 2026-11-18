import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { InitializationError, LocalNetError } from '../../src/errors.ts';
import { CantonApiError } from '../../src/api/canton.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';

// initializeResources() with its Docker/API dependencies stubbed: only the
// party pre-check is under test.
async function setup(hosted: string[]) {
  const config = createMinimalConfig(1);
  config.validators = [
    { name: 'validator-1', parties: [{ hint: 'alice' }, { hint: 'bob' }] },
  ];
  const net = await LocalNet.fromConfig(config, { instanceId: 'inittest' });
  const allocated: string[] = [];
  Reflect.set(net, 'waitForApisReady', () => Promise.resolve());
  Reflect.set(net, 'waitForScanActive', () => Promise.resolve());
  Reflect.set(net, 'fetchHostedParties', () =>
    Promise.resolve({
      participantId: 'p',
      parties: hosted.map((h) => ({ party: `${h}::ns`, isLocal: true })),
    }));
  Reflect.set(net, 'allocateParty', (hint: string) => {
    allocated.push(hint);
    return Promise.resolve({ partyId: `${hint}::ns` });
  });
  return { net, allocated };
}

Deno.test('initializeResources skips parties whose hint is already hosted', async () => {
  const { net, allocated } = await setup(['alice']);
  const messages: string[] = [];
  await net.initializeResources((m) => messages.push(m));
  assertEquals(allocated, ['bob']);
  assertEquals(messages.some((m) => m.includes("'alice' already allocated")), true);
});

Deno.test('initializeResources allocates everything when nothing exists', async () => {
  const { net, allocated } = await setup([]);
  await net.initializeResources();
  assertEquals(allocated, ['alice', 'bob']);
});

Deno.test('initializeResources is a no-op for parties when all already exist', async () => {
  const { net, allocated } = await setup(['alice', 'bob']);
  await net.initializeResources();
  assertEquals(allocated, []);
});

Deno.test('initializeResources rejects, typed, without allocating, when the hosted-party query fails', async () => {
  const { net, allocated } = await setup([]);
  Reflect.set(net, 'fetchHostedParties', () => Promise.reject(new Error('boom')));
  const err = await assertRejects(() => net.initializeResources(), InitializationError);
  assertEquals([err.kind, err.resource, err.validator], [
    'validator',
    'validator-1',
    'validator-1',
  ]);
  assertStringIncludes(err.message, "'validator-1'");
  assertEquals((err.cause as Error).message, 'boom');
  assertEquals(allocated, []);
});

Deno.test('initializeResources - a party that cannot be allocated fails it, typed, naming it and the cause', async () => {
  const { net, allocated } = await setup([]);
  const cause = new CantonApiError(400, 'POST /v2/parties: INVALID_ARGUMENT');
  Reflect.set(net, 'allocateParty', (hint: string) => {
    allocated.push(hint);
    return hint === 'alice' ? Promise.reject(cause) : Promise.resolve({ partyId: `${hint}::ns` });
  });
  const err = await assertRejects(() => net.initializeResources(), InitializationError);
  assertEquals([err.kind, err.resource, err.validator], ['party', 'alice', 'validator-1']);
  assertEquals(err.cause, cause);
  assertStringIncludes(err.message, "party 'alice' on validator-1");
  assertStringIncludes(err.message, 'INVALID_ARGUMENT');
  assertEquals(allocated, ['alice']);
});

Deno.test('initializeResources - a user that cannot be set up fails it, typed, naming it and the cause', async () => {
  const { net } = await setup(['alice', 'bob']);
  Reflect.set(net, 'config', {
    ...net.getConfig(),
    validators: [{ name: 'validator-1', users: [{ id: 'ops' }, { id: 'later' }] }],
  });
  const cause = new CantonApiError(400, 'POST /v2/users: INVALID_ARGUMENT');
  const tried: string[] = [];
  Reflect.set(net, 'createUser', (id: string) => {
    tried.push(id);
    return Promise.reject(cause);
  });
  const err = await assertRejects(() => net.initializeResources(), InitializationError);
  assertEquals([err.kind, err.resource, err.validator], ['user', 'ops', 'validator-1']);
  assertEquals(err.cause, cause);
  assertStringIncludes(err.message, "user 'ops' on validator-1");
  assertEquals(tried, ['ops']);
});

/** createUser against fake Canton, validator and Keycloak clients; `lookup` answers getUser. */
async function createUserWith(lookup: () => Promise<unknown>) {
  const net = await LocalNet.fromConfig(createMinimalConfig(1), { instanceId: 'inittest' });
  const created: string[] = [];
  let lookups = 0;
  Reflect.set(net, 'requireRunning', () => Promise.resolve());
  Reflect.get(net, 'cantonClients').set('validator-1', {
    getUser: (id: string) =>
      ++lookups === 1 ? lookup() : Promise.resolve({ id, primaryParty: '', isDeactivated: false }),
    createUser: (id: string) => {
      created.push(id);
      return Promise.resolve({ id });
    },
  });
  Reflect.set(
    net,
    'getKeycloakAdminClient',
    () => ({ createUser: () => Promise.resolve({ id: 'k' }) }),
  );
  return { net, created };
}

Deno.test('createUser - a 404 from the Canton user lookup creates the user', async () => {
  const { net, created } = await createUserWith(() =>
    Promise.reject(new CantonApiError(404, 'GET /v2/users/ops: USER_NOT_FOUND'))
  );
  await net.createUser('ops', 'validator-1');
  assertEquals(created, ['ops']);
});

Deno.test('createUser - an existing Canton user is not created again', async () => {
  const { net, created } = await createUserWith(() => Promise.resolve({ id: 'ops' }));
  await net.createUser('ops', 'validator-1');
  assertEquals(created, []);
});

Deno.test('createUser - any other lookup error fails it, typed, with the cause, and creates nothing', async () => {
  for (
    const cause of [
      new CantonApiError(503, 'GET /v2/users/ops: UNAVAILABLE'),
      new TypeError('fetch failed'),
    ]
  ) {
    const { net, created } = await createUserWith(() => Promise.reject(cause));
    const err = await assertRejects(() => net.createUser('ops', 'validator-1'), LocalNetError);
    assertEquals(err.cause, cause);
    assertStringIncludes(err.message, "user 'ops' on validator-1");
    assertEquals(created, []);
  }
});

/** A LocalNet whose readiness waits poll fast and never succeed for the given reason. */
async function neverReady(stub: (net: LocalNet) => void) {
  const net = await LocalNet.fromConfig(createMinimalConfig(1), { instanceId: 'inittest' });
  Reflect.set(net, 'readinessDelayMs', { initial: 1, max: 1 });
  stub(net);
  return net;
}

Deno.test('initializeResources - a validator API that never becomes ready fails it, typed, naming it and the cause', async () => {
  const net = await neverReady((n) =>
    Reflect.set(n, 'getValidatorState', () => Promise.reject(new TypeError('connection refused')))
  );
  const err = await assertRejects(() => net.initializeResources(), InitializationError);
  assertEquals([err.kind, err.resource, err.validator], ['validator', 'sv', 'sv']);
  assertEquals((err.cause as Error).message, 'connection refused');
  assertStringIncludes(err.message, 'API for sv did not become ready');
});

Deno.test('initializeResources - Scan that never becomes active fails it, typed, with the cause', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError('connection refused'));
  try {
    const net = await neverReady((n) =>
      Reflect.set(
        n,
        'getValidatorState',
        () => Promise.resolve({ isHealthy: true, validatorParty: 'p::ns' }),
      )
    );
    const err = await assertRejects(() => net.initializeResources(), InitializationError);
    assertEquals([err.kind, err.resource, err.validator], ['validator', 'sv', 'sv']);
    assertEquals((err.cause as Error).message, 'connection refused');
    assertStringIncludes(err.message, 'Scan did not become ready');
  } finally {
    globalThis.fetch = realFetch;
  }
});
