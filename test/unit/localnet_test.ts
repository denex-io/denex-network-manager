import { assert, assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';
import { ZodError } from 'zod';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DockerClient } from '../../src/docker/client.ts';
import {
  assertPackageFilesExist,
  createLocalNet,
  LocalNet,
  resolvePackages,
} from '../../src/localnet.ts';
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

function packagesConfig(): LocalNetConfig {
  const config = createMinimalConfig(2);
  config.packages = [
    { name: 'rel', dar: 'dars/app.dar' },
    { name: 'abs', dar: '/abs/other.dar', uploadTo: ['validator-2'] },
  ];
  return config;
}

Deno.test('resolvePackages - resolves relative dar against configDir and defaults targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pkg-resolve-'));
  const configDir = join(root, 'nested', 'cfg');
  await mkdir(configDir, { recursive: true });
  const config = packagesConfig();
  const resolved = await resolvePackages(config, configDir);
  assertEquals(resolved, [
    {
      name: 'rel',
      dar: join(configDir, 'dars/app.dar'),
      targets: ['sv', 'validator-1', 'validator-2'],
    },
    { name: 'abs', dar: '/abs/other.dar', targets: ['validator-2'] },
  ]);
  // The config itself is untouched.
  assertEquals(config.packages?.[0], { name: 'rel', dar: 'dars/app.dar' });
});

Deno.test('resolvePackages - falls back to the current directory when not found in configDir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pkg-cwd-'));
  const cwdDar = resolve('dars-p8-fallback.dar');
  await writeFile(cwdDar, 'x');
  try {
    const config = createMinimalConfig(1);
    config.packages = [{ name: 'p', dar: 'dars-p8-fallback.dar' }];
    const [fromFallback] = await resolvePackages(config, join(root, 'empty'));
    assertEquals(fromFallback.dar, cwdDar);
    // Found in configDir: configDir wins.
    await writeFile(join(root, 'dars-p8-fallback.dar'), 'y');
    const [primary] = await resolvePackages(config, root);
    assertEquals(primary.dar, join(root, 'dars-p8-fallback.dar'));
    // No configDir: current directory.
    const [noDir] = await resolvePackages(config);
    assertEquals(noDir.dar, cwdDar);
  } finally {
    await Deno.remove(cwdDar);
  }
});

Deno.test('assertPackageFilesExist - names each missing DAR', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pkg-exist-'));
  await writeFile(join(dir, 'ok.dar'), 'x');
  await assertPackageFilesExist([{ name: 'ok', dar: join(dir, 'ok.dar'), targets: ['sv'] }]);
  const err = await assertRejects(() =>
    assertPackageFilesExist([
      { name: 'ok', dar: join(dir, 'ok.dar'), targets: ['sv'] },
      { name: 'gone', dar: join(dir, 'gone.dar'), targets: ['sv'] },
    ])
  );
  assert(err instanceof Error);
  assert(err.message.includes("Package 'gone'"));
  assert(err.message.includes(join(dir, 'gone.dar')));
  assertEquals(err.message.includes("'ok'"), false);
});

Deno.test('LocalNet.fromConfig - a YAML path sets configDir to the file directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cfgdir-'));
  const path = join(dir, 'localnet.yaml');
  await writeFile(
    path,
    'version: "1.0"\nvalidators: 1\nauth:\n  keycloak:\n    admin: a\n    password: b\n',
  );
  const net = await LocalNet.fromConfig(path);
  assertEquals(net.getOptions().configDir, dirname(resolve(path)));
  const obj = await LocalNet.fromConfig(createMinimalConfig(1));
  assertEquals(obj.getOptions().configDir, undefined);
});

Deno.test('LocalNet.fromInstanceId - reads configDir from the config-dir label', async () => {
  const original = DockerClient.prototype.listContainers;
  try {
    for (const label of ['/the/dir', undefined]) {
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
              validators: 1,
              auth: { keycloak: { admin: 'a', password: 'b' } },
              // Stored labels are not checked against the input-only package rules.
              packages: [
                { name: 'p', dar: 'x.dar', uploadTo: [] },
                { name: 'q', dar: 'y.dar', uploadTo: ['nope'] },
              ],
            }),
            ...(label ? { 'denex.localnet.config-dir': label } : {}),
          },
        }]);
      const net = await LocalNet.fromInstanceId('legacy');
      assertEquals(net.getOptions().configDir, label);
      assertEquals(net.getConfig().packages?.length, 2);
    }
  } finally {
    DockerClient.prototype.listContainers = original;
// --- logs() / exec() container resolution (#22, #23) ---

interface FakeLogsExecClient {
  listContainers(
    labels?: Record<string, string>,
  ): Promise<{ id: string; name: string; state: string }[]>;
  getContainerLogs(id: string, options?: unknown): Promise<ReadableStream<Uint8Array>>;
  execInContainer(
    id: string,
    cmd: string[],
  ): Promise<{ exitCode: number; output: string; stdout: string; stderr: string }>;
}

function makeNetWithFakeDocker(instanceId: string) {
  const net = new LocalNet(createMinimalConfig(1), { instanceId });
  const calls = {
    list: [] as (Record<string, string> | undefined)[],
    logs: [] as string[],
    exec: [] as string[],
  };
  const fake: FakeLogsExecClient = {
    listContainers: (labels) => {
      calls.list.push(labels);
      return Promise.resolve([
        { id: 'id-splice', name: `${instanceId}-splice`, state: 'running' },
        { id: 'id-postgres', name: `${instanceId}-postgres`, state: 'running' },
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

  // The lookup is confined to this instance by label.
  assert(calls.list.some((l) => l?.['denex.localnet.instance'] === 't-res'));
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
