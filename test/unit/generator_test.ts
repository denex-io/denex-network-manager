import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import type { LocalNetConfig } from '../../src/types/config.ts';
import {
  BOOTSTRAP_ADMIN_USERNAME,
  generateAllRealms,
  generateAllRealmsJson,
  generateCommonEnv,
  generateFullCantonConfig,
  generateFullSpliceConfig,
  generateMasterRealm,
  generateMergedEnv,
  generatePortMappingEnv,
  generatePostgresEnv,
  generateSvRealm,
  generateValidatorRealm,
} from '../../src/generator/mod.ts';

const TEST_CONFIG: LocalNetConfig = {
  validators: 2,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

const DETAILED_CONFIG: LocalNetConfig = {
  validators: [
    { name: 'alice', parties: [{ hint: 'alice-party' }] },
    { name: 'bob', parties: [{ hint: 'bob-party' }] },
  ],
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

Deno.test('generateFullCantonConfig - includes SV and validators', () => {
  const config = generateFullCantonConfig(TEST_CONFIG.validators);

  assertStringIncludes(config, 'canton.participants.sv');
  assertStringIncludes(config, 'canton.sequencers.sequencer');
  assertStringIncludes(config, 'canton.mediators.mediator');
  assertStringIncludes(config, 'canton.participants.validator_1');
  assertStringIncludes(config, 'canton.participants.validator_2');
});

Deno.test('generateFullCantonConfig - correct port allocation', () => {
  const config = generateFullCantonConfig(TEST_CONFIG.validators);

  assertStringIncludes(config, 'ledger-api.port = 5001');
  assertStringIncludes(config, 'ledger-api.port = 5101');
  assertStringIncludes(config, 'ledger-api.port = 5201');
});

Deno.test('generateFullCantonConfig - custom validator names', () => {
  const config = generateFullCantonConfig(DETAILED_CONFIG.validators);

  assertStringIncludes(config, 'canton.participants.alice');
  assertStringIncludes(config, 'canton.participants.bob');
});

Deno.test('generateFullSpliceConfig - includes SV apps', () => {
  const config = generateFullSpliceConfig(
    TEST_CONFIG.validators,
    TEST_CONFIG.auth,
  );

  assertStringIncludes(config, 'validator-apps.sv-validator_backend');
  assertStringIncludes(config, 'scan-apps.scan-app');
  assertStringIncludes(config, 'sv-apps.sv');
});

Deno.test('generateFullSpliceConfig - includes validator backends', () => {
  const config = generateFullSpliceConfig(
    TEST_CONFIG.validators,
    TEST_CONFIG.auth,
  );

  assertStringIncludes(config, 'canton.validator-apps.validator_1-validator_backend');
  assertStringIncludes(config, 'canton.validator-apps.validator_2-validator_backend');
});

Deno.test('generateFullSpliceConfig - onboarding secrets', () => {
  const config = generateFullSpliceConfig(
    TEST_CONFIG.validators,
    TEST_CONFIG.auth,
  );

  assertStringIncludes(config, 'validator-1-onboarding-secret');
  assertStringIncludes(config, 'validator-2-onboarding-secret');
});

Deno.test('generateFullSpliceConfig - OAuth2 mode uses RS-256 with JWKS', () => {
  const config = generateFullSpliceConfig(
    TEST_CONFIG.validators,
    TEST_CONFIG.auth,
  );

  assertStringIncludes(config, 'algorithm = "rs-256"');
  assertStringIncludes(
    config,
    'jwks-url = "http://keycloak:8080/realms/SV/protocol/openid-connect/certs"',
  );
  assertStringIncludes(
    config,
    'jwks-url = "http://keycloak:8080/realms/Validator1/protocol/openid-connect/certs"',
  );
  assertStringIncludes(
    config,
    'jwks-url = "http://keycloak:8080/realms/Validator2/protocol/openid-connect/certs"',
  );
});

Deno.test('generateCommonEnv - includes database config', () => {
  const env = generateCommonEnv(TEST_CONFIG);

  assertStringIncludes(env, 'DB_USER=cnadmin');
  assertStringIncludes(env, 'DB_PASSWORD=supersafe');
  assertStringIncludes(env, 'DB_SERVER=postgres');
});

Deno.test('generateCommonEnv - includes port suffixes', () => {
  const env = generateCommonEnv(TEST_CONFIG);

  assertStringIncludes(env, 'PARTICIPANT_LEDGER_API_PORT_SUFFIX=1');
  assertStringIncludes(env, 'PARTICIPANT_ADMIN_API_PORT_SUFFIX=2');
  assertStringIncludes(env, 'VALIDATOR_ADMIN_API_PORT_SUFFIX=3');
});

Deno.test('generateCommonEnv - includes audience', () => {
  const env = generateCommonEnv(TEST_CONFIG);

  assertStringIncludes(env, 'SPLICE_APP_VALIDATOR_AUTH_AUDIENCE=https://canton.network.global');
});

Deno.test('generatePostgresEnv - includes all required databases', () => {
  const env = generatePostgresEnv(TEST_CONFIG);

  assertStringIncludes(env, 'participant-sv');
  assertStringIncludes(env, 'validator-sv');
  assertStringIncludes(env, 'sequencer');
  assertStringIncludes(env, 'mediator');
  assertStringIncludes(env, 'scan');
  assertStringIncludes(env, 'participant-validator-1');
  assertStringIncludes(env, 'participant-validator-2');
});

Deno.test('generateMergedEnv - combines all env sections', () => {
  const env = generateMergedEnv(TEST_CONFIG);

  assertStringIncludes(env, 'DB_USER=');
  assertStringIncludes(env, 'POSTGRES_USER=');
  assertStringIncludes(env, 'TARGET_TRAFFIC_THROUGHPUT=');
  assertStringIncludes(env, 'AUTH_SV_AUDIENCE=');
});

Deno.test('generateSvRealm - creates valid realm structure', () => {
  const realm = generateSvRealm(TEST_CONFIG);

  assertEquals(realm.realm, 'SV');
  assertEquals(realm.enabled, true);
  assertEquals(realm.sslRequired, 'none');
});

Deno.test('generateSvRealm - includes required clients', () => {
  const realm = generateSvRealm(TEST_CONFIG);

  const clientIds = realm.clients.map((c) => c.clientId);
  assertEquals(clientIds.includes('sv-validator'), true);
  assertEquals(clientIds.includes('sv-web-ui'), true);
  assertEquals(clientIds.includes('sv-ledger-api-user'), true);
});

Deno.test('generateSvRealm - creates SV browser users', () => {
  const realm = generateSvRealm(TEST_CONFIG);

  const usernames = realm.users?.map((user) => user.username) ?? [];
  assertEquals(usernames.includes('sv'), true);
  assertEquals(usernames.length, 1);
});

Deno.test('generateSvRealm - includes audience client scope', () => {
  const realm = generateSvRealm(TEST_CONFIG);

  const audienceScope = realm.clientScopes.find((s) => s.name === 'canton-audience');
  assertEquals(audienceScope !== undefined, true);

  const mapper = audienceScope!.protocolMappers[0];
  assertEquals(mapper.config['included.custom.audience'], 'https://canton.network.global');
});

Deno.test('generateSvRealm - includes standard OAuth scopes', () => {
  const realm = generateSvRealm(TEST_CONFIG);

  const scopeNames = realm.clientScopes.map((s) => s.name);
  assertEquals(scopeNames.includes('offline_access'), true);
  assertEquals(scopeNames.includes('profile'), true);
  assertEquals(scopeNames.includes('email'), true);
  assertEquals(realm.defaultOptionalClientScopes?.includes('offline_access'), true);
});

Deno.test('generateSvRealm - UI clients have proper scopes', () => {
  const realm = generateSvRealm(TEST_CONFIG);

  // Find all UI clients (public clients with standard flow)
  const uiClients = realm.clients.filter((c) => c.publicClient && c.standardFlowEnabled);
  assertEquals(uiClients.length >= 3, true); // sv-web-ui, sv-wallet, scan-web-ui

  for (const client of uiClients) {
    // UI clients should have profile, email, etc. as default scopes
    assertEquals(
      client.defaultClientScopes.includes('profile'),
      true,
      `${client.clientId} missing profile scope`,
    );
    assertEquals(
      client.defaultClientScopes.includes('email'),
      true,
      `${client.clientId} missing email scope`,
    );
    // UI clients should have offline_access as optional scope
    assertEquals(
      client.optionalClientScopes?.includes('offline_access'),
      true,
      `${client.clientId} missing offline_access optional scope`,
    );
  }
});

Deno.test('generateValidatorRealm - wallet client has proper scopes', () => {
  const realm = generateValidatorRealm(
    { name: 'test-validator' },
    0,
    TEST_CONFIG,
  );

  const walletClient = realm.clients.find((c) => c.clientId === 'test-validator-wallet');
  assertEquals(walletClient !== undefined, true);
  assertEquals(walletClient!.defaultClientScopes.includes('profile'), true);
  assertEquals(walletClient!.defaultClientScopes.includes('email'), true);
  assertEquals(walletClient!.optionalClientScopes?.includes('offline_access'), true);
});

Deno.test('generateValidatorRealm - uses correct realm name', () => {
  const realm = generateValidatorRealm(
    { name: 'alice-validator' },
    0,
    TEST_CONFIG,
  );

  assertEquals(realm.realm, 'AliceValidator');
});

Deno.test('generateValidatorRealm - includes standard clients', () => {
  const realm = generateValidatorRealm(
    { name: 'test-validator' },
    0,
    TEST_CONFIG,
  );

  const clientIds = realm.clients.map((c) => c.clientId);
  assertEquals(clientIds.includes('test-validator-validator'), true);
  assertEquals(clientIds.includes('test-validator-wallet'), true);
  assertEquals(clientIds.includes('test-validator-ledger-api-user'), true);
  assertEquals(clientIds.includes('test-validator-backend'), true);
  assertEquals(clientIds.includes('test-validator-pqs'), true);
});

Deno.test('generateValidatorRealm - creates default user', () => {
  const realm = generateValidatorRealm(
    { name: 'alice' },
    0,
    TEST_CONFIG,
  );

  assertEquals(realm.users?.length, 2);
  assertEquals(realm.users?.[0].username, 'alice');
  assertEquals(realm.users?.[1].username, 'alice-wallet-admin');
});

Deno.test('generateValidatorRealm - config user matching validator name is not duplicated', () => {
  const realm = generateValidatorRealm(
    { name: 'alice', users: [{ id: 'alice' }] },
    0,
    TEST_CONFIG,
  );

  const usernames = realm.users?.map((user) => user.username) ?? [];
  assertEquals(usernames.filter((name) => name === 'alice').length, 1);
  // Default user + wallet admin, config 'alice' collapses into the default user.
  assertEquals(realm.users?.length, 2);
});

Deno.test('generateValidatorRealm - distinct config users are all added', () => {
  const realm = generateValidatorRealm(
    { name: 'alice', users: [{ id: 'carol' }, { id: 'dave' }] },
    0,
    TEST_CONFIG,
  );

  const usernames = realm.users?.map((user) => user.username) ?? [];
  assertEquals(usernames, ['alice', 'alice-wallet-admin', 'carol', 'dave']);
});

Deno.test('generateMasterRealm - returns realm named "master"', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.realm, 'master');
});

