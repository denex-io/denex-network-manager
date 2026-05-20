import { assertEquals, assertExists } from '@std/assert';
import { MultiInstanceDiscoveryServer } from '../../src/api/discovery.ts';
import {
  LABEL_INSTANCE,
} from '../../src/api/discovery-utils.ts';
import type { ContainerInfo } from '../../src/docker/types.ts';

// --- Test helpers ---

function createMockDockerClient(containers: ContainerInfo[]) {
  return {
    listContainers: (_labelFilter?: Record<string, string>): Promise<ContainerInfo[]> => {
      return Promise.resolve(containers);
    },
  };
}

function fakeContainer(
  name: string,
  instanceId: string,
  basePort: number,
  validatorNames: string[],
  state: string = 'running',
): ContainerInfo {
  const config = {
    version: '1.0',
    basePort,
    validators: validatorNames.map((n) => ({ name: n })),
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  return {
    id: `sha-${name}`,
    name,
    state: state as ContainerInfo['state'],
    status: state,
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: instanceId,
      'denex.localnet.schema': '2',
      'denex.localnet.config': JSON.stringify(config),
    },
  };
}

function makeServer(containers: ContainerInfo[]) {
  const mockClient = createMockDockerClient(containers);
  return new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });
}

function assertJsonContentType(res: Response) {
  const ct = res.headers.get('content-type');
  assertExists(ct, 'content-type header should exist');
  assertEquals(ct.includes('application/json'), true, `Expected application/json, got: ${ct}`);
}

// --- Group 1: Zero instances (empty Docker) ---

Deno.test('Integration - zero instances - /health returns ok', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/health');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(body.status, 'ok');
});

Deno.test('Integration - zero instances - /instances returns empty array', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/instances');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(Array.isArray(body), true);
  assertEquals(body.length, 0);
});

Deno.test('Integration - zero instances - /instances/any/status returns 404', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/instances/any/status');

  assertEquals(res.status, 404);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
  assertEquals(body.instanceId, 'any');
});

