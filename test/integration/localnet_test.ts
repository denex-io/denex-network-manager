import { LABEL_INSTANCE } from '../../src/api/discovery-utils.ts';
import { assertEquals, assertExists, assertRejects } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
  testConfig,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import { StartupTimeoutError } from '../../src/errors.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

// Config for fast lifecycle tests
const LIFECYCLE_TEST_CONFIG: LocalNetConfig = testConfig({
  validators: 1,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
});

// ============================================================================
// LIFECYCLE TESTS
// These tests verify the LocalNet state machine (start/stop/destroy/restart).
// They use skipHealthChecks for speed - they do NOT verify services work.
// ============================================================================

Deno.test({
  name: 'Lifecycle: constructor initializes with stopped state',
  ignore: !(await isDockerAvailable()),
  fn() {
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    assertEquals(localnet.instanceId, instanceId);
    assertEquals(localnet.currentState, 'stopped');
  },
});

Deno.test({
  name: 'Lifecycle: start throws if Docker is unavailable',
  ignore: await isDockerAvailable(),
  async fn() {
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    await assertRejects(
      () => localnet.start(),
      Error,
      'Docker daemon is not available',
    );
  },
});

Deno.test({
  name: 'Lifecycle: stop transitions containers to exited state',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, skipInitialization: true });
      assertEquals(localnet.currentState, 'running');

      await localnet.stop();
      assertEquals(localnet.currentState, 'stopped');

      const status = await localnet.status();
      for (const container of status.containers) {
        assertEquals(container.state === 'running', false);
      }
    } finally {
      await localnet.destroy();
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Lifecycle: destroy removes all containers and volumes',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, skipInitialization: true });
      await localnet.destroy({ removeVolumes: true });

      const containersAfter = await client.listContainers({
        [LABEL_INSTANCE]: instanceId,
      });
      assertEquals(containersAfter.length, 0);

      const volumesAfter = await client.listVolumes({
        [LABEL_INSTANCE]: instanceId,
      });
      assertEquals(volumesAfter.length, 0);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Lifecycle: restart preserves container count',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, skipInitialization: true });
      const initialStatus = await localnet.status();
      const initialContainerCount = initialStatus.containers.length;

      await localnet.restart({ skipHealthChecks: true, skipInitialization: true });

      assertEquals(localnet.currentState, 'running');

      const afterRestartStatus = await localnet.status();
      assertEquals(afterRestartStatus.containers.length, initialContainerCount);
    } finally {
      await localnet.destroy();
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Lifecycle: config is delivered via env vars, not host files',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    // Run from a scratch cwd so we can assert nothing is written there.
    const originalCwd = Deno.cwd();
    const scratchCwd = await Deno.makeTempDir({ prefix: 'localnet-cwd-' });
    Deno.chdir(scratchCwd);

    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, skipInitialization: true });

      // No `.localnet` directory should be created in the working directory.
      const localnetDirExists = await Deno.stat(`${scratchCwd}/.localnet`)
        .then(() => true)
        .catch(() => false);
      assertEquals(localnetDirExists, false, '.localnet must not be written to the host');

      // Config reaches canton via the ADDITIONAL_CONFIG_LOCALNET env var.
      const cantonInfo = await client.getContainerInfo(`${instanceId}-canton`);
      assertEquals(cantonInfo !== null, true);
      const inspected = await new Deno.Command('docker', {
        args: ['inspect', '--format', '{{json .Config.Env}}', `${instanceId}-canton`],
        stdout: 'piped',
      }).output();
      const env: string[] = JSON.parse(new TextDecoder().decode(inspected.stdout));
      assertEquals(
        env.some((e) => e.startsWith('ADDITIONAL_CONFIG_LOCALNET=')),
        true,
        'canton should receive its config via ADDITIONAL_CONFIG_LOCALNET',
      );
    } finally {
      await localnet.destroy();
      await cleanupTestResources(client, instanceId);
      Deno.chdir(originalCwd);
      await Deno.remove(scratchCwd, { recursive: true }).catch(() => {});
    }
  },
});

// ============================================================================
// UNIT-STYLE TESTS (no Docker required)
// ============================================================================

Deno.test({
  name: 'Unit: getConfig returns the original config',
  fn() {
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    const config = localnet.getConfig();
    assertEquals(config.validators, 1);
    assertEquals(config.auth.keycloak.admin, 'admin');
  },
});