Deno.test('generateMasterRealm - sslRequired is "none"', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.sslRequired, 'none');
});

Deno.test('generateMasterRealm - is enabled', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.enabled, true);
});

Deno.test('generateMasterRealm - admin user uses config admin username', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.users?.[0].username, 'admin');

  const customConfig: LocalNetConfig = {
    ...TEST_CONFIG,
    auth: { keycloak: { admin: 'myadmin', password: 'pw' } },
  };
  const customRealm = generateMasterRealm(customConfig);
  assertEquals(customRealm.users?.[0].username, 'myadmin');
});

Deno.test('generateMasterRealm - admin user password matches config', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.users?.[0].credentials?.[0].value, TEST_CONFIG.auth.keycloak.password);

  const customConfig: LocalNetConfig = {
    ...TEST_CONFIG,
    auth: { keycloak: { admin: 'admin', password: 'custom-pw' } },
  };
  const customRealm = generateMasterRealm(customConfig);
  assertEquals(customRealm.users?.[0].credentials?.[0].value, 'custom-pw');
});

Deno.test('generateMasterRealm - admin user has empty requiredActions (avoids "Account is not fully set up")', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.users?.[0].requiredActions, []);
});

Deno.test('generateMasterRealm - admin user has full profile (firstName, lastName, email)', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertExists(realm.users?.[0].firstName);
  assert(realm.users![0].firstName!.length > 0);
  assertExists(realm.users?.[0].lastName);
  assert(realm.users![0].lastName!.length > 0);
  assertExists(realm.users?.[0].email);
  assert(realm.users![0].email!.length > 0);
});

