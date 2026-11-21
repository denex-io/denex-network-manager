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

// The tests run on the shared networks of the init group (shared_localnet.ts), under their own
// validator names: INIT for those that read what initialization did (alice and bob with the
// party-allocation config below; val1 with onb-alice, onb-alice-user and onb-admin-user; val1 and
// val2 with idem-shared, idem-user-1 and idem-user-2), and SKIP, never initialized, for
// "skipInitialization prevents party/user creation". "manual initializeResources works after
// skipInitialization" initializes its network, so it starts its own, as before.

// Config with parties defined for allocation testing. As this config it is only the network of
// "manual initializeResources works after skipInitialization": base port 23000, clear of INIT
// (5000) and SKIP (8000), which are up while it runs.
const PARTY_ALLOCATION_CONFIG: LocalNetConfig = testConfig({
  basePort: 23000,
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
// PARTY ALLOCATION TESTS
// ============================================================================

Deno.test({
  name: 'Initialization: parties from config are allocated',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Started with initialization, which runs automatically
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      // Get all parties
      const allParties = await localnet.getParties();

      // Verify alice parties exist
      const aliceParties = allParties.filter((p) => p.validator === 'alice');
      assertEquals(aliceParties.length >= 2, true, 'alice should have at least 2 parties');

      const aliceParty = aliceParties.find((p) => p.hint === 'alice');
      assertExists(aliceParty, 'alice party should exist');
      assertEquals(aliceParty.displayName, 'Alice');

      const aliceBotParty = aliceParties.find((p) => p.hint === 'alice-bot');
      assertExists(aliceBotParty, 'alice-bot party should exist');
      assertEquals(aliceBotParty.displayName, 'Alice Bot');

      // Verify bob parties exist
      const bobParties = allParties.filter((p) => p.validator === 'bob');
      assertEquals(bobParties.length >= 1, true, 'bob should have at least 1 party');

      const bobParty = bobParties.find((p) => p.hint === 'bob');
      assertExists(bobParty, 'bob party should exist');
      assertEquals(bobParty.displayName, 'Bob');

      // Each party is listed once, under the validator that hosts it, and the
      // displayName comes from the hosting participant's annotation (regression guard).
      const partyIds = allParties.map((p) => p.partyId);
      assertEquals(new Set(partyIds).size, partyIds.length, 'partyIds should be unique');
      assertEquals(aliceParty.validator, 'alice');
      assertEquals(bobParty.validator, 'bob');
      const bobHosted = await localnet.getParties('bob');
      assertEquals(
        bobHosted.some((p) => p.hint === 'alice'),
        false,
        "getParties('bob') should not include alice's party",
      );
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Initialization: parties are allocated before users',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      // Get parties for alice
      const aliceParties = await localnet.getParties('alice');

      // Verify validator party exists (allocated automatically)
      const validatorParty = aliceParties.find((p) => p.hint === 'alice');
      assertExists(validatorParty, 'Validator party should be allocated');

      // Verify custom parties exist (allocated from config)
      const aliceParty = aliceParties.find((p) => p.hint === 'alice');
      assertExists(aliceParty, 'alice party should be allocated');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

// ============================================================================
// USER CREATION AND WALLET ONBOARDING TESTS
// ============================================================================

Deno.test({
  name: 'Initialization: users from config are created',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      // Get users for val1
      const users = await localnet.getUsers('val1');

      // Verify onb-alice-user exists
      const aliceUser = users.find((u) => u.id === 'onb-alice-user');
      assertExists(aliceUser, 'onb-alice-user should be created');
      assertEquals(aliceUser.validator, 'val1');

      // Verify onb-admin-user exists
      const adminUser = users.find((u) => u.id === 'onb-admin-user');
      assertExists(adminUser, 'onb-admin-user should be created');
      assertEquals(adminUser.validator, 'val1');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Initialization: users are linked to correct parties',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      // Get parties and users
      const parties = await localnet.getParties('val1');
      const users = await localnet.getUsers('val1');

      // Find onb-alice party
      const aliceParty = parties.find((p) => p.hint === 'onb-alice');
      assertExists(aliceParty, 'onb-alice party should exist');

      // Find onb-alice-user
      const aliceUser = users.find((u) => u.id === 'onb-alice-user');
      assertExists(aliceUser, 'onb-alice-user should exist');

      // Verify onb-alice-user is linked to onb-alice party
      assertEquals(
        aliceUser.primaryParty,
        aliceParty.partyId,
        'onb-alice-user should be linked to onb-alice party',
      );

      // Find onb-admin-user
      const adminUser = users.find((u) => u.id === 'onb-admin-user');
      assertExists(adminUser, 'onb-admin-user should exist');

      // Verify onb-admin-user has a primary party (validator party fallback)
      assertExists(adminUser.primaryParty, 'onb-admin-user should have a primary party');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Initialization: users from config have ledger accounts created',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      // NOTE: This test verifies LEDGER user creation only. Wallet onboarding
      // verification requires browser-level testing — see test/integration/wallet_ui_test.ts.
      // The getUsers() method returns ledger users, not wallet onboarding status.

      const users = await localnet.getUsers('val1');

      const aliceUser = users.find((u) => u.id === 'onb-alice-user');
      assertExists(aliceUser, 'onb-alice-user should be created on ledger');

      const adminUser = users.find((u) => u.id === 'onb-admin-user');
      assertExists(adminUser, 'onb-admin-user should be created on ledger');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
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

// ============================================================================
// INIT IDEMPOTENCY
// ============================================================================

Deno.test({
  name: 'Initialization: initializeResources is idempotent',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Two validators share a hint (idem-shared); each user's primaryParty must be hosted on its
    // own validator.
    const localnet = await acquireSharedLocalNet('INIT');
    const instanceId = localnet.instanceId;

    try {
      // Both snapshots are taken inside this test, and the group's tests run one at a time
      // (run_group.ts), so no neighbour changes these counts between them.
      const snapshot = async (net: LocalNet) => ({
        parties: (await net.getParties()).length,
        users: (await net.getUsers('val1')).length + (await net.getUsers('val2')).length,
      });
      const before = await snapshot(localnet);

      const messages: string[] = [];
      const fresh = await LocalNet.fromInstanceId(instanceId);
      await fresh.initializeResources((m) => messages.push(m));

      assertEquals(await snapshot(fresh), before);
      assertEquals(messages.filter((m) => m.includes('Allocating party')), []);
      for (const v of ['val1', 'val2']) {
        assertEquals(
          messages.includes(`Party 'idem-shared' already allocated on ${v}; skipping`),
          true,
        );
      }

      const val1Ids = new Set((await fresh.getParties('val1')).map((p) => p.partyId));
      const val2Ids = new Set((await fresh.getParties('val2')).map((p) => p.partyId));
      for (
        const [validator, userId, ids] of [['val1', 'idem-user-1', val1Ids], [
          'val2',
          'idem-user-2',
          val2Ids,
        ]] as const
      ) {
        const user = (await fresh.getUsers(validator)).find((u) => u.id === userId);
        assertExists(user);
        assertEquals(user.primaryParty !== undefined && ids.has(user.primaryParty), true);
      }
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});