Deno.test({
  name: 'Unit: getOptions returns merged options with defaults',
  fn() {
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, {
      instanceId,
      dbUser: 'custom-user',
    });

    const options = localnet.getOptions();
    assertEquals(options.instanceId, instanceId);
    assertEquals(options.dbUser, 'custom-user');
    assertEquals(options.dbPassword, 'supersafe');
  },
});

// ============================================================================
// START ROLLBACK TESTS
// A failed start undoes only what that call did. basePort 21000 is dedicated
// to these tests (see agents/testing.md for the port convention).
// ============================================================================

Deno.test({
  name: 'Lifecycle: failed resume keeps containers, network and volume',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const config: LocalNetConfig = { ...LIFECYCLE_TEST_CONFIG, basePort: 21000 };
    const first = new LocalNet(config, { instanceId });

    try {
      await first.start({ skipHealthChecks: true, skipInitialization: true });
      await first.stop();

      const before = await client.listContainers({ 'denex.localnet.instance': instanceId });
      const idsBefore = before.map((c) => c.id).sort();
      assertEquals(idsBefore.length > 0, true);

      const resumed = new LocalNet(config, { instanceId });
      // A 1 ms timeout is the point of this test: the resume must fail on it and change nothing.
      const err = await assertRejects(
        () => resumed.start({ skipHealthChecks: true, skipInitialization: true, timeout: 1 }),
        StartupTimeoutError,
      );
      assertEquals(err.phase, 'start');

      const after = await client.listContainers({ 'denex.localnet.instance': instanceId });
      assertEquals(after.map((c) => c.id).sort(), idsBefore);
      assertEquals(after.some((c) => c.state === 'running'), false);
      assertExists(await client.getNetworkInfo(`denex.localnet-${instanceId}`));
      assertExists(await client.getVolumeInfo(`${instanceId}-postgres-data`));
    } finally {
      await first.destroy().catch(() => {});
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Lifecycle: failed fresh start leaves nothing behind',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    // An unpullable splice image fails the start after postgres and canton exist.
    const localnet = new LocalNet(
      { ...LIFECYCLE_TEST_CONFIG, basePort: 22000 },
      { instanceId, images: { splice: 'localhost/denex-does-not-exist:0' } },
    );

    try {
      await assertRejects(() =>
        localnet.start({ skipHealthChecks: true, skipInitialization: true })
      );

      const containers = await client.listContainers({ 'denex.localnet.instance': instanceId });
      assertEquals(containers.length, 0);
      // findNetwork/findVolume rethrow daemon errors; getNetworkInfo/getVolumeInfo
      // return null on any error and would hide a daemon hiccup.
      assertEquals(await client.findNetwork(`denex.localnet-${instanceId}`), null);
      assertEquals(await client.findVolume(`${instanceId}-postgres-data`), null);
    } finally {
      await localnet.destroy({ removeVolumes: true }).catch(() => {});
      await cleanupTestResources(client, instanceId);
    }
  },
});

// ============================================================================
// REPAIR TEST
// basePort 21000 is shared with the rollback test above; tests run one at a time.
// ============================================================================

Deno.test({
  name: 'Lifecycle: start() repairs a partially running instance',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const config: LocalNetConfig = { ...LIFECYCLE_TEST_CONFIG, basePort: 21000 };
    const first = new LocalNet(config, { instanceId });
    const webUiName = `${instanceId}-sv-web-ui`;

    try {
      await first.start({ skipHealthChecks: true, skipInitialization: true });
      const before = await client.getContainerInfo(webUiName);
      assertExists(before);
      await client.stopContainer(before.id, 5);
      // state() reads Docker's list API, which can still show a container as running for a few
      // milliseconds after its stop returned: moby v28.0.4 wakes the stop call before it updates the
      // list's view (daemon/monitor.go:120-130). Wait that out, bounded; any other state is final.
      const listDeadline = Date.now() + 10_000;
      let seen = await first.state();
      while (seen === 'running' && Date.now() < listDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        seen = await first.state();
      }
      if (seen === 'running') {
        throw new Error(`state() was still 'running' 10 s after ${webUiName} was stopped`);
      }
      assertEquals(seen, 'partial');

      const second = new LocalNet(config, { instanceId });
      await second.start({ skipHealthChecks: true, skipInitialization: true });

      const after = await client.getContainerInfo(webUiName);
      assertExists(after);
      assertEquals(after.id, before.id);
      assertEquals(after.state, 'running');
      assertEquals(await second.state(), 'running');
    } finally {
      await first.destroy().catch(() => {});
      await cleanupTestResources(client, instanceId);
    }
  },
});
