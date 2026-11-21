import { assertEquals } from '@std/assert';
import { waitForHealthy } from '../../src/docker/health.ts';
import { getSvInternalPorts, getSvPorts, getValidatorPorts } from '../../src/utils/ports.ts';
import { isDockerAvailable } from './helpers.ts';
import { acquireSharedLocalNet, releaseSharedLocalNet } from './shared_localnet.ts';

// Moved from localnet_test.ts with its name and checks unchanged. It reads a running LocalNet and
// stops nothing, so it runs in group s2 on the shared network S2 (shared_localnet.ts): validators
// validator-1 and validator-2 (the names `validators: 2` gave it), Keycloak admin admin/admin,
// the default base port, which is the config it started before plus S2's users and party.
// run_group.ts starts S2 with the same start() call and options it used (a full start, the
// default timeout), so a start that would have failed in the test fails the group, by name,
// instead.

Deno.test({
  name: 'E2E: Two validators LocalNet starts and all APIs respond',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // S2 was started without skipHealthChecks, with validator-1 and validator-2
    const localnet = await acquireSharedLocalNet('S2');

    try {
      const status = await localnet.status();
      assertEquals(status.state, 'running', 'LocalNet should be in running state');
      assertEquals(status.containers.length, 10, 'Should have 10 containers for 2 validators');

      // Verify SV JSON API
      const svHealth = await waitForHealthy(
        { type: 'http', target: `http://localhost:${getSvPorts().jsonApi}/livez` },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(svHealth.healthy, true, 'SV JSON API should be healthy');

      // Verify Validator 1 JSON API
      const v1Health = await waitForHealthy(
        { type: 'http', target: `http://localhost:${getValidatorPorts(0).jsonApi}/livez` },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(v1Health.healthy, true, 'Validator 1 JSON API should be healthy');

      // Verify Validator 2 JSON API
      const v2Health = await waitForHealthy(
        { type: 'http', target: `http://localhost:${getValidatorPorts(1).jsonApi}/livez` },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(v2Health.healthy, true, 'Validator 2 JSON API should be healthy');

      // Verify Scan API
      const scanHealth = await waitForHealthy(
        {
          type: 'http',
          target: `http://localhost:${getSvInternalPorts().scanAdmin}/api/scan/status`,
        },
        { timeout: 5000, retries: 10, retryDelay: 1000 },
      );
      assertEquals(scanHealth.healthy, true, 'Scan API should be healthy');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});
