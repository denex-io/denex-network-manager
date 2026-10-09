import { assert, assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';
import { ZodError } from 'zod';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerClient } from '../../src/docker/client.ts';
import { createLocalNet, LocalNet } from '../../src/localnet.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';
import type { LocalNetConfig, PerPartyRight, UserRight } from '../../src/types/config.ts';

Deno.test('LocalNet.fromConfig accepts a config object', async () => {
  const config = createMinimalConfig(2);
  const net = await LocalNet.fromConfig(config, {
    instanceId: 't-cfg-' + Date.now(),
  });

  assert(net instanceof LocalNet);
  assertEquals(net.getConfig().validators, 2);
});

Deno.test('LocalNet.fromConfig accepts a YAML file path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'localnet-test-'));
  const yaml = `version: "1.0"
validators: 2
auth:
  keycloak:
    admin: admin
    password: admin
`;
  const path = join(dir, 'localnet.yaml');
  await writeFile(path, yaml, 'utf-8');

  const net = await LocalNet.fromConfig(path, {
    instanceId: 't-yaml-' + Date.now(),
  });

  assert(net instanceof LocalNet);
  assertEquals(net.getConfig().validators, 2);
});

Deno.test('LocalNet - tier 1: getConfig() and instanceId work without running instance', () => {
  const config = createMinimalConfig(2);
  const id = 't-tier1-' + Date.now();
  const net = new LocalNet(config, { instanceId: id });

  assertEquals(net.instanceId, id);
  assertExists(net.getConfig());
  assertEquals(net.getConfig().validators, 2);
});

Deno.test('LocalNet - tier 1: getCantonClient(sv) returns a client (eager construction)', () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-tier1-canton-' + Date.now(),
  });

  const svClient = net.getCantonClient('sv');
  assertExists(svClient);

  const v1Client = net.getCantonClient('validator-1');
  assertExists(v1Client);
});

Deno.test('LocalNet - tier 3: getParties() rejects with "is not running" when not running', async () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-tier3-parties-' + Date.now(),
  });

  await assertRejects(
    () => net.getParties(),
    Error,
    'is not running',
  );
});

Deno.test('LocalNet - tier 3: getParties(\'nope\') rejects with "is not running" when not running', async () => {
  const net = new LocalNet(createMinimalConfig(2), {
    instanceId: 't-tier3-parties-named-' + Date.now(),
  });

  await assertRejects(
    () => net.getParties('nope'),
    Error,
    'is not running',
  );
});

Deno.test('LocalNet - tier 3: getCredentials() rejects with "is not running" when not running', async () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-tier3-creds-' + Date.now(),
  });

  await assertRejects(
    () => net.getCredentials(),
    Error,
    'is not running',
  );
});

Deno.test('LocalNet has createUser method with the expected signature', () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-createuser-sig-' + Date.now(),
  });

  assertEquals(typeof net.createUser, 'function');
  assertEquals(net.createUser.length, 3);
});

Deno.test('LocalNet - tier 3: createUser is Tier 3 guarded', async () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-tier3-createuser-' + Date.now(),
  });

  await assertRejects(
    () => net.createUser('alice', 'validator-1'),
    Error,
    'is not running',
  );
});

Deno.test('LocalNet - createUser rejects a non-lowercase user id', async () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-createuser-case-' + Date.now(),
  });

  await assertRejects(
    () => net.createUser('Alice', 'validator-1'),
    Error,
    "User id 'Alice' must be lowercase (Keycloak lowercases usernames); use 'alice'",
  );
});

Deno.test('LocalNet - createUser accepts UserConfig-shaped options', async () => {
  const config = createMinimalConfig(2);
  const net = new LocalNet(config, {
    instanceId: 't-createuser-opts-' + Date.now(),
  });

  const options: {
    primaryParty?: string;
    rights?: UserRight[];
    parties?: Array<{ hint: string; rights?: PerPartyRight[] }>;
  } = {
    primaryParty: 'alice',
    rights: ['ParticipantAdmin'],
    parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
  };

  await assertRejects(
    () => net.createUser('alice', 'validator-1', options),
    Error,
    'is not running',
  );
});

// --- the constructor validates ---

Deno.test('LocalNet constructor - a too-long validator name throws ZodError', () => {
  assertThrows(
    () =>
      new LocalNet({
        validators: [{ name: 'a-very-long-validator-name' }],
        auth: { keycloak: { admin: 'a', password: 'b' } },
      }),
    ZodError,
  );
});

Deno.test('LocalNet constructor - applies defaults and returns a normalized copy', () => {
  const input: LocalNetConfig = {
    validators: 1,
    auth: { keycloak: { admin: 'a', password: 'b' } },
  };
  const net = new LocalNet(input);
  assertEquals(net.getConfig().basePort, 5000);
  assertEquals(input.basePort, undefined);
  assert(net.getConfig() !== input);
});

Deno.test('createLocalNet - an invalid config rejects before touching Docker', async () => {
  await assertRejects(
    () =>
      createLocalNet({
        validators: [{ name: 'a' }, { name: 'A' }],
        auth: { keycloak: { admin: 'a', password: 'b' } },
      }),
    ZodError,
  );
});

Deno.test('LocalNet.warnings - holds construction-time config warnings only', () => {
  const seen: string[] = [];
  const widened: Record<string, unknown> = {
    validators: 1,
    auth: { keycloak: { admin: 'a', password: 'b' } },
    typo: 1,
  };
  const net = new LocalNet(widened as unknown as LocalNetConfig, {
    onWarning: (w) => seen.push(w.message),
  });
  assertEquals(net.warnings.length, 1);
  assertEquals(seen.length, 1);
  // A runtime warning is delivered to onWarning but never stored.
  Reflect.get(net, 'warn').call(net, { source: 'query', message: 'late' });
  assertEquals(seen.length, 2);
  assertEquals(net.warnings.length, 1);
});

Deno.test('LocalNet.fromConfig - a clean config produces no warnings', async () => {
  const warnings: string[] = [];
  const net = await LocalNet.fromConfig(createMinimalConfig(1), {
    onWarning: (w) => warnings.push(w.message),
  });
  assertEquals(net.warnings, []);
  assertEquals(warnings, []);
});

Deno.test('LocalNet.fromInstanceId - stored configs are not re-validated', async () => {
  const original = DockerClient.prototype.listContainers;
  const stored = [
    { validators: [{ name: 'a' }, { name: 'A' }], basePort: 5000 },
    { validators: 55, basePort: 60000 },
  ];
  try {
    for (const config of stored) {
      DockerClient.prototype.listContainers = () =>
        Promise.resolve([{
          id: 'c1',
          name: 'legacy-splice',
          state: 'running' as const,
          status: 'Up',
          image: 'img',
          ports: [],
          labels: {
            'denex.localnet.schema': '2',
            'denex.localnet.config': JSON.stringify({
              ...config,
              auth: { keycloak: { admin: 'a', password: 'b' } },
            }),
          },
        }]);
      const net = await LocalNet.fromInstanceId('legacy');
      assertEquals(net.getConfig().validators, config.validators);
      assertEquals(net.warnings, []);
    }
  } finally {
    DockerClient.prototype.listContainers = original;
  }
});
