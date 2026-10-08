import { assert, assertEquals, assertRejects } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { NetworkManager } from '../../src/docker/network.ts';
import type { DockerClient } from '../../src/docker/client.ts';
import type {
  ContainerInfo,
  ContainerSpec,
  NetworkInfo,
  VolumeInfo,
} from '../../src/docker/types.ts';
import { parseLocalNetConfig } from '../../src/schemas/localnet-config.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';

// Fake-Docker tests for start() rollback. The dedicated basePort keeps these
// clear of the integration ranges (see agents/testing.md).
const BASE_PORT = 41000;
const ID = 'rbtest';
const VOLUME = `${ID}-postgres-data`;

const LAYER_1 = [`${ID}-postgres`];
const LAYER_2 = [`${ID}-canton`, `${ID}-keycloak`];
const LAYER_3 = [`${ID}-splice`];
const LAYER_4 = [
  `${ID}-nginx`,
  `${ID}-wallet-web-ui-sv`,
  `${ID}-wallet-web-ui-validator-1`,
  `${ID}-sv-web-ui`,
  `${ID}-scan-web-ui`,
];
const ALL_NAMES = [...LAYER_1, ...LAYER_2, ...LAYER_3, ...LAYER_4];

const MUTATING = [
  'createNetwork',
  'removeNetwork',
  'createVolume',
  'removeVolume',
  'createContainer',
  'startContainer',
  'stopContainer',
  'removeContainer',
];

/** Records every Docker call; only the methods start() touches are implemented. */
class FakeDockerClient {
  calls: string[] = [];
  containers = new Map<string, { id: string; state: 'running' | 'exited' }>();
  networkExists = false;
  volumeExists = false;
  failStart = new Set<string>();
  failCreate = new Set<string>();
  findNetworkError: Error | null = null;
  /** createContainer for these names waits on the given promise. */
  latch = new Map<string, Promise<void>>();
  private configJson = '';

  constructor(private labelPrefix: string) {}

  setConfig(json: string) {
    this.configJson = json;
  }

  /** Mutating calls only, as "method:arg". */
  get mutations(): string[] {
    return this.calls.filter((c) => MUTATING.some((m) => c.startsWith(`${m}:`)));
  }

  seedExisting(names: string[], state: 'running' | 'exited' = 'exited') {
    for (const n of names) this.containers.set(n, { id: `old-${n}`, state });
    this.networkExists = true;
    this.volumeExists = true;
  }

  private info(name: string, c: { id: string; state: 'running' | 'exited' }): ContainerInfo {
    return {
      id: c.id,
      name,
      state: c.state,
      status: c.state,
      image: 'img',
      ports: [],
      health: 'healthy',
      labels: {
        [`${this.labelPrefix}.instance`]: ID,
        [`${this.labelPrefix}.config`]: this.configJson,
      },
    };
  }

  private find(idOrName: string) {
    for (const [name, c] of this.containers) {
      if (name === idOrName || c.id === idOrName) return { name, c };
    }
    return null;
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  listContainers(): Promise<ContainerInfo[]> {
    return Promise.resolve([...this.containers].map(([n, c]) => this.info(n, c)));
  }

  getContainerInfo(idOrName: string): Promise<ContainerInfo | null> {
    const f = this.find(idOrName);
    return Promise.resolve(f ? this.info(f.name, f.c) : null);
  }

  imageExists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  pullImage(): Promise<void> {
    return Promise.resolve();
  }

  async createContainer(spec: ContainerSpec): Promise<string> {
    const gate = this.latch.get(spec.name);
    if (gate) await gate;
    if (this.failCreate.has(spec.name)) throw new Error(`create failed: ${spec.name}`);
    const id = `new-${spec.name}`;
    this.containers.set(spec.name, { id, state: 'exited' });
    this.calls.push(`createContainer:${spec.name}`);
    return id;
  }

  startContainer(idOrName: string): Promise<void> {
    const f = this.find(idOrName);
    if (f && this.failStart.has(f.name)) {
      return Promise.reject(new Error(`start failed: ${f.name}`));
    }
    if (f) f.c.state = 'running';
    this.calls.push(`startContainer:${idOrName}`);
    return Promise.resolve();
  }

  stopContainer(idOrName: string): Promise<void> {
    const f = this.find(idOrName);
    if (f) f.c.state = 'exited';
    this.calls.push(`stopContainer:${idOrName}`);
    return Promise.resolve();
  }

  removeContainer(idOrName: string): Promise<void> {
    const f = this.find(idOrName);
    if (f) this.containers.delete(f.name);
    this.calls.push(`removeContainer:${idOrName}`);
    return Promise.resolve();
  }

  findNetwork(name: string): Promise<NetworkInfo | null> {
    if (this.findNetworkError) return Promise.reject(this.findNetworkError);
    return Promise.resolve(
      this.networkExists
        ? { id: `net-${name}`, name, driver: 'bridge', scope: 'local', containers: [] }
        : null,
    );
  }

  getNetworkInfo(name: string): Promise<NetworkInfo | null> {
    return this.findNetwork(name).catch(() => null);
  }

  createNetwork(name: string): Promise<string> {
    this.networkExists = true;
    this.calls.push(`createNetwork:${name}`);
    return Promise.resolve(`net-${name}`);
  }

  removeNetwork(name: string): Promise<void> {
    this.networkExists = false;
    this.calls.push(`removeNetwork:${name}`);
    return Promise.resolve();
  }

  findVolume(name: string): Promise<VolumeInfo | null> {
    return Promise.resolve(
      this.volumeExists ? { name, driver: 'local', mountpoint: '/x' } : null,
    );
  }

  createVolume(name: string): Promise<string> {
    this.volumeExists = true;
    this.calls.push(`createVolume:${name}`);
    return Promise.resolve(name);
  }

  removeVolume(name: string): Promise<void> {
    this.volumeExists = false;
    this.calls.push(`removeVolume:${name}`);
    return Promise.resolve();
  }

  listVolumes(): Promise<VolumeInfo[]> {
    return Promise.resolve([]);
  }
}

async function withFakeNet(
  fn: (net: LocalNet, fake: FakeDockerClient) => Promise<void>,
): Promise<void> {
  // Keycloak bootstrap-admin cleanup runs after a successful start; never let
  // it reach a real server.
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('fetch is stubbed in this test'));
  try {
    const config = createMinimalConfig(1);
    config.basePort = BASE_PORT;
    const net = await LocalNet.fromConfig(config, { instanceId: ID });
    const prefix = net.getOptions().labelPrefix;
    const fake = new FakeDockerClient(prefix);
    fake.setConfig(JSON.stringify(parseLocalNetConfig(net.getConfig())));
    const client = fake as unknown as DockerClient;
    Reflect.set(net, 'client', client);
    Reflect.set(net, 'networkManager', new NetworkManager(client, { prefix }));
    await fn(net, fake);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const START = { skipHealthChecks: true, skipInitialization: true } as const;

Deno.test('start rollback - failed resume (timeout) removes and stops nothing', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    await assertRejects(() => net.start({ ...START, timeout: -1 }), Error, 'Startup timeout');
    assertEquals(fake.mutations, []);
    assertEquals(fake.containers.size, ALL_NAMES.length);
    assert(fake.networkExists && fake.volumeExists);
  });
});

