import { assertEquals, assertExists, assertRejects } from '@std/assert';
import {
  createTestDockerClient,
  generateTestInstanceId,
  cleanupTestResources,
  isDockerAvailable,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { waitForHealthy } from '../../src/docker/health.ts';

// Config for fast lifecycle tests
const LIFECYCLE_TEST_CONFIG: LocalNetConfig = {
  validators: 1,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

// Config for full end-to-end test
const E2E_TEST_CONFIG: LocalNetConfig = {
  validators: 1,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

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
  name: 'Lifecycle: start throws if already running',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, timeout: 60000 });

      await assertRejects(
        () => localnet.start(),
        Error,
        'LocalNet is already running',
      );
    } finally {
      await localnet.destroy();
      await cleanupTestResources(client, instanceId);
    }
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
      await localnet.start({ skipHealthChecks: true, timeout: 60000 });
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
      await localnet.start({ skipHealthChecks: true, timeout: 60000 });
      await localnet.destroy({ removeVolumes: true });

      const containersAfter = await client.listContainers({
        'localnet.instance': instanceId,
      });
      assertEquals(containersAfter.length, 0);

      const volumesAfter = await client.listVolumes({
        'localnet.instance': instanceId,
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
      await localnet.start({ skipHealthChecks: true, timeout: 60000 });
      const initialStatus = await localnet.status();
      const initialContainerCount = initialStatus.containers.length;

      await localnet.restart({ skipHealthChecks: true, timeout: 60000 });

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
  name: 'Lifecycle: config files are generated on start',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const configDir = `/tmp/${instanceId}/config`;
    const dataDir = `/tmp/${instanceId}/data`;

    const localnet = new LocalNet(LIFECYCLE_TEST_CONFIG, {
      instanceId,
      configDir,
      dataDir,
    });

    try {
      await localnet.start({ skipHealthChecks: true, timeout: 60000 });

      const cantonConfigExists = await Deno.stat(`${configDir}/canton/app.conf`)
        .then(() => true)
        .catch(() => false);
      assertEquals(cantonConfigExists, true);

      const spliceConfigExists = await Deno.stat(`${configDir}/splice/app.conf`)
        .then(() => true)
        .catch(() => false);
      assertEquals(spliceConfigExists, true);

      const envFileExists = await Deno.stat(`${configDir}/.env`)
        .then(() => true)
        .catch(() => false);
      assertEquals(envFileExists, true);
    } finally {
      await localnet.destroy();
      await cleanupTestResources(client, instanceId);
      await Deno.remove(`/tmp/${instanceId}`, { recursive: true }).catch(() => {});
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
// END-TO-END TEST
// This test verifies that a LocalNet actually works:
// - Uses oauth2 mode (production-like)
// - Waits for health checks (services actually ready)
// - Verifies APIs respond
// ============================================================================

Deno.test({
  name: 'E2E: Full LocalNet starts and APIs respond',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(E2E_TEST_CONFIG, { instanceId });

    try {
      // Start WITHOUT skipHealthChecks - wait for everything to be ready
      await localnet.start({ timeout: 300000 });

      // Verify state
      const status = await localnet.status();
      assertEquals(status.state, 'running', 'LocalNet should be in running state');
      assertExists(status.network, 'Network should exist');

      // Verify all containers are running and healthy
      for (const container of status.containers) {
        assertEquals(
          container.state,
          'running',
          `Container ${container.name} should be running, got ${container.state}`,
        );
        if (container.health && container.health !== 'none') {
          assertEquals(
            container.health,
            'healthy',
            `Container ${container.name} should be healthy, got ${container.health}`,
          );
        }
      }

      // Verify Keycloak is responding (oauth2 mode)
      const keycloakHealth = await waitForHealthy(
        { type: 'http', target: 'http://localhost:8082/health/ready' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(keycloakHealth.healthy, true, 'Keycloak should be healthy');

      // Verify Canton JSON API is responding (SV)
      const svJsonApiHealth = await waitForHealthy(
        { type: 'http', target: 'http://localhost:4975/livez' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(svJsonApiHealth.healthy, true, 'SV JSON API should be healthy');

      // Verify Canton JSON API is responding (Validator 1)
      const validator1JsonApiHealth = await waitForHealthy(
        { type: 'http', target: 'http://localhost:2975/livez' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(validator1JsonApiHealth.healthy, true, 'Validator 1 JSON API should be healthy');

    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

// ============================================================================
// E2E Test: Two Validators with oauth2
// ============================================================================

const E2E_TWO_VALIDATORS_CONFIG: LocalNetConfig = {
  validators: 2,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

Deno.test({
  name: 'E2E: Two validators LocalNet starts and all APIs respond',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(E2E_TWO_VALIDATORS_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      const status = await localnet.status();
      assertEquals(status.state, 'running', 'LocalNet should be in running state');
      assertEquals(status.containers.length, 10, 'Should have 10 containers for 2 validators');

      // Verify SV JSON API
      const svHealth = await waitForHealthy(
        { type: 'http', target: 'http://localhost:4975/livez' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(svHealth.healthy, true, 'SV JSON API should be healthy');

      // Verify Validator 1 JSON API (port prefix 2)
      const v1Health = await waitForHealthy(
        { type: 'http', target: 'http://localhost:2975/livez' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(v1Health.healthy, true, 'Validator 1 JSON API should be healthy');

      // Verify Validator 2 JSON API (port prefix 3)
      const v2Health = await waitForHealthy(
        { type: 'http', target: 'http://localhost:3975/livez' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(v2Health.healthy, true, 'Validator 2 JSON API should be healthy');

      // Verify Scan API
      const scanHealth = await waitForHealthy(
        { type: 'http', target: 'http://localhost:5012/api/scan/status' },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(scanHealth.healthy, true, 'Scan API should be healthy');

    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});


