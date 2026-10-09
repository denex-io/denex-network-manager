import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNet } from '../../src/localnet.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';
import { parseLocalNetConfig } from '../../src/schemas/mod.ts';
import type { PerPartyRight, UserRight } from '../../src/types/config.ts';

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

// --- logs() / exec() container resolution (#22, #23) ---

interface FakeLogsExecClient {
  listContainers(
    labels?: Record<string, string>,
  ): Promise<{ id: string; name: string; state: string; labels?: Record<string, string> }[]>;
  getContainerLogs(id: string, options?: unknown): Promise<ReadableStream<Uint8Array>>;
  execInContainer(
    id: string,
    cmd: string[],
  ): Promise<{ exitCode: number; output: string; stdout: string; stderr: string }>;
}

const ALL_CONTAINER_SUFFIXES = [
  'postgres',
  'canton',
  'keycloak',
  'splice',
  'wallet-web-ui-sv',
  'wallet-web-ui-validator-1',
  'sv-web-ui',
  'scan-web-ui',
  'nginx',
];

/** `allExpected`: list every container a one-validator instance has (for start()). */
function makeNetWithFakeDocker(instanceId: string, allExpected = false) {
  const net = new LocalNet(createMinimalConfig(1), { instanceId });
  const calls = {
    list: [] as (Record<string, string> | undefined)[],
    logs: [] as string[],
    exec: [] as string[],
  };
  const fake: FakeLogsExecClient = {
    listContainers: (labels) => {
      calls.list.push(labels);
      // start() compares the running config label against its own, so carry it.
      const configLabels = {
        'denex.localnet.config': JSON.stringify(parseLocalNetConfig(net.getConfig())),
      };
      const suffixes = allExpected ? ALL_CONTAINER_SUFFIXES : ['splice', 'postgres'];
      const all = suffixes.map((s) => ({
        id: `id-${s}`,
        name: `${instanceId}-${s}`,
        state: 'running',
        labels: configLabels,
      }));
      // Honour the instance filter; an unfiltered call also sees another instance.
      if (labels?.['denex.localnet.instance'] === instanceId) return Promise.resolve(all);
      return Promise.resolve([
        ...all,
        { id: 'id-other', name: 'other-splice', state: 'running' },
      ]);
    },
    getContainerLogs: (id) => {
      calls.logs.push(id);
      return Promise.resolve(new ReadableStream<Uint8Array>());
    },
    execInContainer: (id) => {
      calls.exec.push(id);
      return Promise.resolve({ exitCode: 0, output: 'o', stdout: 'o', stderr: '' });
    },
  };
  (net as unknown as { client: FakeLogsExecClient }).client = fake;
  return { net, calls };
}

Deno.test('LocalNet.logs/exec resolve by runtime name on an implicitly attached handle', async () => {
  const { net, calls } = makeNetWithFakeDocker('t-res');
  // Never started or built with fromInstanceId: containerIds is empty and the
  // handle attaches through requireRunning's auto-detect.
  assertEquals(net.getContainerId('t-res-splice'), undefined);

  await net.logs('t-res-splice');
  assertEquals(calls.logs, ['id-splice']);

  const result = await net.exec('t-res-postgres', ['true']);
  assertEquals(calls.exec, ['id-postgres']);
  assertEquals(result.stdout, 'o');
  assertEquals(result.stderr, '');

  // The lookup is confined to this instance by label: every call carries it.
  assert(calls.list.length > 0);
  assert(calls.list.every((l) => l?.['denex.localnet.instance'] === 't-res'));
});

Deno.test('LocalNet.logs/exec reject unknown names and list the instance containers', async () => {
  const { net } = makeNetWithFakeDocker('t-unk');
  for (const name of ['other-splice', 'splice']) {
    for (const call of [() => net.logs(name), () => net.exec(name, ['true'])]) {
      const err = await assertRejects(call);
      const msg = String(err);
      assert(msg.includes(`Container ${name} not found`), msg);
      assert(msg.includes('t-unk-postgres, t-unk-splice'), msg);
    }
  }
});

Deno.test('LocalNet.logs/exec resolve by runtime name after start() returns early on a running instance', async () => {
  const { net, calls } = makeNetWithFakeDocker('t-early', true);
  // All containers already run: start() attaches and returns without creating anything.
  await net.start();
  assertEquals(net.getContainerId('t-early-splice'), undefined);

  await net.logs('t-early-splice');
  const result = await net.exec('t-early-postgres', ['true']);
  assertEquals(calls.logs, ['id-splice']);
  assertEquals(calls.exec, ['id-postgres']);
  assertEquals(result.exitCode, 0);
});
