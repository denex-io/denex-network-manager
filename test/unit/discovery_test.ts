import { assertEquals, assertExists } from '@std/assert';
import { MultiInstanceDiscoveryServer } from '../../src/api/discovery.ts';
import {
  LABEL_INSTANCE,
  LABEL_SCHEMA,
} from '../../src/api/discovery-utils.ts';
import type { ContainerInfo } from '../../src/docker/types.ts';

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
    validators: validatorNames.map(v => ({ name: v })),
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
      [LABEL_SCHEMA]: '2',
      'denex.localnet.config': JSON.stringify(config),
    },
  };
}

const TEST_CONTAINERS: ContainerInfo[] = [
  fakeContainer('postgres', 'test-1', 5000, ['validator-1', 'validator-2']),
  fakeContainer('canton', 'test-1', 5000, ['validator-1', 'validator-2']),
  fakeContainer('splice', 'test-1', 5000, ['validator-1', 'validator-2']),
];

const MULTI_INSTANCE_CONTAINERS: ContainerInfo[] = [
  ...TEST_CONTAINERS,
  fakeContainer('postgres-2', 'test-2', 6000, ['alice', 'bob']),
  fakeContainer('canton-2', 'test-2', 6000, ['alice', 'bob']),
];

Deno.test('MultiInstanceDiscoveryServer - constructs with mock docker client', () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any);
  assertExists(server);
  assertExists(server.honoApp);
});

Deno.test('MultiInstanceDiscoveryServer - constructs with custom options', () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, {
    port: 4000,
    host: '0.0.0.0',
    cacheTtlMs: 60000,
  });
  assertExists(server);
});

Deno.test('MultiInstanceDiscoveryServer - GET /health returns ok', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any);

  const res = await server.honoApp.request('/health');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.status, 'ok');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances returns discovered instances', async () => {
  const mockClient = createMockDockerClient(TEST_CONTAINERS);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(Array.isArray(body), true);
  assertEquals(body.length, 1);
  assertEquals(body[0].id, 'test-1');
  assertEquals(body[0].containerCount, 3);
  assertEquals(body[0].status, 'running');
  assertEquals(body[0].basePort, 5000);
  assertEquals(body[0].validatorNames.length, 2);
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances returns multiple instances', async () => {
  const mockClient = createMockDockerClient(MULTI_INSTANCE_CONTAINERS);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.length, 2);
  assertEquals(body[0].id, 'test-1');
  assertEquals(body[1].id, 'test-2');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances returns empty array when no containers', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.length, 0);
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/status returns 404 for unknown instance', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unknown/status');
  assertEquals(res.status, 404);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
  assertEquals(body.instanceId, 'unknown');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/parties returns 404 for unknown instance', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unknown/parties');
  assertEquals(res.status, 404);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
  assertEquals(body.instanceId, 'unknown');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/packages returns 404 for unknown instance', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unknown/packages');
  assertEquals(res.status, 404);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
  assertEquals(body.instanceId, 'unknown');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/env returns env info for known instance', async () => {
  const mockClient = createMockDockerClient(TEST_CONTAINERS);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/test-1/env');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertExists(body.validators);
  assertExists(body.auth);
  assertExists(body.validators.sv);
  assertEquals(body.validators.sv.role, 'sv');
  assertExists(body.validators['validator-1']);
  assertExists(body.validators['validator-2']);
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/env returns 404 for unknown instance', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unknown/env');
  assertEquals(res.status, 404);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/snapshot returns 404 for unknown instance', async () => {
  const mockClient = createMockDockerClient([]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unknown/snapshot');
  assertEquals(res.status, 404);

  const body = await res.json();
  assertEquals(body.error, 'Instance not found');
});

Deno.test('MultiInstanceDiscoveryServer - env route uses correct basePort from labels', async () => {
  const containers = [
    fakeContainer('postgres', 'custom-port', 7000, ['val-1']),
  ];
  const mockClient = createMockDockerClient(containers);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/custom-port/env');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.validators.sv.endpoints.ledgerApi, 'http://localhost:7001');
  assertEquals(body.validators['val-1'].endpoints.ledgerApi, 'http://localhost:7101');
});

Deno.test('MultiInstanceDiscoveryServer - instance cache is used across requests', async () => {
  let callCount = 0;
  const mockClient = {
    listContainers: (_labelFilter?: Record<string, string>): Promise<ContainerInfo[]> => {
      callCount++;
      return Promise.resolve(TEST_CONTAINERS);
    },
  };

  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 60000 });

  await server.honoApp.request('/instances');
  assertEquals(callCount, 1);
  await server.honoApp.request('/instances');
  assertEquals(callCount, 1);
});