Deno.test('generateMasterRealm - admin user has emailVerified: true', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assertEquals(realm.users?.[0].emailVerified, true);
});

Deno.test('generateMasterRealm - admin user has admin realm role', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assert(realm.users?.[0].realmRoles?.includes('admin'));
});

Deno.test('generateMasterRealm - admin user has master-realm:realm-admin client role (allows admin REST API)', () => {
  const realm = generateMasterRealm(TEST_CONFIG);
  assert(realm.users?.[0].clientRoles?.['master-realm']?.includes('realm-admin'));
});

Deno.test('generateAllRealms - master realm is first', () => {
  const realms = generateAllRealms(TEST_CONFIG);
  assertEquals(realms[0].realm, 'master');
});

Deno.test('generateAllRealmsJson - emits master-realm.json with sslRequired none', () => {
  const m = generateAllRealmsJson(TEST_CONFIG);
  const masterJson = m.get('master-realm.json');
  assertExists(masterJson);
  const parsed = JSON.parse(masterJson!);
  assertEquals(parsed.sslRequired, 'none');
});

Deno.test('BOOTSTRAP_ADMIN_USERNAME constant matches expected sentinel value', () => {
  assertEquals(BOOTSTRAP_ADMIN_USERNAME, 'localnet-internal-bootstrap-do-not-use');
});

