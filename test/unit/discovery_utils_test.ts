import { assertEquals } from '@std/assert';
import {
  reconstructConfigFromLabels,
  discoverInstances,
  LABEL_INSTANCE,
  LABEL_SCHEMA,
  LABEL_CONFIG,
  type ContainerListItem,
} from '../../src/api/discovery-utils.ts';

Deno.test('reconstructConfigFromLabels - Happy path schema 2 returns real credentials', () => {
  const config = {
    validators: 2,
    auth: {
      keycloak: {
        admin: 'realadmin',
        password: 'realpass',
      },
    },
  };
  const labels = {
    [LABEL_SCHEMA]: '2',
    [LABEL_CONFIG]: JSON.stringify(config),
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result !== null, true);
  if (result) {
    assertEquals(result.auth.keycloak.admin, 'realadmin');
    assertEquals(result.auth.keycloak.password, 'realpass');
  }
});

Deno.test('reconstructConfigFromLabels - Schema mismatch returns null', () => {
  const config = {
    validators: 2,
    auth: {
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  };
  const labels = {
    [LABEL_SCHEMA]: '1',
    [LABEL_CONFIG]: JSON.stringify(config),
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result, null);
});

Deno.test('reconstructConfigFromLabels - Missing config label returns null', () => {
  const labels = {
    [LABEL_SCHEMA]: '2',
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result, null);
});

Deno.test('reconstructConfigFromLabels - Corrupt JSON returns null', () => {
  const labels = {
    [LABEL_SCHEMA]: '2',
    [LABEL_CONFIG]: 'not-valid-json',
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result, null);
});

Deno.test('reconstructConfigFromLabels - Round-trip idempotent', () => {
  const config = {
    basePort: 5000,
    validators: [
      { name: 'validator-1', parties: [{ hint: 'alice' }] },
      { name: 'validator-2' },
    ],
    auth: {
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  };
  const labels = {
    [LABEL_SCHEMA]: '2',
    [LABEL_CONFIG]: JSON.stringify(config),
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result !== null, true);
  if (result) {
    assertEquals(result.basePort, 5000);
    assertEquals(Array.isArray(result.validators), true);
    const validators = result.validators as any[];
    assertEquals(validators.length, 2);
    assertEquals(validators[0].name, 'validator-1');
    assertEquals(validators[1].name, 'validator-2');
  }
});

Deno.test('reconstructConfigFromLabels - Schema absent returns null', () => {
  const config = {
    validators: 2,
    auth: {
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  };
  const labels = {
    [LABEL_CONFIG]: JSON.stringify(config),
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result, null);
});

Deno.test('reconstructConfigFromLabels - Hand-edited config (invalid types) returns null', () => {
  const labels = {
    [LABEL_SCHEMA]: '2',
    [LABEL_CONFIG]: JSON.stringify({
      validators: 'not-an-array',
      auth: {
        keycloak: {
          admin: 'admin',
          password: 'admin',
        },
      },
    }),
  };

  const result = reconstructConfigFromLabels(labels);

  assertEquals(result, null);
});

Deno.test('discoverInstances - 2 instances with 3 containers each', () => {
  const config1 = {
    version: '1.0',
    basePort: 5000,
    validators: [{ name: 'validator-1' }, { name: 'validator-2' }],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const config2 = {
    version: '1.0',
    basePort: 6000,
    validators: [{ name: 'alice' }, { name: 'bob' }],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };

  const containers: ContainerListItem[] = [
    {
      name: 'postgres-1',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config1),
      },
    },
    {
      name: 'canton-1',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config1),
      },
    },
    {
      name: 'splice-1',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config1),
      },
    },
    {
      name: 'postgres-2',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-2',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config2),
      },
    },
    {
      name: 'canton-2',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-2',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config2),
      },
    },
    {
      name: 'splice-2',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-2',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config2),
      },
    },
  ];

  const instances = discoverInstances(containers);

  assertEquals(instances.length, 2);
  assertEquals(instances[0].id, 'test-1');
  assertEquals(instances[0].containerCount, 3);
  assertEquals(instances[0].status, 'running');
  assertEquals(instances[0].basePort, 5000);
  assertEquals(instances[0].validatorNames.length, 2);
  assertEquals(instances[0].validatorNames[0], 'validator-1');
  assertEquals(instances[0].validatorNames[1], 'validator-2');

  assertEquals(instances[1].id, 'test-2');
  assertEquals(instances[1].containerCount, 3);
  assertEquals(instances[1].status, 'running');
  assertEquals(instances[1].basePort, 6000);
  assertEquals(instances[1].validatorNames.length, 2);
  assertEquals(instances[1].validatorNames[0], 'alice');
  assertEquals(instances[1].validatorNames[1], 'bob');
});

Deno.test('discoverInstances - empty container list', () => {
  const containers: ContainerListItem[] = [];

  const instances = discoverInstances(containers);

  assertEquals(instances.length, 0);
});

Deno.test('discoverInstances - containers without localnet.instance label are filtered out', () => {
  const containers: ContainerListItem[] = [
    {
      name: 'postgres',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
      },
    },
    {
      name: 'other-container',
      state: 'running',
      labels: {
        'some.other.label': 'value',
      },
    },
    {
      name: 'another-container',
      state: 'running',
      labels: {},
    },
  ];

  const instances = discoverInstances(containers);

  assertEquals(instances.length, 1);
  assertEquals(instances[0].id, 'test-1');
  assertEquals(instances[0].containerCount, 1);
});

Deno.test('discoverInstances - mixed running and stopped containers', () => {
  const config = {
    version: '1.0',
    basePort: 5000,
    validators: [{ name: 'validator-1' }],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };

  const containers: ContainerListItem[] = [
    {
      name: 'postgres',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config),
      },
    },
    {
      name: 'canton',
      state: 'exited',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config),
      },
    },
    {
      name: 'splice',
      state: 'running',
      labels: {
        [LABEL_INSTANCE]: 'test-1',
        [LABEL_SCHEMA]: '2',
        [LABEL_CONFIG]: JSON.stringify(config),
      },
    },
  ];

  const instances = discoverInstances(containers);

  assertEquals(instances.length, 1);
  assertEquals(instances[0].id, 'test-1');
  assertEquals(instances[0].containerCount, 3);
  assertEquals(instances[0].status, 'mixed');
});