Deno.test('MultiInstanceDiscoveryServer - discoverAndCache refreshes discovery', async () => {
  let callCount = 0;
  const mockClient = {
    listContainers: (_labelFilter?: Record<string, string>): Promise<ContainerInfo[]> => {
      callCount++;
      return Promise.resolve(TEST_CONTAINERS);
    },
  };

  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 60000 });

  await server.discoverAndCache();
  assertEquals(callCount, 1);

  await server.discoverAndCache();
  assertEquals(callCount, 2);
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/env returns 410 for unsupported instance', async () => {
  const unsupportedContainer: ContainerInfo = {
    id: 'sha-unsupported',
    name: 'unsupported-container',
    state: 'running',
    status: 'running',
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: 'unsupported-1',
      [LABEL_SCHEMA]: '1',
    },
  };
  const mockClient = createMockDockerClient([unsupportedContainer]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unsupported-1/env');
  assertEquals(res.status, 410);

  const body = await res.json();
  assertEquals(body.error, 'Instance uses unsupported schema');
  assertEquals(body.instanceId, 'unsupported-1');
  assertExists(body.remediation);
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/status returns 410 for unsupported instance', async () => {
  const unsupportedContainer: ContainerInfo = {
    id: 'sha-unsupported',
    name: 'unsupported-container',
    state: 'running',
    status: 'running',
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: 'unsupported-1',
      [LABEL_SCHEMA]: '1',
    },
  };
  const mockClient = createMockDockerClient([unsupportedContainer]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unsupported-1/status');
  assertEquals(res.status, 410);

  const body = await res.json();
  assertEquals(body.error, 'Instance uses unsupported schema');
  assertEquals(body.instanceId, 'unsupported-1');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/parties returns 410 for unsupported instance', async () => {
  const unsupportedContainer: ContainerInfo = {
    id: 'sha-unsupported',
    name: 'unsupported-container',
    state: 'running',
    status: 'running',
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: 'unsupported-1',
      [LABEL_SCHEMA]: '1',
    },
  };
  const mockClient = createMockDockerClient([unsupportedContainer]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unsupported-1/parties');
  assertEquals(res.status, 410);

  const body = await res.json();
  assertEquals(body.error, 'Instance uses unsupported schema');
  assertEquals(body.instanceId, 'unsupported-1');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/packages returns 410 for unsupported instance', async () => {
  const unsupportedContainer: ContainerInfo = {
    id: 'sha-unsupported',
    name: 'unsupported-container',
    state: 'running',
    status: 'running',
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: 'unsupported-1',
      [LABEL_SCHEMA]: '1',
    },
  };
  const mockClient = createMockDockerClient([unsupportedContainer]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unsupported-1/packages');
  assertEquals(res.status, 410);

  const body = await res.json();
  assertEquals(body.error, 'Instance uses unsupported schema');
  assertEquals(body.instanceId, 'unsupported-1');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances/:id/snapshot returns 410 for unsupported instance', async () => {
  const unsupportedContainer: ContainerInfo = {
    id: 'sha-unsupported',
    name: 'unsupported-container',
    state: 'running',
    status: 'running',
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: 'unsupported-1',
      [LABEL_SCHEMA]: '1',
    },
  };
  const mockClient = createMockDockerClient([unsupportedContainer]);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances/unsupported-1/snapshot');
  assertEquals(res.status, 410);

  const body = await res.json();
  assertEquals(body.error, 'Instance uses unsupported schema');
  assertEquals(body.instanceId, 'unsupported-1');
});

Deno.test('MultiInstanceDiscoveryServer - GET /instances includes unsupported entries', async () => {
  const unsupportedContainer: ContainerInfo = {
    id: 'sha-unsupported',
    name: 'unsupported-container',
    state: 'running',
    status: 'running',
    image: 'test-image:latest',
    ports: [],
    health: 'none',
    labels: {
      [LABEL_INSTANCE]: 'unsupported-1',
      [LABEL_SCHEMA]: '1',
    },
  };
  const containers = [...TEST_CONTAINERS, unsupportedContainer];
  const mockClient = createMockDockerClient(containers);
  const server = new MultiInstanceDiscoveryServer(mockClient as any, { cacheTtlMs: 0 });

  const res = await server.honoApp.request('/instances');
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.length, 2);
  const unsupported = body.find((i: any) => i.id === 'unsupported-1');
  assertExists(unsupported);
  assertEquals(unsupported.status, 'unsupported');
});