Deno.test('generateAllRealms - creates SV plus all validators', () => {
  const realms = generateAllRealms(TEST_CONFIG);

  assertEquals(realms.length, 4);
  assertEquals(realms[0].realm, 'master');
  assertEquals(realms[1].realm, 'SV');
  assertEquals(realms[2].realm, 'Validator1');
  assertEquals(realms[3].realm, 'Validator2');
});

Deno.test('generateAllRealms - with custom validators', () => {
  const realms = generateAllRealms(DETAILED_CONFIG);

  assertEquals(realms.length, 4);
  assertEquals(realms[0].realm, 'master');
  assertEquals(realms[1].realm, 'SV');
  assertEquals(realms[2].realm, 'Alice');
  assertEquals(realms[3].realm, 'Bob');
});

Deno.test('generateFullSpliceConfig - generates validator-party-hint from validator name, not user parties', () => {
  const config: LocalNetConfig = {
    validators: [
      { name: 'alice', parties: [{ hint: 'alice' }] },
      { name: 'bob', parties: [{ hint: 'bob' }] },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const result = generateFullSpliceConfig(config.validators, config.auth);
  // validator-party-hint is derived from validator name, not user party hints
  assertStringIncludes(result, 'validator-party-hint = "localnet-alice-1"');
  assertStringIncludes(result, 'validator-party-hint = "localnet-bob-2"');
});

Deno.test('generateFullSpliceConfig - validator-party-hint ignores user party config', () => {
  const config: LocalNetConfig = {
    validators: [
      { name: 'v1', parties: [{ hint: 'myorg-validator-1' }] },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const result = generateFullSpliceConfig(config.validators, config.auth);
  // validator-party-hint is derived from validator name, not from user party hints
  assertStringIncludes(result, 'validator-party-hint = "localnet-v1-1"');
});

Deno.test('generateFullSpliceConfig - default party hint matches pattern', () => {
  const config: LocalNetConfig = {
    validators: 1, // No explicit party hints
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const result = generateFullSpliceConfig(config.validators, config.auth);
  // Default name is 'validator-1', sanitized to 'validator1', forms 'localnet-validator1-1'
  assertStringIncludes(result, 'validator-party-hint = "localnet-validator1-1"');
});

Deno.test('generateFullSpliceConfig - validator-party-hint is independent of user parties', () => {
  const config: LocalNetConfig = {
    validators: [
      { name: 'myvalidator', parties: [{ hint: 'totally-different-1' }] },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const result = generateFullSpliceConfig(config.validators, config.auth);
  // validator-party-hint must come from name, not from parties
  assertStringIncludes(result, 'validator-party-hint = "localnet-myvalidator-1"');
  // The user party hint must NOT appear in validator-party-hint
  assertEquals(result.includes('validator-party-hint = "totally-different-1"'), false);
});

Deno.test('generateFullSpliceConfig - handles hyphenated validator names in party hint', () => {
  const config: LocalNetConfig = {
    validators: [
      { name: 'alice-validator' },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const result = generateFullSpliceConfig(config.validators, config.auth);
  // Hyphens stripped from name, forms valid 3-segment pattern
  assertStringIncludes(result, 'validator-party-hint = "localnet-alicevalidator-1"');
});

Deno.test('generateFullCantonConfig - SV internal ports at default basePort', () => {
  const config = generateFullCantonConfig(TEST_CONFIG);
  for (const port of [5008, 5009, 5062, 5007, 5063]) {
    assertStringIncludes(config, `port = ${port}`);
  }
});

Deno.test('generateFullCantonConfig - SV internal ports follow basePort', () => {
  const config = generateFullCantonConfig({ ...TEST_CONFIG, basePort: 7000 });
  for (const port of [7008, 7009, 7062, 7007, 7063]) {
    assertStringIncludes(config, `port = ${port}`);
  }
  for (const port of [5007, 5008, 5009, 5062, 5063]) {
    assert(!config.includes(`port = ${port}`), `unexpected port ${port}`);
  }
});

Deno.test('generateFullSpliceConfig - SV internal ports follow basePort', () => {
  const config = generateFullSpliceConfig({ ...TEST_CONFIG, basePort: 7000 });
  assertStringIncludes(config, 'port = 7012');
  assertStringIncludes(config, 'port = 7014');
  assertStringIncludes(config, 'url = "http://localhost:7012"');
  assertStringIncludes(config, 'public-url = "http://localhost:7012"');
  assertStringIncludes(config, 'internal-url = "http://localhost:7012"');
  assertStringIncludes(config, 'external-public-api-url = "http://canton:7008"');
  assertStringIncludes(config, 'port = 7009');
  assertStringIncludes(config, 'port = 7007');
  assertStringIncludes(config, 'seed-urls.0 = "http://localhost:7012"');
  assertStringIncludes(config, 'url = "http://localhost:7014"');
  for (const n of ['5012', '5014', '5008']) {
    assert(!config.includes(n), `unexpected ${n}`);
  }
});

Deno.test('generateFullSpliceConfig - default basePort keeps 5012/5014/5008', () => {
  const config = generateFullSpliceConfig(TEST_CONFIG);
  assertStringIncludes(config, 'port = 5012');
  assertStringIncludes(config, 'port = 5014');
  assertStringIncludes(config, 'external-public-api-url = "http://canton:5008"');
});

Deno.test('generateFullSpliceConfig - replaces the image Prometheus reporter with none', () => {
  for (const basePort of [undefined, 7000, 10000]) {
    const config = generateFullSpliceConfig(
      basePort === undefined ? TEST_CONFIG : { ...TEST_CONFIG, basePort },
    );
    assert(!config.includes('type = prometheus'));
    assertEquals(config.match(/canton\.monitoring\.metrics\.reporters = \[\]\n/g)?.length, 1);
  }
});

Deno.test('generateFullCantonConfig - replaces the image Prometheus reporter with none', () => {
  for (const basePort of [undefined, 7000, 10000]) {
    const config = generateFullCantonConfig(
      basePort === undefined ? TEST_CONFIG : { ...TEST_CONFIG, basePort },
    );
    assert(!config.includes('type = prometheus'));
    assertEquals(config.match(/canton\.monitoring\.metrics\.reporters = \[\]\n/g)?.length, 1);
  }
});

Deno.test('generatePortMappingEnv - SV internal ports follow basePort', () => {
  const env = generatePortMappingEnv({ ...TEST_CONFIG, basePort: 7000 });
  assertStringIncludes(env, 'SV_SEQUENCER_PUBLIC_PORT=7008');
  assertStringIncludes(env, 'SV_SEQUENCER_ADMIN_PORT=7009');
  assertStringIncludes(env, 'SV_MEDIATOR_ADMIN_PORT=7007');
  assertStringIncludes(env, 'SV_SCAN_ADMIN_PORT=7012');
  assertStringIncludes(env, 'SV_SV_ADMIN_PORT=7014');
});

Deno.test('generateFullCantonConfig - storage pools are 8 connections', () => {
  const config = generateFullCantonConfig(TEST_CONFIG);
  assertStringIncludes(config, 'max-connections = 8\n');
  assert(!config.includes('max-connections = 32'));
});

Deno.test('generateFullCantonConfig - no deprecated initial-protocol-version', () => {
  assert(!generateFullCantonConfig(TEST_CONFIG).includes('initial-protocol-version'));
});

Deno.test('generateFullCantonConfig - Daml debug output logs at INFO', () => {
  const config = generateFullCantonConfig(TEST_CONFIG);
  assertEquals(config.match(/submission-phase-logging/g)?.length, 1);
  // Inside the participant template's parameters block, which every participant inherits.
  const template = config.slice(
    config.indexOf('_participant {'),
    config.indexOf('canton.participants.sv = '),
  );
  const parameters = template.slice(template.indexOf('\n  parameters {'));
  assertStringIncludes(
    parameters.slice(0, parameters.indexOf('\n  }')),
    '    engine.submission-phase-logging.log-level = INFO',
  );
});

Deno.test('generateFullCantonConfig - max-commands-in-flight only on the SV participant', () => {
  const config = generateFullCantonConfig(TEST_CONFIG);
  assertEquals(config.match(/max-commands-in-flight = 30/g)?.length, 1);
  const svBlock = config.slice(
    config.indexOf('canton.participants.sv = '),
    config.indexOf('canton.sequencers.sequencer'),
  );
  // Under the SV participant's ledger-api block.
  const ledgerApi = svBlock.slice(svBlock.indexOf('  ledger-api {'));
  assertStringIncludes(
    ledgerApi.slice(0, ledgerApi.indexOf('\n  }')),
    '    command-service.max-commands-in-flight = 30',
  );
  const participantTemplate = config.slice(
    config.indexOf('_participant {'),
    config.indexOf('canton.participants.sv = '),
  );
  assert(!participantTemplate.includes('max-commands-in-flight'));
});

Deno.test('generateFullSpliceConfig - storage pools are 8 connections', () => {
  const config = generateFullSpliceConfig(TEST_CONFIG);
  assertStringIncludes(config, 'max-connections = 8\n');
  assert(!config.includes('max-connections = 32'));
});

Deno.test('generateFullSpliceConfig - no removed domain-migration-id', () => {
  assert(!generateFullSpliceConfig(TEST_CONFIG).includes('domain-migration-id'));
});

Deno.test('generateFullSpliceConfig - every validator supports embedded party signing keys', () => {
  const config = generateFullSpliceConfig(TEST_CONFIG);
  const template = config.slice(
    config.indexOf('_validator_backend {'),
    config.indexOf('canton.features'),
  );
  assertStringIncludes(template, 'support-embedded-party-signing-keys = true');
  // The SV validator and both validators inherit the template.
  assertEquals(config.match(/= \$\{_validator_backend\}/g)?.length, 3);
});

Deno.test('generateFullSpliceConfig - Scan and SV turn off the per-client-IP rate limit', () => {
  const config = generateFullSpliceConfig(TEST_CONFIG);
  const block = config.slice(
    config.indexOf('_rate_limiting {'),
    config.indexOf('_validator_backend {'),
  );
  assertStringIncludes(block, 'client-ip-headers = []');
  // Splice 0.6.6 requires both whenever rate-limiting is set.
  assertStringIncludes(block, 'default { enabled = true, rate-per-second = 200 }');
  assertStringIncludes(block, 'rate-limiters {}');
  assertEquals(config.match(/parameters\.rate-limiting = \$\{_rate_limiting\}/g)?.length, 2);
  const scan = config.slice(config.indexOf('scan-apps.scan-app {'), config.indexOf('sv-apps.sv {'));
  assertStringIncludes(scan, 'parameters.rate-limiting = ${_rate_limiting}');
  const sv = config.slice(config.indexOf('sv-apps.sv {'));
  assertStringIncludes(sv, 'parameters.rate-limiting = ${_rate_limiting}');
});
