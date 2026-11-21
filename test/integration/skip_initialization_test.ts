import { assertEquals, assertExists } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
  testConfig,
  waitForLedgerJsonApi,
} from './helpers.ts';
import {
  acquireSharedLocalNet,
  releaseSharedLocalNet,
  SHARED_NETWORKS,
} from './shared_localnet.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { buildConfigEnvironmentInfo } from '../../src/utils/env-info.ts';

// The two skipInitialization tests of initialization_test.ts, moved here unchanged so that they
// run in their own group (skip) with the shared network SKIP (shared_localnet.ts), apart from the
// INIT network the other initialization tests use. "skipInitialization prevents party/user
// creation" runs on SKIP, which nothing initializes; "manual initializeResources works after
// skipInitialization" initializes its network, so it starts its own, with this config.

// Config with parties defined for allocation testing
const PARTY_ALLOCATION_CONFIG: LocalNetConfig = testConfig({
  validators: [
    {
      name: 'alice',
      parties: [
        { hint: 'alice', displayName: 'Alice' },
        { hint: 'alice-bot', displayName: 'Alice Bot' },
      ],
    },
    {
      name: 'bob',
      parties: [
        { hint: 'bob', displayName: 'Bob' },
      ],
    },
  ],
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
});

// ============================================================================
// SKIP INITIALIZATION TESTS
// ============================================================================

Deno.test({
  name: 'Initialization: skipInitialization prevents party/user creation',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Started with skipInitialization (the shared network SKIP, which nothing initializes)
    const localnet = await acquireSharedLocalNet('SKIP');

    try {
      // skipInitialization skips the readiness waits (LocalNet.start), so wait for alice's API.
      await waitForLedgerJsonApi(
        buildConfigEnvironmentInfo(SHARED_NETWORKS.SKIP).validators.alice.endpoints.jsonApi,
      );

      // Get parties for alice
      const aliceParties = await localnet.getParties('alice');

      // Should only have validator party (auto-created), not custom parties
      const aliceParty = aliceParties.find((p) => p.hint === 'alice');
      assertEquals(
        aliceParty,
        undefined,
        'alice party should NOT be created when skipInitialization is true',
      );
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Initialization: manual initializeResources works after skipInitialization',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(PARTY_ALLOCATION_CONFIG, { instanceId });

    try {
      // Start with skipInitialization
      await localnet.start({ skipInitialization: true });

      // Manually initialize
      await localnet.initializeResources();

      // Get parties for alice
      const aliceParties = await localnet.getParties('alice');

      // Now custom parties should exist
      const aliceParty = aliceParties.find((p) => p.hint === 'alice');
      assertExists(aliceParty, 'alice party should be created after manual initializeResources');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});
