import { assertEquals, assertExists } from '@std/assert';
import { LocalNet } from '../../src/mod.ts';
import { KeycloakAdminClient } from '../../src/api/keycloak-admin.ts';
import { getKeycloakUrl, type LocalNetConfig } from '../../src/types/config.ts';
import { getValidatorPorts } from '../../src/utils/ports.ts';
import { isDockerAvailable } from './helpers.ts';

function makeConfig(validators: string[] | number = 1): LocalNetConfig {
  return {
    validators: typeof validators === 'number'
      ? validators
      : validators.map((name) => ({ name })),
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
}

function uniqueInstanceId(): string {
  return `runtime-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

Deno.test('runtime createUser: happy path full lifecycle', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(['validator-1']);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    await localnet.createUser('alice', 'validator-1', { primaryParty: 'alice' });

    const users = await localnet.getUsers('validator-1');
    const alice = users.find((u) => u.id === 'alice');
    assertExists(alice, 'alice ledger user should exist');

    const parties = await localnet.getParties('validator-1');
    const aliceParty = parties.find((p) => p.hint === 'alice');
    assertExists(aliceParty, 'alice party should be auto-allocated');

    const tokenUrl = `${getKeycloakUrl(config)}/realms/Validator1/protocol/openid-connect/token`;
    const tokenResp = await globalThis.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'validator-1-ledger-api-user',
        username: 'alice',
        password: 'alice',
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
    assertEquals(walletStatus.user_onboarded, true, 'alice should be wallet-onboarded');
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('runtime createUser: multi-party rights', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(['validator-1']);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    await localnet.createUser('charlie', 'validator-1', {
      parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
    });

    const parties = await localnet.getParties('validator-1');
    const bobParty = parties.find((p) => p.hint === 'bob');
    assertExists(bobParty, 'bob party should be auto-allocated');

    const usersWithRights = await localnet.getUsersWithRights('validator-1');
    const charlie = usersWithRights.find((u) => u.id === 'charlie');
    assertExists(charlie, 'charlie should be present in usersWithRights');

    const hasCanReadAsBob = charlie.rights.some((r) => {
      const kind = r.kind as Record<string, { value: { party?: string } }>;
      return 'CanReadAs' in kind && kind.CanReadAs.value.party === bobParty.partyId;
    });
    assertEquals(hasCanReadAsBob, true, 'charlie should have CanReadAs on bob party');
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('runtime createUser: admin-only (no primaryParty)', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(['validator-1']);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    await localnet.createUser('admin', 'validator-1', { rights: ['ParticipantAdmin'] });

    const usersWithRights = await localnet.getUsersWithRights('validator-1');
    const admin = usersWithRights.find((u) => u.id === 'admin');
    assertExists(admin, 'admin user should exist');

    const hasParticipantAdmin = admin.rights.some((r) => {
      const kind = r.kind as Record<string, unknown>;
      return 'ParticipantAdmin' in kind;
    });
    assertEquals(hasParticipantAdmin, true, 'admin should have ParticipantAdmin right');
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('runtime createUser: idempotency', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(['validator-1']);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    const first = await localnet.createUser('alice', 'validator-1', { primaryParty: 'alice' });
    const usersAfterFirst = await localnet.getUsers('validator-1');
    const countAfterFirst = usersAfterFirst.length;

    const second = await localnet.createUser('alice', 'validator-1', { primaryParty: 'alice' });
    assertEquals(second.id, first.id, 'second createUser should return same user id');

    const usersAfterSecond = await localnet.getUsers('validator-1');
    assertEquals(
      usersAfterSecond.length,
      countAfterFirst,
      'user count should be unchanged after second createUser',
    );
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('runtime createUser: multi-validator isolation', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(['validator-1', 'validator-2']);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    await localnet.createUser('alice', 'validator-1');

    const adminClient = new KeycloakAdminClient(
      getKeycloakUrl(config),
      config.auth.keycloak.admin,
      config.auth.keycloak.password,
    );

    const aliceInValidator1 = await adminClient.findUser('Validator1', 'alice');
    assertExists(aliceInValidator1, 'alice should exist in Validator1 realm');

    const aliceInValidator2 = await adminClient.findUser('Validator2', 'alice');
    assertEquals(aliceInValidator2, null, 'alice should NOT exist in Validator2 realm');
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('runtime createUser: SV-specific case (resolveRealmName)', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(1);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    await localnet.createUser('sv-helper', 'sv', { rights: ['ParticipantAdmin'] });

    const adminClient = new KeycloakAdminClient(
      getKeycloakUrl(config),
      config.auth.keycloak.admin,
      config.auth.keycloak.password,
    );

    // resolveRealmName special-case: 'sv' → 'SV', NOT title-cased 'Sv'.
    // Without this assertion, a future cleanup pass might switch findUser('SV')
    // to findUser('Sv') for "consistency" and silently break the test.
    const inSvRealm = await adminClient.findUser('SV', 'sv-helper');
    assertExists(inSvRealm, 'sv-helper should exist in SV realm');

    const inSvTitleCased = await adminClient.findUser('Sv', 'sv-helper');
    assertEquals(inSvTitleCased, null, 'Sv (title-cased) realm should not exist / contain user');

    await localnet.createUser('sv-party-user', 'sv', { primaryParty: 'svparty' });
    const svUsers = await localnet.getUsers('sv');
    const svPartyUser = svUsers.find((u) => u.id === 'sv-party-user');
    assertExists(svPartyUser, 'sv-party-user should be created on SV participant');
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('runtime createUser: performance bound (< 30s)', async () => {
  if (!await isDockerAvailable()) {
    console.log('Skipped: Docker unavailable');
    return;
  }

  const config = makeConfig(['validator-1']);
  const localnet = await LocalNet.fromConfig(config, { instanceId: uniqueInstanceId() });

  try {
    await localnet.start({ timeout: 300000 });

    const createUserPromise = localnet.createUser('perf-test', 'validator-1');
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('createUser exceeded 30s')), 30_000)
    );

    await Promise.race([createUserPromise, timeoutPromise]);
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});
