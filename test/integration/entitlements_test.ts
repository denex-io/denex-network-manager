import { assertEquals, assertExists } from '@std/assert';
import { isDockerAvailable } from './helpers.ts';
import {
  acquireSharedLocalNet,
  releaseSharedLocalNet,
  SHARED_NETWORKS,
} from './shared_localnet.ts';
import { getKeycloakUrl, getLedgerApiUserClientId, getRealmName } from '../../src/types/config.ts';
import { CantonClient } from '../../src/api/canton.ts';
import { getValidatorPorts } from '../../src/utils/ports.ts';

// The config these tests read is the `ent-*` entries of validator val1 on the shared network INIT
// (shared_localnet.ts): parties ent-alice and ent-bob; ent-alice-user (primary party ent-alice,
// CanReadAs on ent-bob); ent-admin-user (ParticipantAdmin, no primary party); ent-multi-user
// (primary party ent-alice, CanActAs on ent-bob and on ent-auto-party, a party no entry declares
// at top level, so it is allocated for this user). val1 is INIT's first validator, at port index 0.
const VALIDATOR = 'val1';

// ============================================================================
// ENTITLEMENTS TESTS
// ============================================================================

Deno.test({
  name: 'Entitlements: users created with correct rights',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      const usersWithRights = await localnet.getUsersWithRights(VALIDATOR);

      // Verify ent-alice-user exists and has rights
      const aliceUser = usersWithRights.find((u) => u.id === 'ent-alice-user');
      assertExists(aliceUser, 'ent-alice-user should exist');

      // ent-alice-user should have CanActAs on ent-alice (from primaryParty)
      // and CanReadAs on ent-bob (from parties config)
      const aliceRights = aliceUser.rights;
      assertEquals(aliceRights.length >= 2, true, 'ent-alice-user should have at least 2 rights');

      // Check for CanActAs right
      const hasCanActAs = aliceRights.some((r) => 'CanActAs' in r.kind);
      assertEquals(hasCanActAs, true, 'ent-alice-user should have CanActAs right');

      // Check for CanReadAs right
      const hasCanReadAs = aliceRights.some((r) => 'CanReadAs' in r.kind);
      assertEquals(hasCanReadAs, true, 'ent-alice-user should have CanReadAs right');

      // Verify ent-admin-user exists and has ParticipantAdmin
      const adminUser = usersWithRights.find((u) => u.id === 'ent-admin-user');
      assertExists(adminUser, 'ent-admin-user should exist');

      const hasParticipantAdmin = adminUser.rights.some((r) => 'ParticipantAdmin' in r.kind);
      assertEquals(hasParticipantAdmin, true, 'ent-admin-user should have ParticipantAdmin right');

      // Verify ent-multi-user exists and has rights on multiple parties
      const multiUser = usersWithRights.find((u) => u.id === 'ent-multi-user');
      assertExists(multiUser, 'ent-multi-user should exist');

      // ent-multi-user should have CanActAs on ent-alice (primaryParty), ent-bob, and ent-auto-party
      const multiCanActAs = multiUser.rights.filter((r) => 'CanActAs' in r.kind);
      assertEquals(
        multiCanActAs.length >= 3,
        true,
        'ent-multi-user should have CanActAs on at least 3 parties',
      );
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Entitlements: auto-allocated party exists',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      const parties = await localnet.getParties(VALIDATOR);

      // ent-auto-party should have been auto-allocated (referenced by ent-multi-user but NOT in top-level parties)
      const autoParty = parties.find((p) => p.hint === 'ent-auto-party');
      assertExists(autoParty, 'ent-auto-party should be auto-allocated');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Entitlements: getUsersWithRights returns correct data structure',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      const usersWithRights = await localnet.getUsersWithRights(VALIDATOR);

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
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'Entitlements: admin-user can perform admin operations',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('INIT');

    try {
      // Create a per-user client for ent-admin-user
      const ports = getValidatorPorts(0);
      const adminClient = CantonClient.forUser(
        `http://localhost:${ports.jsonApi}`,
        'ent-admin-user',
        {
          keycloakUrl: getKeycloakUrl(SHARED_NETWORKS.INIT),
          realm: getRealmName(VALIDATOR),
          userClientId: getLedgerApiUserClientId(VALIDATOR),
        },
      );

      // ent-admin-user should be able to list users (ParticipantAdmin operation)
      const users = await adminClient.listUsers();
      assertEquals(Array.isArray(users), true, 'ent-admin-user should be able to list users');
      assertEquals(users.length >= 3, true, 'ent-admin-user should see at least 3 users');
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});
