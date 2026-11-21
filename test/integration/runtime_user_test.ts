import { assertEquals, assertExists } from '@std/assert';
import { KeycloakAdminClient } from '../../src/api/keycloak-admin.ts';
import { getKeycloakUrl } from '../../src/types/config.ts';
import { getValidatorPorts } from '../../src/utils/ports.ts';
import { isDockerAvailable } from './helpers.ts';
import {
  acquireSharedLocalNet,
  releaseSharedLocalNet,
  SHARED_NETWORKS,
} from './shared_localnet.ts';

// Every test runs on the shared network S2 (validator-1 and validator-2) and creates users and
// parties whose names start with `rt-<test>-`, so no two tests, and no config entry, share one.
const config = SHARED_NETWORKS.S2;

Deno.test('runtime createUser: happy path full lifecycle', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    await localnet.createUser('rt-happy-alice', 'validator-1', { primaryParty: 'rt-happy-alice' });

    const users = await localnet.getUsers('validator-1');
    const alice = users.find((u) => u.id === 'rt-happy-alice');
    assertExists(alice, 'rt-happy-alice ledger user should exist');

    const parties = await localnet.getParties('validator-1');
    const aliceParty = parties.find((p) => p.hint === 'rt-happy-alice');
    assertExists(aliceParty, 'rt-happy-alice party should be auto-allocated');

    const tokenUrl = `${getKeycloakUrl(config)}/realms/Validator1/protocol/openid-connect/token`;
    const tokenResp = await globalThis.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'validator-1-ledger-api-user',
        username: 'rt-happy-alice',
        password: 'rt-happy-alice',
        scope: 'openid',
      }),
    });
    assertEquals(tokenResp.status, 200, 'token grant should return 200');
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    assertEquals(typeof accessToken, 'string', 'access_token should be a string');
    assertEquals(accessToken.length > 0, true, 'access_token should be non-empty');

    const validatorPorts = getValidatorPorts(0, config.basePort ?? 5000);
    const walletStatusResp = await globalThis.fetch(
      `http://localhost:${validatorPorts.validatorAdminApi}/api/validator/v0/wallet/user-status`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    assertEquals(walletStatusResp.status, 200, 'wallet user-status should return 200');
    const walletStatus = await walletStatusResp.json();
    assertEquals(walletStatus.user_onboarded, true, 'rt-happy-alice should be wallet-onboarded');
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: multi-party rights', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    await localnet.createUser('rt-mp-charlie', 'validator-1', {
      parties: [{ hint: 'rt-mp-bob', rights: ['CanReadAs'] }],
    });

    const parties = await localnet.getParties('validator-1');
    const bobParty = parties.find((p) => p.hint === 'rt-mp-bob');
    assertExists(bobParty, 'rt-mp-bob party should be auto-allocated');

    const usersWithRights = await localnet.getUsersWithRights('validator-1');
    const charlie = usersWithRights.find((u) => u.id === 'rt-mp-charlie');
    assertExists(charlie, 'rt-mp-charlie should be present in usersWithRights');

    const hasCanReadAsBob = charlie.rights.some((r) => {
      const kind = r.kind as Record<string, { value: { party?: string } }>;
      return 'CanReadAs' in kind && kind.CanReadAs.value.party === bobParty.partyId;
    });
    assertEquals(hasCanReadAsBob, true, 'rt-mp-charlie should have CanReadAs on rt-mp-bob party');
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: admin-only (no primaryParty)', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    await localnet.createUser('rt-admin', 'validator-1', { rights: ['ParticipantAdmin'] });

    const usersWithRights = await localnet.getUsersWithRights('validator-1');
    const admin = usersWithRights.find((u) => u.id === 'rt-admin');
    assertExists(admin, 'rt-admin user should exist');

    const hasParticipantAdmin = admin.rights.some((r) => {
      const kind = r.kind as Record<string, unknown>;
      return 'ParticipantAdmin' in kind;
    });
    assertEquals(hasParticipantAdmin, true, 'rt-admin should have ParticipantAdmin right');
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: idempotency', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    // Both counts are taken inside this test, and the group's tests run one at a time, so no
    // neighbour adds a user between them.
    const first = await localnet.createUser('rt-idem-alice', 'validator-1', {
      primaryParty: 'rt-idem-alice',
    });
    const usersAfterFirst = await localnet.getUsers('validator-1');
    const countAfterFirst = usersAfterFirst.length;

    const second = await localnet.createUser('rt-idem-alice', 'validator-1', {
      primaryParty: 'rt-idem-alice',
    });
    assertEquals(second.id, first.id, 'second createUser should return same user id');

    const usersAfterSecond = await localnet.getUsers('validator-1');
    assertEquals(
      usersAfterSecond.length,
      countAfterFirst,
      'user count should be unchanged after second createUser',
    );
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: multi-validator isolation', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    await localnet.createUser('rt-iso-alice', 'validator-1');

    const adminClient = new KeycloakAdminClient(
      getKeycloakUrl(config),
      config.auth.keycloak.admin,
      config.auth.keycloak.password,
    );

    const aliceInValidator1 = await adminClient.findUser('Validator1', 'rt-iso-alice');
    assertExists(aliceInValidator1, 'rt-iso-alice should exist in Validator1 realm');

    const aliceInValidator2 = await adminClient.findUser('Validator2', 'rt-iso-alice');
    assertEquals(aliceInValidator2, null, 'rt-iso-alice should NOT exist in Validator2 realm');
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: SV-specific case (resolveRealmName)', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    await localnet.createUser('rt-sv-helper', 'sv', { rights: ['ParticipantAdmin'] });

    const adminClient = new KeycloakAdminClient(
      getKeycloakUrl(config),
      config.auth.keycloak.admin,
      config.auth.keycloak.password,
    );

    // resolveRealmName special-case: 'sv' → 'SV', NOT title-cased 'Sv'.
    // Without this assertion, a future cleanup pass might switch findUser('SV')
    // to findUser('Sv') for "consistency" and silently break the test.
    const inSvRealm = await adminClient.findUser('SV', 'rt-sv-helper');
    assertExists(inSvRealm, 'rt-sv-helper should exist in SV realm');

    const inSvTitleCased = await adminClient.findUser('Sv', 'rt-sv-helper');
    assertEquals(inSvTitleCased, null, 'Sv (title-cased) realm should not exist / contain user');

    await localnet.createUser('rt-sv-party-user', 'sv', { primaryParty: 'rt-svparty' });
    const svUsers = await localnet.getUsers('sv');
    const svPartyUser = svUsers.find((u) => u.id === 'rt-sv-party-user');
    assertExists(svPartyUser, 'rt-sv-party-user should be created on SV participant');
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: performance bound (< 30s)', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const createUserPromise = localnet.createUser('rt-perf-test', 'validator-1');
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('createUser exceeded 30s')), 30_000);
      });

      await Promise.race([createUserPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});