Deno.test('Integration - zero instances - /instances/any/parties returns 404', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/instances/any/parties');

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

Deno.test('Integration - zero instances - /instances/any/packages returns 404', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/instances/any/packages');

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

Deno.test('Integration - zero instances - /instances/any/env returns 404', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/instances/any/env');

  assertEquals(res.status, 404);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

Deno.test('Integration - zero instances - /instances/any/snapshot returns 404', async () => {
  const server = makeServer([]);
  const res = await server.honoApp.request('/instances/any/snapshot');

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

// --- Group 2: Single instance (default, basePort 5000, 2 validators) ---

const SINGLE_INSTANCE_CONTAINERS: ContainerInfo[] = [
  fakeContainer('postgres', 'default', 5000, ['validator-1', 'validator-2']),
  fakeContainer('canton', 'default', 5000, ['validator-1', 'validator-2']),
  fakeContainer('splice', 'default', 5000, ['validator-1', 'validator-2']),
  fakeContainer('keycloak', 'default', 5000, ['validator-1', 'validator-2']),
  fakeContainer('nginx', 'default', 5000, ['validator-1', 'validator-2']),
];

Deno.test('Integration - single instance - /health returns ok', async () => {
  const server = makeServer(SINGLE_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/health');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(body.status, 'ok');
});

Deno.test('Integration - single instance - /instances returns 1 instance with correct metadata', async () => {
  const server = makeServer(SINGLE_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].id, 'default');
  assertEquals(body[0].containerCount, 5);
  assertEquals(body[0].status, 'running');
  assertEquals(body[0].basePort, 5000);
  assertEquals(body[0].validatorNames.length, 2);
  assertEquals(body[0].validatorNames[0], 'validator-1');
  assertEquals(body[0].validatorNames[1], 'validator-2');
});

Deno.test('Integration - single instance - /instances/default/env returns correct SV endpoints', async () => {
  const server = makeServer(SINGLE_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/default/env');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();
  assertExists(body.validators);
  assertExists(body.auth);

  // SV endpoints use base port 5000
  const sv = body.validators.sv;
  assertExists(sv);
  assertEquals(sv.role, 'sv');
  assertEquals(sv.endpoints.ledgerApi, 'http://localhost:5001');
  assertEquals(sv.endpoints.adminApi, 'http://localhost:5002');
  assertEquals(sv.endpoints.validatorAdminApi, 'http://localhost:5003');
});

Deno.test('Integration - single instance - /instances/default/env returns correct validator endpoints', async () => {
  const server = makeServer(SINGLE_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/default/env');

  assertEquals(res.status, 200);
  const body = await res.json();

  // Validator-1 endpoints use base port 5100
  const v1 = body.validators['validator-1'];
  assertExists(v1);
  assertEquals(v1.role, 'validator');
  assertEquals(v1.endpoints.ledgerApi, 'http://localhost:5101');
  assertEquals(v1.endpoints.adminApi, 'http://localhost:5102');
  assertEquals(v1.endpoints.validatorAdminApi, 'http://localhost:5103');

  // Validator-2 endpoints use base port 5200
  const v2 = body.validators['validator-2'];
  assertExists(v2);
  assertEquals(v2.role, 'validator');
  assertEquals(v2.endpoints.ledgerApi, 'http://localhost:5201');
  assertEquals(v2.endpoints.adminApi, 'http://localhost:5202');
  assertEquals(v2.endpoints.validatorAdminApi, 'http://localhost:5203');
});

Deno.test('Integration - single instance - /instances/unknown/status returns 404', async () => {
  const server = makeServer(SINGLE_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/unknown/status');

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
  assertEquals(body.instanceId, 'unknown');
});

Deno.test('Integration - single instance - /instances/unknown/env returns 404', async () => {
  const server = makeServer(SINGLE_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/unknown/env');

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

// --- Group 3: Two instances (different basePorts, cross-instance isolation) ---

const TWO_INSTANCE_CONTAINERS: ContainerInfo[] = [
  // Instance "prod" — basePort 5000, validator "alice"
  fakeContainer('postgres-prod', 'prod', 5000, ['alice']),
  fakeContainer('canton-prod', 'prod', 5000, ['alice']),
  fakeContainer('splice-prod', 'prod', 5000, ['alice']),
  // Instance "staging" — basePort 7000, validator "bob"
  fakeContainer('postgres-staging', 'staging', 7000, ['bob']),
  fakeContainer('canton-staging', 'staging', 7000, ['bob']),
  fakeContainer('splice-staging', 'staging', 7000, ['bob']),
];

Deno.test('Integration - two instances - /instances returns 2 instances sorted by id', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();
  assertEquals(body.length, 2);
  // Sorted alphabetically: prod before staging
  assertEquals(body[0].id, 'prod');
  assertEquals(body[0].basePort, 5000);
  assertEquals(body[0].validatorNames, ['alice']);
  assertEquals(body[0].containerCount, 3);
  assertEquals(body[1].id, 'staging');
  assertEquals(body[1].basePort, 7000);
  assertEquals(body[1].validatorNames, ['bob']);
  assertEquals(body[1].containerCount, 3);
});

Deno.test('Integration - two instances - /instances/prod/env uses basePort 5000', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/prod/env');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();

  // SV at 5000
  assertEquals(body.validators.sv.endpoints.ledgerApi, 'http://localhost:5001');
  // alice at 5100
  assertExists(body.validators['alice']);
  assertEquals(body.validators['alice'].endpoints.ledgerApi, 'http://localhost:5101');

  // Should NOT have bob (that's staging's validator)
  assertEquals(body.validators['bob'], undefined);
});

Deno.test('Integration - two instances - /instances/staging/env uses basePort 7000', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/staging/env');

  assertEquals(res.status, 200);
  assertJsonContentType(res);

  const body = await res.json();

  // SV at 7000
  assertEquals(body.validators.sv.endpoints.ledgerApi, 'http://localhost:7001');
  // bob at 7100
  assertExists(body.validators['bob']);
  assertEquals(body.validators['bob'].endpoints.ledgerApi, 'http://localhost:7101');

  // Should NOT have alice (that's prod's validator)
  assertEquals(body.validators['alice'], undefined);
});

Deno.test('Integration - two instances - cross-instance isolation: no port leakage', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);

  const prodRes = await server.honoApp.request('/instances/prod/env');
  const stagingRes = await server.honoApp.request('/instances/staging/env');

  const prodBody = await prodRes.json();
  const stagingBody = await stagingRes.json();

  // Prod uses port 5000 range — should not contain 7000 range
  const prodJson = JSON.stringify(prodBody);
  assertEquals(prodJson.includes('7001'), false, 'Prod env should not contain staging port 7001');
  assertEquals(prodJson.includes('7101'), false, 'Prod env should not contain staging port 7101');

  // Staging uses port 7000 range — should not contain 5000 range
  const stagingJson = JSON.stringify(stagingBody);
  assertEquals(stagingJson.includes('5001'), false, 'Staging env should not contain prod port 5001');
  assertEquals(stagingJson.includes('5101'), false, 'Staging env should not contain prod port 5101');
});

Deno.test('Integration - two instances - /instances/nonexistent/env returns 404', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/nonexistent/env');

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
  assertEquals(body.instanceId, 'nonexistent');
});

Deno.test('Integration - two instances - /instances/prod/env has auth config', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/prod/env');

  assertEquals(res.status, 200);
  const body = await res.json();

  assertExists(body.auth);
  assertExists(body.auth.keycloak);
  assertExists(body.auth.keycloak.url);
  // Keycloak port is basePort + 82 = 5082 for prod
  assertEquals(body.auth.keycloak.url.includes('5082'), true, 'Prod keycloak should use port 5082');
});

Deno.test('Integration - two instances - /instances/staging/env has correct keycloak port', async () => {
  const server = makeServer(TWO_INSTANCE_CONTAINERS);
  const res = await server.honoApp.request('/instances/staging/env');

  assertEquals(res.status, 200);
  const body = await res.json();

  assertExists(body.auth);
  assertExists(body.auth.keycloak);
  assertExists(body.auth.keycloak.url);
  // Keycloak port is basePort + 82 = 7082 for staging
  assertEquals(body.auth.keycloak.url.includes('7082'), true, 'Staging keycloak should use port 7082');
});
