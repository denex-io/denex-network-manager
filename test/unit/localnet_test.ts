import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNet } from '../../src/localnet.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';
import type { UserRight, PerPartyRight } from '../../src/types/config.ts';

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
