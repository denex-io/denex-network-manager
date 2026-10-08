import { assertEquals, assertExists } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

// Config with parties defined for allocation testing
const PARTY_ALLOCATION_CONFIG: LocalNetConfig = {
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
};

// Config with users defined for wallet onboarding testing
const USER_ONBOARDING_CONFIG: LocalNetConfig = {
  validators: [
    {
      name: 'val1',
      parties: [
        { hint: 'alice', displayName: 'Alice' },
      ],
      users: [
        {
          id: 'alice-user',
          primaryParty: 'alice',
          rights: ['CanActAs', 'CanReadAs'],
        },
        {
          id: 'admin-user',
          primaryParty: 'val1',
          rights: ['CanActAs', 'CanReadAs'],
        },
      ],
    },
  ],
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

// ============================================================================
// PARTY ALLOCATION TESTS
// ============================================================================

Deno.test({
  name: 'Initialization: parties from config are allocated',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(PARTY_ALLOCATION_CONFIG, { instanceId });

    try {
      // Start LocalNet - initialization runs automatically
      await localnet.start({ timeout: 300000 });

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
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Initialization: parties are allocated before users',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(PARTY_ALLOCATION_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      // Get parties for alice
      const aliceParties = await localnet.getParties('alice');

      // Verify validator party exists (allocated automatically)
      const validatorParty = aliceParties.find((p) => p.hint === 'alice');
      assertExists(validatorParty, 'Validator party should be allocated');

      // Verify custom parties exist (allocated from config)
      const aliceParty = aliceParties.find((p) => p.hint === 'alice');
      assertExists(aliceParty, 'alice party should be allocated');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
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
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(USER_ONBOARDING_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      // Get users for val1
      const users = await localnet.getUsers('val1');

      // Verify alice-user exists
      const aliceUser = users.find((u) => u.id === 'alice-user');
      assertExists(aliceUser, 'alice-user should be created');
      assertEquals(aliceUser.validator, 'val1');

      // Verify admin-user exists
      const adminUser = users.find((u) => u.id === 'admin-user');
      assertExists(adminUser, 'admin-user should be created');
      assertEquals(adminUser.validator, 'val1');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Initialization: users are linked to correct parties',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(USER_ONBOARDING_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      // Get parties and users
      const parties = await localnet.getParties('val1');
      const users = await localnet.getUsers('val1');

      // Find alice party
      const aliceParty = parties.find((p) => p.hint === 'alice');
      assertExists(aliceParty, 'alice party should exist');

      // Find alice-user
      const aliceUser = users.find((u) => u.id === 'alice-user');
      assertExists(aliceUser, 'alice-user should exist');

      // Verify alice-user is linked to alice party
      assertEquals(
        aliceUser.primaryParty,
        aliceParty.partyId,
        'alice-user should be linked to alice party',
      );

      // Find admin-user
      const adminUser = users.find((u) => u.id === 'admin-user');
      assertExists(adminUser, 'admin-user should exist');

      // Verify admin-user has a primary party (validator party fallback)
      assertExists(adminUser.primaryParty, 'admin-user should have a primary party');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Initialization: users from config have ledger accounts created',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(USER_ONBOARDING_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      // NOTE: This test verifies LEDGER user creation only. Wallet onboarding
      // verification requires browser-level testing — see test/integration/wallet_ui_test.ts.
      // The getUsers() method returns ledger users, not wallet onboarding status.

      const users = await localnet.getUsers('val1');

      const aliceUser = users.find((u) => u.id === 'alice-user');
      assertExists(aliceUser, 'alice-user should be created on ledger');

      const adminUser = users.find((u) => u.id === 'admin-user');
      assertExists(adminUser, 'admin-user should be created on ledger');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
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
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(PARTY_ALLOCATION_CONFIG, { instanceId });

    try {
      // Start with skipInitialization
      await localnet.start({ skipInitialization: true, timeout: 300000 });

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
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
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
      await localnet.start({ skipInitialization: true, timeout: 300000 });

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
// INIT IDEMPOTENCY (#14)
// basePort 23000 is dedicated to this test (see agents/testing.md).
// ============================================================================

Deno.test({
  name: 'Initialization: initializeResources is idempotent',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    // Two validators share a hint; each user's primaryParty must be hosted on its own validator.
    const config: LocalNetConfig = {
      basePort: 23000,
      validators: [
        {
          name: 'val1',
          parties: [{ hint: 'shared', displayName: 'Shared 1' }],
          users: [{ id: 'user-1', primaryParty: 'shared', rights: ['CanActAs', 'CanReadAs'] }],
        },
        {
          name: 'val2',
          parties: [{ hint: 'shared', displayName: 'Shared 2' }],
          users: [{ id: 'user-2', primaryParty: 'shared', rights: ['CanActAs', 'CanReadAs'] }],
        },
      ],
      auth: { keycloak: { admin: 'admin', password: 'admin' } },
    };
    const localnet = new LocalNet(config, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      const snapshot = async (net: LocalNet) => ({
        parties: (await net.getParties()).length,
        users: (await net.getUsers('val1')).length + (await net.getUsers('val2')).length,
      });
      const before = await snapshot(localnet);

      const messages: string[] = [];
      const fresh = await LocalNet.fromInstanceId(instanceId);
      await fresh.initializeResources((m) => messages.push(m));

      assertEquals(await snapshot(fresh), before);
      assertEquals(messages.filter((m) => m.includes('Failed to allocate party')), []);
      assertEquals(messages.filter((m) => m.includes('Failed to create user')), []);
      assertEquals(messages.filter((m) => m.includes('Allocating party')), []);
      for (const v of ['val1', 'val2']) {
        assertEquals(
          messages.includes(`Party 'shared' already allocated on ${v}; skipping`),
          true,
        );
      }

      const val1Ids = new Set((await fresh.getParties('val1')).map((p) => p.partyId));
      const val2Ids = new Set((await fresh.getParties('val2')).map((p) => p.partyId));
      for (
        const [validator, userId, ids] of [['val1', 'user-1', val1Ids], [
          'val2',
          'user-2',
          val2Ids,
        ]] as const
      ) {
        const user = (await fresh.getUsers(validator)).find((u) => u.id === userId);
        assertExists(user);
        assertEquals(user.primaryParty !== undefined && ids.has(user.primaryParty), true);
      }
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});
