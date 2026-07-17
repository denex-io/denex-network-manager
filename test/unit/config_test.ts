import { assertEquals, assertExists } from '@std/assert';
import {
  buildConfigEnvironmentInfo,
  getSvPorts,
  getValidatorPorts,
  loadConfigFromString,
  normalizeValidators,
  parseLocalNetConfig,
  validateLocalNetConfig,
  withDefaults,
} from '../../src/mod.ts';
import { getRealmName } from '../../src/types/config.ts';

Deno.test('parseLocalNetConfig - minimal config with validator count', () => {
  const config = parseLocalNetConfig({
    validators: 2,
    auth: {
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  });

  assertEquals(config.validators, 2);
  assertEquals(config.auth.keycloak.admin, 'admin');
});

Deno.test('parseLocalNetConfig - detailed validator configs', () => {
  const config = parseLocalNetConfig({
    validators: [
      { name: 'alice-validator', parties: [{ hint: 'alice' }] },
      { name: 'bob-validator', parties: [{ hint: 'bob' }] },
    ],
    auth: {
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  });

  assertEquals(Array.isArray(config.validators), true);
  if (Array.isArray(config.validators)) {
    assertEquals(config.validators.length, 2);
    assertEquals(config.validators[0].name, 'alice-validator');
  }
});

Deno.test('validateLocalNetConfig - returns errors for invalid config', () => {
  const result = validateLocalNetConfig({
    validators: 0,
    auth: { keycloak: { admin: 123 } },
  });

  assertEquals(result.success, false);
});

Deno.test('withDefaults - creates config with defaults', () => {
  const config = withDefaults({ validators: 3 });

  assertEquals(config.validators, 3);
  assertEquals(config.auth.keycloak.admin, 'admin');
  // discovery is deprecated and must not be injected unless explicitly configured.
  assertEquals(config.discovery, undefined);
});

Deno.test('parseLocalNetConfig - auth.mode: oauth2 is preserved, not stripped', () => {
  const config = parseLocalNetConfig({
    validators: 1,
    auth: {
      mode: 'oauth2',
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  });

  assertEquals(config.auth.mode, 'oauth2');
  assertEquals(config.auth.keycloak.admin, 'admin');
});

Deno.test('normalizeValidators - number to array', () => {
  const validators = normalizeValidators(3);

  assertEquals(validators.length, 3);
  assertEquals(validators[0].name, 'validator-1');
  assertEquals(validators[1].name, 'validator-2');
  assertEquals(validators[2].name, 'validator-3');
});

Deno.test('normalizeValidators - preserves array', () => {
  const input = [{ name: 'custom' }];
  const validators = normalizeValidators(input);

  assertEquals(validators, input);
});

Deno.test('getValidatorPorts - correct port allocation', () => {
  const ports0 = getValidatorPorts(0);
  assertEquals(ports0.ledgerApi, 5101);
  assertEquals(ports0.adminApi, 5102);
  assertEquals(ports0.jsonApi, 5175);

  const ports1 = getValidatorPorts(1);
  assertEquals(ports1.ledgerApi, 5201);
  assertEquals(ports1.adminApi, 5202);

  const ports2 = getValidatorPorts(2);
  assertEquals(ports2.ledgerApi, 5301);
});

Deno.test('getSvPorts - correct SV port allocation', () => {
  const ports = getSvPorts();
  assertEquals(ports.ledgerApi, 5001);
  assertEquals(ports.adminApi, 5002);
  assertEquals(ports.jsonApi, 5075);
});

Deno.test('loadConfigFromString - parses YAML', () => {
  const yaml = `
validators: 2
auth:
  keycloak:
    admin: admin
    password: admin
`;
  const config = loadConfigFromString(yaml);
  assertEquals(config.validators, 2);
});

Deno.test('parseLocalNetConfig - old format backward compat: rights with CanActAs', () => {
  const config = parseLocalNetConfig({
    validators: [
      {
        name: 'test-validator',
        users: [
          { id: 'alice', primaryParty: 'alice', rights: ['CanActAs', 'CanReadAs'] },
        ],
        parties: [{ hint: 'alice' }],
      },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  if (Array.isArray(config.validators)) {
    const users = config.validators[0].users;
    assertEquals(users?.length, 1);
    assertEquals(users?.[0].id, 'alice');
    assertEquals(users?.[0].primaryParty, 'alice');
    assertEquals(users?.[0].rights, ['CanActAs', 'CanReadAs']);
  }
});

Deno.test('parseLocalNetConfig - new format: multi-party user', () => {
  const config = parseLocalNetConfig({
    validators: [
      {
        name: 'test-validator',
        users: [
          {
            id: 'alice',
            primaryParty: 'alice',
            parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
          },
        ],
        parties: [{ hint: 'alice' }, { hint: 'bob' }],
      },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  if (Array.isArray(config.validators)) {
    const users = config.validators[0].users;
    assertEquals(users?.length, 1);
    assertEquals(users?.[0].parties?.length, 1);
    assertEquals(users?.[0].parties?.[0].hint, 'bob');
    assertEquals(users?.[0].parties?.[0].rights, ['CanReadAs']);
  }
});

Deno.test('parseLocalNetConfig - participant-admin-only user (no primaryParty)', () => {
  const config = parseLocalNetConfig({
    validators: [
      {
        name: 'test-validator',
        users: [
          { id: 'admin', rights: ['ParticipantAdmin'] },
        ],
      },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  if (Array.isArray(config.validators)) {
    const users = config.validators[0].users;
    assertEquals(users?.length, 1);
    assertEquals(users?.[0].id, 'admin');
    assertEquals(users?.[0].primaryParty, undefined);
    assertEquals(users?.[0].rights, ['ParticipantAdmin']);
  }
});

Deno.test('parseLocalNetConfig - new participant-wide rights accepted', () => {
  const config = parseLocalNetConfig({
    validators: [
      {
        name: 'test-validator',
        users: [
          {
            id: 'super-admin',
            rights: [
              'ParticipantAdmin',
              'CanReadAsAnyParty',
              'CanExecuteAsAnyParty',
              'IdentityProviderAdmin',
            ],
          },
        ],
      },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  if (Array.isArray(config.validators)) {
    const users = config.validators[0].users;
    assertEquals(users?.[0].rights, [
      'ParticipantAdmin',
      'CanReadAsAnyParty',
      'CanExecuteAsAnyParty',
      'IdentityProviderAdmin',
    ]);
  }
});

Deno.test('parseLocalNetConfig - user parties default rights', () => {
  const config = parseLocalNetConfig({
    validators: [
      {
        name: 'test-validator',
        users: [
          {
            id: 'alice',
            primaryParty: 'alice',
            parties: [{ hint: 'bob' }], // No rights specified — should default to undefined (handled at runtime)
          },
        ],
        parties: [{ hint: 'alice' }, { hint: 'bob' }],
      },
    ],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  if (Array.isArray(config.validators)) {
    const users = config.validators[0].users;
    assertEquals(users?.[0].parties?.[0].hint, 'bob');
    assertEquals(users?.[0].parties?.[0].rights, undefined); // Not specified in config
  }
});

// --- getRealmName tests ---

Deno.test('getRealmName - simple validator name', () => {
  assertEquals(getRealmName('validator-1'), 'Validator1');
});

Deno.test('getRealmName - multi-segment name', () => {
  assertEquals(getRealmName('alice-validator'), 'AliceValidator');
});

Deno.test('getRealmName - single segment name', () => {
  assertEquals(getRealmName('app'), 'App');
});

Deno.test('getRealmName - three segment name', () => {
  assertEquals(getRealmName('my-cool-validator'), 'MyCoolValidator');
});

// --- buildConfigEnvironmentInfo tests ---

Deno.test('buildConfigEnvironmentInfo - default config has correct structure', () => {
  const config = { validators: 2, auth: { keycloak: { admin: 'admin', password: 'admin' } } };
  const info = buildConfigEnvironmentInfo(config);

  // Network
  assertEquals(info.network.domainId, null);
  assertEquals(info.network.dsoPartyId, null);

  // SV validator
  assertExists(info.validators.sv);
  assertEquals(info.validators.sv.role, 'sv');
  assertEquals(info.validators.sv.endpoints.ledgerApi, 'http://localhost:5001');
  assertEquals(info.validators.sv.endpoints.webUi, 'http://sv.localhost:5080');
  assertEquals(info.validators.sv.auth.realm, 'SV');
  assertEquals(info.validators.sv.auth.clientId, 'sv-validator');
  assertEquals(info.validators.sv.auth.clientSecret, 'sv-validator-secret');

  // Validator 1
  assertExists(info.validators['validator-1']);
  assertEquals(info.validators['validator-1'].role, 'validator');
  assertEquals(info.validators['validator-1'].endpoints.ledgerApi, 'http://localhost:5101');
  assertEquals(info.validators['validator-1'].endpoints.webUi, 'http://wallet.localhost:5180');
  assertEquals(info.validators['validator-1'].auth.realm, 'Validator1');
  assertEquals(info.validators['validator-1'].auth.clientId, 'validator-1-validator');

  // Validator 2
  assertExists(info.validators['validator-2']);

  // Auth
  assertEquals(info.auth.keycloak.url, 'http://localhost:5082');
  assertEquals(info.auth.keycloak.adminUsername, 'admin');
  assertEquals(info.auth.ledgerApi.mode, 'keycloak');
  assertEquals(info.auth.ledgerApi.algorithm, 'RS256');

  // Credentials
  assertEquals(info.credentials.length, 4);

  // Parties (empty — no live data)
  assertEquals(info.parties.length, 0);
});

Deno.test('buildConfigEnvironmentInfo - custom basePort', () => {
  const config = {
    validators: 1,
    basePort: 6000,
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const info = buildConfigEnvironmentInfo(config);

  assertEquals(info.validators.sv.endpoints.ledgerApi, 'http://localhost:6001');
  assertEquals(info.validators['validator-1'].endpoints.ledgerApi, 'http://localhost:6101');
  assertEquals(info.auth.keycloak.url, 'http://localhost:6082');
});

Deno.test('buildConfigEnvironmentInfo - detailed validators', () => {
  const config = {
    validators: [{ name: 'alice', parties: [{ hint: 'alice' }] }, { name: 'bob' }],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  };
  const info = buildConfigEnvironmentInfo(config);

  assertExists(info.validators.alice);
  assertEquals(info.validators.alice.auth.realm, 'Alice');
  assertEquals(info.validators.alice.auth.clientId, 'alice-validator');
  assertExists(info.validators.bob);
  assertEquals(info.validators.bob.auth.realm, 'Bob');
});

Deno.test('buildConfigEnvironmentInfo - SV participantId is null without live data', () => {
  const config = { validators: 1, auth: { keycloak: { admin: 'admin', password: 'admin' } } };
  const info = buildConfigEnvironmentInfo(config);

  assertEquals(info.validators.sv.participantId, null);
  assertEquals(info.validators['validator-1'].participantId, null);
});
