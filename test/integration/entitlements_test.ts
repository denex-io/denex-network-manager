import { assertEquals, assertExists } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { getKeycloakUrl, getLedgerApiUserClientId, getRealmName } from '../../src/types/config.ts';
import { CantonClient } from '../../src/api/canton.ts';
import { getValidatorPorts } from '../../src/utils/ports.ts';

// Test config exercising all new features
const ENTITLEMENTS_TEST_CONFIG: LocalNetConfig = {
  validators: [
    {
      name: 'val1',
      parties: [
        { hint: 'alice', displayName: 'Alice' },
        { hint: 'bob', displayName: 'Bob' },
      ],
      users: [
        {
          id: 'alice-user',
          primaryParty: 'alice',
          parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
        },
        {
          id: 'admin-user',
          rights: ['ParticipantAdmin'],
        },
        {
          id: 'multi-user',
          primaryParty: 'alice',
          parties: [
            { hint: 'bob' }, // defaults to CanActAs
            { hint: 'auto-party' }, // NOT in top-level parties — should be auto-allocated
          ],
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
// ENTITLEMENTS TESTS
// ============================================================================

Deno.test({
  name: 'Entitlements: users created with correct rights',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(ENTITLEMENTS_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      const usersWithRights = await localnet.getUsersWithRights('val1');

      // Verify alice-user exists and has rights
      const aliceUser = usersWithRights.find((u) => u.id === 'alice-user');
      assertExists(aliceUser, 'alice-user should exist');

      // alice-user should have CanActAs on alice party (from primaryParty)
      // and CanReadAs on bob party (from parties config)
      const aliceRights = aliceUser.rights;
      assertEquals(aliceRights.length >= 2, true, 'alice-user should have at least 2 rights');

      // Check for CanActAs right
      const hasCanActAs = aliceRights.some((r) => 'CanActAs' in r.kind);
      assertEquals(hasCanActAs, true, 'alice-user should have CanActAs right');

      // Check for CanReadAs right
      const hasCanReadAs = aliceRights.some((r) => 'CanReadAs' in r.kind);
      assertEquals(hasCanReadAs, true, 'alice-user should have CanReadAs right');

      // Verify admin-user exists and has ParticipantAdmin
      const adminUser = usersWithRights.find((u) => u.id === 'admin-user');
      assertExists(adminUser, 'admin-user should exist');

      const hasParticipantAdmin = adminUser.rights.some((r) => 'ParticipantAdmin' in r.kind);
      assertEquals(hasParticipantAdmin, true, 'admin-user should have ParticipantAdmin right');

      // Verify multi-user exists and has rights on multiple parties
      const multiUser = usersWithRights.find((u) => u.id === 'multi-user');
      assertExists(multiUser, 'multi-user should exist');

      // multi-user should have CanActAs on alice (primaryParty), bob, and auto-party
      const multiCanActAs = multiUser.rights.filter((r) => 'CanActAs' in r.kind);
      assertEquals(
        multiCanActAs.length >= 3,
        true,
        'multi-user should have CanActAs on at least 3 parties',
      );
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Entitlements: auto-allocated party exists',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(ENTITLEMENTS_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      const parties = await localnet.getParties('val1');

      // auto-party should have been auto-allocated (referenced by multi-user but NOT in top-level parties)
      const autoParty = parties.find((p) => p.hint === 'auto-party');
      assertExists(autoParty, 'auto-party should be auto-allocated');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Entitlements: getUsersWithRights returns correct data structure',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(ENTITLEMENTS_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      const usersWithRights = await localnet.getUsersWithRights('val1');

      // Should have at least our 3 configured users
      assertEquals(usersWithRights.length >= 3, true, 'Should have at least 3 users');

      // Each user should have the expected structure
      for (const user of usersWithRights) {
        assertExists(user.id, 'User should have id');
        assertExists(user.validator, 'User should have validator');
        assertEquals(Array.isArray(user.rights), true, 'User should have rights array');
        assertEquals(typeof user.isDeactivated, 'boolean', 'User should have isDeactivated');
      }
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Entitlements: admin-user can perform admin operations',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(ENTITLEMENTS_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      // Create a per-user client for admin-user
      const ports = getValidatorPorts(0);
      const adminClient = CantonClient.forUser(
        `http://localhost:${ports.jsonApi}`,
        'admin-user',
        {
          keycloakUrl: getKeycloakUrl(ENTITLEMENTS_TEST_CONFIG),
          realm: getRealmName('val1'),
          userClientId: getLedgerApiUserClientId('val1'),
        },
      );

      // admin-user should be able to list users (ParticipantAdmin operation)
      const users = await adminClient.listUsers();
      assertEquals(Array.isArray(users), true, 'admin-user should be able to list users');
      assertEquals(users.length >= 3, true, 'admin-user should see at least 3 users');
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});
