import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import {
  buildConfigEnvironmentInfo,
  type ConfigWarning,
  getSvPorts,
  getValidatorPorts,
  loadConfigFromString,
  LocalNetConfigSchema,
  normalizeValidators,
  parseLocalNetConfig,
  parseLocalNetConfigWithWarnings,
  parseStoredLocalNetConfig,
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
      { name: 'alice-val', parties: [{ hint: 'alice' }] },
      { name: 'bob-val', parties: [{ hint: 'bob' }] },
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
    assertEquals(config.validators[0].name, 'alice-val');
  }
});

Deno.test('validateLocalNetConfig - returns errors for invalid config', () => {
  const result = validateLocalNetConfig({
    validators: 0,
    auth: { keycloak: { admin: 123 } },
  });

  assertEquals(result.success, false);
});

Deno.test('validateLocalNetConfig - rejects validator name longer than 12 chars', () => {
  const result = validateLocalNetConfig({
    validators: [{ name: 'thirteenchars' }], // 13 chars
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  assertEquals(result.success, false);
});

Deno.test('validateLocalNetConfig - accepts validator name of exactly 12 chars', () => {
  const result = validateLocalNetConfig({
    validators: [{ name: 'twelvecharss' }], // 12 chars
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  assertEquals(result.success, true);
});

Deno.test('validateLocalNetConfig - rejects duplicate user ids within a validator', () => {
  const result = validateLocalNetConfig({
    validators: [{
      name: 'alice',
      users: [{ id: 'dup' }, { id: 'dup' }],
    }],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  assertEquals(result.success, false);
});

Deno.test('validateLocalNetConfig - allows config user id matching validator name', () => {
  const result = validateLocalNetConfig({
    validators: [{
      name: 'alice',
      users: [{ id: 'alice' }],
    }],
    auth: { keycloak: { admin: 'admin', password: 'admin' } },
  });

  assertEquals(result.success, true);
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
        name: 'test-val',
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
        name: 'test-val',
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
        name: 'test-val',
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
        name: 'test-val',
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
        name: 'test-val',
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

// --- unknown-key warnings, input-only rules, stored-label leniency ---

const AUTH = { keycloak: { admin: 'admin', password: 'admin' } };

function collectWarnings(input: unknown) {
  const warnings: ConfigWarning[] = [];
  const config = parseLocalNetConfig(input, { onWarning: (w) => warnings.push(w) });
  return { config, warnings };
}

Deno.test('parseLocalNetConfig - a misspelt key warns, is dropped and the default applies', () => {
  const { config, warnings } = collectWarnings({ validators: 2, auth: AUTH, basport: 7000 });
  assertEquals(config.basePort, 5000);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].source, 'config');
  assertEquals(warnings[0].path, 'basport');
  assertStringIncludes(warnings[0].message, "Unrecognized key 'basport' at root (ignored)");
});

Deno.test('parseLocalNetConfig - nested unknown keys warn once each with their path', () => {
  const { warnings } = collectWarnings({
    validators: [{ name: 'alice', partys: [], parties: [{ hint: 'a', dispalyName: 'x' }] }],
    auth: { keycloak: { admin: 'a', password: 'b', extra: 1 } },
    packages: [{ name: 'p', dar: 'p.dar', upload: [] }],
  });
  assertEquals(warnings.map((w) => w.path).sort(), [
    'auth.keycloak.extra',
    'packages[0].upload',
    'validators[0].parties[0].dispalyName',
    'validators[0].partys',
  ]);
});

Deno.test('parseLocalNetConfig - onWarning receives warnings and console.warn is not called', () => {
  const original = console.warn;
  let consoleCalls = 0;
  console.warn = () => consoleCalls++;
  try {
    const received: ConfigWarning[] = [];
    parseLocalNetConfig({ validators: 1, auth: AUTH, nope: true }, {
      onWarning: (w) => received.push(w),
    });
    assertEquals(received.length, 1);
    assertEquals(consoleCalls, 0);

    parseLocalNetConfig({ validators: 1, auth: AUTH, nope: true });
    assertEquals(consoleCalls, 1);
  } finally {
    console.warn = original;
  }
});

Deno.test('parseLocalNetConfig - prototype-ish keys warn', () => {
  const input = JSON.parse(
    '{"validators":1,"auth":{"keycloak":{"admin":"a","password":"b"}},' +
      '"toString":1,"constructor":2}',
  );
  const { warnings } = collectWarnings(input);
  assertEquals(warnings.map((w) => w.path).sort(), ['constructor', 'toString']);
});

Deno.test('parseLocalNetConfig - known optional keys do not warn', () => {
  const { warnings } = collectWarnings({
    version: '1.0',
    validators: [{
      name: 'alice',
      parties: [{ hint: 'a', displayName: 'A' }],
      users: [{
        id: 'u',
        primaryParty: 'a',
        rights: ['ParticipantAdmin'],
        parties: [{ hint: 'a' }],
      }],
    }],
    auth: { mode: 'oauth2', keycloak: { admin: 'a', password: 'b' } },
    packages: [{ name: 'p', dar: 'p.dar', uploadTo: ['alice'] }],
    discovery: { port: 8080, host: 'localhost' },
    basePort: 6000,
  });
  assertEquals(warnings, []);
});

Deno.test('validateLocalNetConfig - a typo plus an invalid value fails and still reports the typo', () => {
  const warnings: ConfigWarning[] = [];
  const result = validateLocalNetConfig({ validators: 0, auth: AUTH, basport: 1 }, {
    onWarning: (w) => warnings.push(w),
  });
  assertEquals(result.success, false);
  if (!result.success) assertEquals(result.errors.issues[0].path, ['validators']);
  assertEquals(warnings.map((w) => w.path), ['basport']);
});

Deno.test('parseLocalNetConfigWithWarnings - returns warnings without calling console.warn', () => {
  const original = console.warn;
  let calls = 0;
  console.warn = () => calls++;
  try {
    const { config, warnings } = parseLocalNetConfigWithWarnings({
      validators: 1,
      auth: AUTH,
      typo: 1,
    });
    assertEquals(config.basePort, 5000);
    assertEquals(warnings.length, 1);
    assertEquals(calls, 0);
  } finally {
    console.warn = original;
  }
});

Deno.test('parseStoredLocalNetConfig - strips unknown keys silently and skips input rules', () => {
  const original = console.warn;
  let calls = 0;
  console.warn = () => calls++;
  try {
    const config = parseStoredLocalNetConfig({
      validators: [
        { name: 'Alice', parties: [{ hint: 'a', validator: 'bob' }] },
        { name: 'alice', users: [{ id: 'u', validator: 'bob' }] },
      ],
      auth: AUTH,
      typo: 1,
    });
    assertEquals(calls, 0);
    assertEquals('typo' in config, false);
    assertEquals(normalizeValidators(config.validators).length, 2);
    // 11 validators (old cap was 10) and the highest port over the limit still parse.
    parseStoredLocalNetConfig({ validators: 55, auth: AUTH, basePort: 60000 });
  } finally {
    console.warn = original;
  }
});

Deno.test('parseLocalNetConfig - party and user validator keys warn and are dropped', () => {
  const { config, warnings } = collectWarnings({
    validators: [{
      name: 'alice',
      parties: [{ hint: 'a', validator: 'bob' }],
      users: [{ id: 'u', validator: 'bob' }],
    }],
    auth: AUTH,
  });
  assertEquals(warnings.map((w) => w.path).sort(), [
    'validators[0].parties[0].validator',
    'validators[0].users[0].validator',
  ]);
  for (const w of warnings) {
    assertStringIncludes(w.message, 'ignored');
    assertStringIncludes(w.message, "'alice'");
  }
  const v = normalizeValidators(config.validators)[0];
  assertEquals('validator' in v.parties![0], false);
  assertEquals('validator' in v.users![0], false);
});

Deno.test('parseLocalNetConfig - port limit: 54 validators at basePort 60000 pass, 55 fail', () => {
  parseLocalNetConfig({ validators: 54, auth: AUTH, basePort: 60000 });
  const result = validateLocalNetConfig({ validators: 55, auth: AUTH, basePort: 60000 });
  assert(!result.success);
  assertEquals(result.errors.issues[0].path, ['validators']);
  assertStringIncludes(result.errors.issues[0].message, '55 validators at basePort 60000');
  assertStringIncludes(result.errors.issues[0].message, 'at most 54');
});

Deno.test('parseLocalNetConfig - the 10-validator cap is gone', () => {
  const config = parseLocalNetConfig({ validators: 11, auth: AUTH });
  assertEquals(config.validators, 11);
});

Deno.test('parseLocalNetConfig - a 60-entry list at basePort 60000 is rejected', () => {
  const validators = Array.from({ length: 60 }, (_, i) => ({ name: `v${i}` }));
  const result = validateLocalNetConfig({ validators, auth: AUTH, basePort: 60000 });
  assert(!result.success);
  assertEquals(result.errors.issues[0].path, ['validators']);
});

Deno.test('parseLocalNetConfig - rejects duplicate, reserved and colliding validator names', () => {
  const rejected: [string, string[]][] = [
    ['a/a', ['a', 'a']],
    ['Alice/alice', ['Alice', 'alice']],
    ['aLice/alice', ['aLice', 'alice']],
    ['sv', ['sv']],
    ['SV', ['SV']],
    ['s-v', ['s-v']],
  ];
  for (const [label, names] of rejected) {
    const result = validateLocalNetConfig({
      validators: names.map((name) => ({ name })),
      auth: AUTH,
    });
    assert(!result.success, `${label} should be rejected`);
    const issue = result.errors.issues.find((i) =>
      i.path[0] === 'validators' && i.path[2] === 'name'
    );
    assert(issue, `${label}: issue anchored at validators[i].name`);
  }
  const ok = validateLocalNetConfig({
    validators: [{ name: 'app' }, { name: 'users-val' }],
    auth: AUTH,
  });
  assert(ok.success);
});

Deno.test('parseLocalNetConfig - lowercase names that share a Keycloak realm are rejected by the realm rule', () => {
  const cases: [string[], string][] = [
    [['ab', 'ab-'], "maps to Keycloak realm 'Ab'"],
    [['a-b', 'a--b'], "maps to Keycloak realm 'AB'"],
    [['a', 'a'], 'Duplicate validator name'],
    [['s-v'], "maps to Keycloak realm 'SV'"],
  ];
  for (const [names, message] of cases) {
    const result = validateLocalNetConfig({
      validators: names.map((name) => ({ name })),
      auth: AUTH,
    });
    assert(!result.success, `${names} should be rejected`);
    assertEquals(
      result.errors.issues.map((i) => i.message).filter((m) => m.includes(message)).length,
      1,
      `${names}: ${result.errors.message}`,
    );
    assert(
      !result.errors.issues.some((i) => i.message.includes('must be lowercase')),
      `${names} are lowercase`,
    );
  }
});

Deno.test('parseLocalNetConfig - rejects uppercase user ids on input, stored labels stay lenient', () => {
  const config = {
    validators: [{ name: 'v1', users: [{ id: 'alice' }, { id: 'Alice' }] }],
    auth: AUTH,
  };
  const result = validateLocalNetConfig(config);
  assert(!result.success);
  assertEquals(result.errors.issues.length, 1);
  assertEquals(result.errors.issues[0].path, ['validators', 0, 'users', 1, 'id']);
  assertEquals(
    result.errors.issues[0].message,
    "User id 'Alice' must be lowercase (Keycloak lowercases usernames); use 'alice'",
  );
  assert(
    validateLocalNetConfig({ ...config, validators: [{ name: 'v1', users: [{ id: 'alice' }] }] })
      .success,
  );
  const stored = parseStoredLocalNetConfig(config);
  assertEquals((stored.validators as { users: { id: string }[] }[])[0].users[1].id, 'Alice');
});

Deno.test('parseLocalNetConfig - rejects uppercase validator names (Keycloak lowercases usernames)', () => {
  const bad = validateLocalNetConfig({ validators: [{ name: 'App' }], auth: AUTH });
  assert(!bad.success);
  assertEquals(bad.errors.issues[0].path, ['validators', 0, 'name']);
  assert(bad.errors.issues[0].message.includes("use 'app'"));
  // Stored labels written by older SDKs stay readable.
  const stored = parseStoredLocalNetConfig({ validators: [{ name: 'App' }], auth: AUTH });
  assertEquals((stored.validators as { name: string }[])[0].name, 'App');
});

Deno.test('LocalNetConfigSchema - stays a strip-mode object that removes unknown keys', () => {
  const out = LocalNetConfigSchema.parse({ validators: 1, auth: AUTH, junk: 1 });
  assertEquals('junk' in out, false);
});

const PACKAGES_BASE = {
  validators: [{ name: 'validator-1' }],
  auth: { keycloak: { admin: 'a', password: 'b' } },
};

Deno.test('packages.uploadTo - an unknown target is rejected at its path', () => {
  const result = validateLocalNetConfig({
    ...PACKAGES_BASE,
    packages: [{ name: 'a', dar: 'a.dar' }, { name: 'b', dar: 'b.dar', uploadTo: ['sv', 'nope'] }],
  });
  assert(!result.success);
  const issue = result.errors.issues.find((i) => i.message.includes("'nope'"));
  assertExists(issue);
  assertEquals(issue.path, ['packages', 1, 'uploadTo', 1]);
});

Deno.test('packages.uploadTo - an empty list is rejected on input but parses when stored', () => {
  const input = {
    ...PACKAGES_BASE,
    packages: [{ name: 'a', dar: 'a.dar', uploadTo: [] }],
  };
  const result = validateLocalNetConfig(input);
  assert(!result.success);
  assertEquals(result.errors.issues[0].path, ['packages', 0, 'uploadTo']);
  assertEquals(parseStoredLocalNetConfig(input).packages?.[0].uploadTo, []);
});

Deno.test('packages.uploadTo - sv and configured validators are accepted; dar stays as written', () => {
  const config = parseLocalNetConfig({
    ...PACKAGES_BASE,
    packages: [{ name: 'a', dar: 'rel/a.dar', uploadTo: ['sv', 'validator-1'] }, {
      name: 'b',
      dar: './b.dar',
    }],
  });
  assertEquals(config.packages?.[0], {
    name: 'a',
    dar: 'rel/a.dar',
    uploadTo: ['sv', 'validator-1'],
  });
  assertEquals(config.packages?.[1], { name: 'b', dar: './b.dar' });
});

Deno.test('packages.uploadTo - validator names are checked for the numeric count form too', () => {
  const ok = validateLocalNetConfig({
    validators: 2,
    auth: PACKAGES_BASE.auth,
    packages: [{ name: 'a', dar: 'a.dar', uploadTo: ['validator-2'] }],
  });
  assert(ok.success);
  const bad = validateLocalNetConfig({
    validators: 2,
    auth: PACKAGES_BASE.auth,
    packages: [{ name: 'a', dar: 'a.dar', uploadTo: ['validator-3'] }],
  });
  assert(!bad.success);
});