Deno.test('runtime createUser: same hint on two validators gives two distinct parties', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const localnet = await acquireSharedLocalNet('S2');

  try {
    await localnet.createUser('rt-hint-user-one', 'validator-1', {
      primaryParty: 'rt-hint-shared',
    });
    await localnet.createUser('rt-hint-user-two', 'validator-2', {
      primaryParty: 'rt-hint-shared',
    });

    const u1 = (await localnet.getUsers('validator-1')).find((u) => u.id === 'rt-hint-user-one');
    const u2 = (await localnet.getUsers('validator-2')).find((u) => u.id === 'rt-hint-user-two');
    assertExists(u1?.primaryParty);
    assertExists(u2?.primaryParty);

    const v2Parties = await localnet.getParties('validator-2');
    assertEquals(
      v2Parties.some((p) => p.partyId === u2.primaryParty),
      true,
      "u2's primaryParty should be hosted on validator-2",
    );
    // Same hint, different namespace, so a different party id.
    assertEquals(u1.primaryParty.startsWith('rt-hint-shared::'), true);
    assertEquals(u2.primaryParty.startsWith('rt-hint-shared::'), true);
    assertEquals(u1.primaryParty === u2.primaryParty, false);

    // Filtered to this test's hint: exactly its two parties, one per validator.
    const shared = (await localnet.getParties()).filter((p) => p.hint === 'rt-hint-shared');
    assertEquals(shared.length, 2);
    assertEquals(shared.map((p) => p.validator).sort(), ['validator-1', 'validator-2']);
  } finally {
    await releaseSharedLocalNet(localnet);
  }
});