Deno.test('start rollback - failure in a later layer stops resumed containers, removes nothing', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    assertEquals(fake.mutations.filter((m) => m.startsWith('remove')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('create')), []);
    const stops = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    assertEquals(
      stops.sort(),
      [...LAYER_1, ...LAYER_2].map((n) => `stopContainer:old-${n}`).sort(),
    );
    // Dependents are stopped before their dependencies.
    const order = fake.mutations.filter((m) => m.startsWith('stopContainer:'));
    assert(order.indexOf(`stopContainer:old-${ID}-postgres`) === order.length - 1);
    for (const n of ALL_NAMES) assert(fake.containers.has(n), `${n} must still exist`);
    assert(fake.networkExists && fake.volumeExists);
    assertEquals(net.currentState, 'stopped');
  });
});

Deno.test('start rollback - failed fresh start removes containers, network and volume', async () => {
  await withFakeNet(async (net, fake) => {
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    assertEquals(fake.containers.size, 0);
    assertEquals(fake.networkExists, false);
    assertEquals(fake.volumeExists, false);
    assert(fake.mutations.some((m) => m.startsWith('createNetwork:')));
    assert(fake.mutations.includes(`removeVolume:${VOLUME}`));
    assertEquals(net.getContainerId(`${ID}-postgres`), undefined);
  });
});

Deno.test('start rollback - existing network and volume without containers are kept', async () => {
  await withFakeNet(async (net, fake) => {
    fake.networkExists = true;
    fake.volumeExists = true;
    fake.failStart.add(`${ID}-splice`);
    await assertRejects(() => net.start(START), Error, 'start failed');

    assertEquals(fake.containers.size, 0);
    assert(fake.networkExists && fake.volumeExists);
    assertEquals(fake.mutations.filter((m) => m.startsWith('createNetwork')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('createVolume')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('removeNetwork')), []);
    assertEquals(fake.mutations.filter((m) => m.startsWith('removeVolume')), []);
  });
});

Deno.test('start rollback - a failing sibling never races a still-creating one', async () => {
  await withFakeNet(async (net, fake) => {
    let release!: () => void;
    fake.latch.set(`${ID}-sv-web-ui`, new Promise<void>((r) => (release = r)));
    fake.failCreate.add(`${ID}-nginx`);
    setTimeout(() => release(), 50);

    await assertRejects(() => net.start(START), Error, 'create failed');

    // The latched sibling finished its create before rollback began, so it was
    // removed with everything else and nothing was created after a removal.
    assertEquals(fake.containers.size, 0);
    const firstRemoval = fake.mutations.findIndex((m) => m.startsWith('removeContainer:'));
    assert(firstRemoval >= 0);
    const late = fake.mutations.slice(firstRemoval).filter((m) =>
      m.startsWith('createContainer:') || m.startsWith('startContainer:')
    );
    assertEquals(late, []);
    assert(fake.mutations.includes(`removeContainer:new-${ID}-sv-web-ui`));
  });
});

Deno.test('start rollback - a non-404 inspect error removes no network or volume', async () => {
  await withFakeNet(async (net, fake) => {
    fake.seedExisting(ALL_NAMES);
    fake.findNetworkError = new Error('docker daemon exploded');
    await assertRejects(() => net.start(START), Error, 'docker daemon exploded');
    assertEquals(fake.mutations, []);
    assert(fake.networkExists && fake.volumeExists);
  });
});
