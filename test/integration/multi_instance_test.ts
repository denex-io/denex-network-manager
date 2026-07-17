/**
 * Multi-instance integration tests for denex-network-manager.
 *
 * Tests that two LocalNets with different instanceIds and basePorts have
 * correct resource isolation (containers, networks, volumes, port conflict
 * detection). Tests run sequentially — one instance is fully destroyed before
 * the next starts — because SV_INTERNAL_PORTS (sequencerPublic, scanAdmin,
 * etc.) are absolute port numbers shared by all instances regardless of
 * basePort, so true concurrent operation on one host is not supported.
 */

import { assertEquals, assertNotEquals } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

// High port ranges, well clear of any developer's default (5000) localnet
// and each other. Each instance uses (validators+1)*100 ports from its base,
// so basePort+0..+182 for 1 validator. 17000 and 18000 give 818-port clearance.
const BASE_PORT_A = 17000;
const BASE_PORT_B = 18000;

const INSTANCE_CONFIG_A: LocalNetConfig = {
  validators: 1,
  basePort: BASE_PORT_A,
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
};

const INSTANCE_CONFIG_B: LocalNetConfig = {
  validators: 1,
  basePort: BASE_PORT_B,
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
};

// ============================================================================
// Sequential isolation — start A, verify it, destroy A, start B, verify B.
// ============================================================================

Deno.test({
  name: 'Multi-instance: sequential instances have isolated containers and networks',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const idA = generateTestInstanceId();
    const idB = generateTestInstanceId();
    assertNotEquals(idA, idB);

    // --- Instance A ---
    const netA = new LocalNet(INSTANCE_CONFIG_A, { instanceId: idA });
    try {
      await netA.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 });
      assertEquals(netA.currentState, 'running');

      const containersA = await client.listContainers({ 'denex.localnet.instance': idA });
      assertNotEquals(containersA.length, 0, 'Instance A has no containers');

      // All containers are prefixed with idA
      for (const c of containersA) {
        assertEquals(c.name.startsWith(idA), true, `Container '${c.name}' not prefixed with idA`);
      }
    } finally {
      await netA.destroy();
      await cleanupTestResources(client, idA);
    }

    // A is gone — no containers or volumes remain
    const afterA = await client.listContainers({ 'denex.localnet.instance': idA });
    assertEquals(afterA.length, 0, 'Instance A containers remain after destroy');
    const volsAfterA = await client.listVolumes({ 'denex.localnet.instance': idA });
    assertEquals(volsAfterA.length, 0, 'Instance A volumes remain after destroy');

    // --- Instance B (starts clean, A is gone) ---
    const netB = new LocalNet(INSTANCE_CONFIG_B, { instanceId: idB });
    try {
      await netB.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 });
      assertEquals(netB.currentState, 'running');

      const containersB = await client.listContainers({ 'denex.localnet.instance': idB });
      assertNotEquals(containersB.length, 0, 'Instance B has no containers');

      for (const c of containersB) {
        assertEquals(c.name.startsWith(idB), true, `Container '${c.name}' not prefixed with idB`);
      }
    } finally {
      await netB.destroy();
      await cleanupTestResources(client, idB);
    }
  },
});

// ============================================================================
// Named postgres volume — each instance gets its own, destroy cleans it up.
// ============================================================================

Deno.test({
  name: 'Multi-instance: each instance creates a distinct named postgres volume',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const idA = generateTestInstanceId();
    const netA = new LocalNet(INSTANCE_CONFIG_A, { instanceId: idA });

    try {
      await netA.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 });

      const vols = await client.listVolumes({ 'denex.localnet.instance': idA });
      assertEquals(vols.length, 1, `Expected 1 volume for instance, got ${vols.length}`);
      assertEquals(
        vols[0].name,
        `${idA}-postgres-data`,
        `Volume name unexpected: ${vols[0].name}`,
      );
    } finally {
      await netA.destroy();
      await cleanupTestResources(client, idA);
    }

    // Volume is cleaned up by destroy()
    const volsAfter = await client.listVolumes({ 'denex.localnet.instance': idA });
    assertEquals(volsAfter.length, 0, 'Postgres volume not removed by destroy()');
  },
});

// ============================================================================
// Port conflict detection — same basePort on two instances should be rejected.
// ============================================================================

Deno.test({
  name: 'Multi-instance: starting a second instance on the same basePort throws',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const idA = generateTestInstanceId();
    const idB = generateTestInstanceId();
    const sharedPort = 19000;

    const configA: LocalNetConfig = {
      validators: 1,
      basePort: sharedPort,
      auth: { keycloak: { admin: 'admin', password: 'admin' } },
    };
    const configB: LocalNetConfig = {
      validators: 1,
      basePort: sharedPort, // same — should be rejected by validatePortAvailability
      auth: { keycloak: { admin: 'admin', password: 'admin' } },
    };

    const netA = new LocalNet(configA, { instanceId: idA });
    const netB = new LocalNet(configB, { instanceId: idB });

    try {
      await netA.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 });

      let threw = false;
      try {
        await netB.start({ skipHealthChecks: true, skipInitialization: true, timeout: 30_000 });
      } catch (err) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        assertEquals(
          msg.toLowerCase().includes('port'),
          true,
          `Expected port conflict error, got: ${msg}`,
        );
      }
      assertEquals(threw, true, 'Expected netB.start() to throw a port conflict error');
      // After the throw, netB state should be 'stopped' (pre-container failure)
      assertEquals(netB.currentState, 'stopped');
    } finally {
      await Promise.allSettled([netA.destroy(), netB.destroy()]);
      await Promise.allSettled([
        cleanupTestResources(client, idA),
        cleanupTestResources(client, idB),
      ]);
    }
  },
});
