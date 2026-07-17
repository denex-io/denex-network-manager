/**
 * Multi-instance integration tests for denex-network-manager.
 *
 * Verifies that two LocalNets with different instanceIds and basePorts can
 * run concurrently without interfering with each other, and that destroying
 * one does not affect the other's containers, network, or postgres volume.
 *
 * This is possible because host-published SV ports (scanAdmin, svAdmin) are
 * now derived from basePort via getSvInternalPorts(). Container-to-container
 * ports (sequencer, mediator) remain fixed absolute values since they only
 * communicate within each instance's isolated Docker network.
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

// High port ranges, well clear of any developer's default (5000) localnet.
// Port layout per instance: SV at basePort+0..+82, validator at (basePort+100)+0..+82,
// SV internal host ports at basePort+12 (scanAdmin) and basePort+14 (svAdmin).
// 17000 and 18000 give 818-port clearance — no overlap.
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
// Concurrent startup isolation
// ============================================================================

Deno.test({
  name: 'Multi-instance: two localnets with different basePorts start concurrently',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const idA = generateTestInstanceId();
    const idB = generateTestInstanceId();
    const netA = new LocalNet(INSTANCE_CONFIG_A, { instanceId: idA });
    const netB = new LocalNet(INSTANCE_CONFIG_B, { instanceId: idB });

    try {
      // Start both concurrently — must not port-conflict.
      await Promise.all([
        netA.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 }),
        netB.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 }),
      ]);

      assertEquals(netA.currentState, 'running');
      assertEquals(netB.currentState, 'running');

      const containersA = await client.listContainers({ 'denex.localnet.instance': idA });
      const containersB = await client.listContainers({ 'denex.localnet.instance': idB });

      assertNotEquals(containersA.length, 0, 'Instance A has no containers');
      assertNotEquals(containersB.length, 0, 'Instance B has no containers');
      assertEquals(
        containersA.length,
        containersB.length,
        'Instances have different container counts',
      );

      // No container ID overlap between instances.
      const idsA = new Set(containersA.map((c) => c.id));
      for (const c of containersB) {
        assertEquals(idsA.has(c.id), false, `Container ${c.id} leaked across instances`);
      }

      // Container names are prefixed with their respective instanceId.
      for (const c of containersA) {
        assertEquals(c.name.startsWith(idA), true, `Container '${c.name}' not prefixed with idA`);
      }
      for (const c of containersB) {
        assertEquals(c.name.startsWith(idB), true, `Container '${c.name}' not prefixed with idB`);
      }
    } finally {
      await Promise.allSettled([netA.destroy(), netB.destroy()]);
      await Promise.allSettled([
        cleanupTestResources(client, idA),
        cleanupTestResources(client, idB),
      ]);
    }
  },
});

// ============================================================================
// Volume isolation
// ============================================================================

Deno.test({
  name: 'Multi-instance: each instance gets its own named postgres volume',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const idA = generateTestInstanceId();
    const idB = generateTestInstanceId();
    const netA = new LocalNet(INSTANCE_CONFIG_A, { instanceId: idA });
    const netB = new LocalNet(INSTANCE_CONFIG_B, { instanceId: idB });

    try {
      await Promise.all([
        netA.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 }),
        netB.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 }),
      ]);

      const volsA = await client.listVolumes({ 'denex.localnet.instance': idA });
      const volsB = await client.listVolumes({ 'denex.localnet.instance': idB });

      assertEquals(volsA.length, 1, `Expected 1 volume for A, got ${volsA.length}`);
      assertEquals(volsB.length, 1, `Expected 1 volume for B, got ${volsB.length}`);

      assertNotEquals(volsA[0].name, volsB[0].name, 'Both instances share the same volume name');
      assertEquals(volsA[0].name, `${idA}-postgres-data`);
      assertEquals(volsB[0].name, `${idB}-postgres-data`);
    } finally {
      await Promise.allSettled([netA.destroy(), netB.destroy()]);
      await Promise.allSettled([
        cleanupTestResources(client, idA),
        cleanupTestResources(client, idB),
      ]);
    }
  },
});

// ============================================================================
// Destroy isolation — tearing down one must not affect the other
// ============================================================================

Deno.test({
  name: 'Multi-instance: destroying one instance leaves the other intact',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const idA = generateTestInstanceId();
    const idB = generateTestInstanceId();
    const netA = new LocalNet(INSTANCE_CONFIG_A, { instanceId: idA });
    const netB = new LocalNet(INSTANCE_CONFIG_B, { instanceId: idB });

    try {
      await Promise.all([
        netA.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 }),
        netB.start({ skipHealthChecks: true, skipInitialization: true, timeout: 120_000 }),
      ]);

      const containerCountB = (await client.listContainers({ 'denex.localnet.instance': idB }))
        .length;
      const volumeCountB = (await client.listVolumes({ 'denex.localnet.instance': idB })).length;

      // Destroy only A.
      await netA.destroy();

      // A's resources must be gone.
      const containersAfterA = await client.listContainers({ 'denex.localnet.instance': idA });
      assertEquals(containersAfterA.length, 0, 'Instance A containers remain after destroy');
      const volsAfterA = await client.listVolumes({ 'denex.localnet.instance': idA });
      assertEquals(volsAfterA.length, 0, 'Instance A volumes remain after destroy');

      // B must be completely unaffected.
      const containersAfterB = await client.listContainers({ 'denex.localnet.instance': idB });
      assertEquals(
        containersAfterB.length,
        containerCountB,
        'Instance B container count changed after A was destroyed',
      );
      const volsAfterB = await client.listVolumes({ 'denex.localnet.instance': idB });
      assertEquals(
        volsAfterB.length,
        volumeCountB,
        'Instance B volume count changed after A was destroyed',
      );
      assertEquals(netB.currentState, 'running', 'Instance B is no longer running');
    } finally {
      await Promise.allSettled([netA.destroy(), netB.destroy()]);
      await Promise.allSettled([
        cleanupTestResources(client, idA),
        cleanupTestResources(client, idB),
      ]);
    }
  },
});

// ============================================================================
// Port conflict detection
// ============================================================================

Deno.test({
  name: 'Multi-instance: starting two instances on the same basePort throws',
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
      basePort: sharedPort, // same — must be rejected
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
      assertEquals(
        netB.currentState,
        'stopped',
        'netB state should reset to stopped after pre-container failure',
      );
    } finally {
      await Promise.allSettled([netA.destroy(), netB.destroy()]);
      await Promise.allSettled([
        cleanupTestResources(client, idA),
        cleanupTestResources(client, idB),
      ]);
    }
  },
});
