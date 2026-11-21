import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { waitForHealthy } from '../../src/docker/health.ts';
import { getKeycloakPort, getSvPorts, getValidatorPorts } from '../../src/utils/ports.ts';
import { isDockerAvailable } from './helpers.ts';
import { acquireSharedLocalNet, releaseSharedLocalNet } from './shared_localnet.ts';

// Moved from localnet_test.ts with their names and checks unchanged. They read a running LocalNet
// and stop nothing, so they run in group s1 on the shared network S1 (shared_localnet.ts): one
// validator, validator-1, Keycloak admin admin/admin, the default base port, which is the config
// they started before plus S1's users. run_group.ts starts S1 with the same start() call and
// options ("E2E: Full LocalNet starts and APIs respond" used: a full start, the default timeout),
// so a start that would have failed in the test fails the group, by name, instead.

Deno.test({
  name: 'Lifecycle: start throws if already running',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Attached to S1: a handle that counts as running.
    const localnet = await acquireSharedLocalNet('S1');

    try {
      await assertRejects(
        () => localnet.start(),
        Error,
        'LocalNet is already running',
      );
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'E2E: Full LocalNet starts and APIs respond',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // S1 was started WITHOUT skipHealthChecks - everything was waited for to be ready
    const localnet = await acquireSharedLocalNet('S1');

    try {
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
        { type: 'tcp', target: `localhost:${getKeycloakPort()}` },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(keycloakHealth.healthy, true, 'Keycloak should be healthy');

      // Verify Canton JSON API is responding (SV)
      const svJsonApiHealth = await waitForHealthy(
        { type: 'http', target: `http://localhost:${getSvPorts().jsonApi}/livez` },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(svJsonApiHealth.healthy, true, 'SV JSON API should be healthy');

      // Verify Canton JSON API is responding (Validator 1)
      const validator1JsonApiHealth = await waitForHealthy(
        { type: 'http', target: `http://localhost:${getValidatorPorts(0).jsonApi}/livez` },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(validator1JsonApiHealth.healthy, true, 'Validator 1 JSON API should be healthy');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});
