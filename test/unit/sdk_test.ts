import { assert, assertEquals, assertExists, assertThrows } from '@std/assert';
import { ZodError } from 'zod';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { normalizeValidators } from '../../src/mod.ts';
import { LocalNetBuilder } from '../../src/sdk/builder.ts';
import { LocalNet } from '../../src/localnet.ts';
import { getCredentials } from '../../src/utils/credentials.ts';
import { buildConfigEnvironmentInfo } from '../../src/utils/env-info.ts';

// --- LocalNetBuilder tests ---

Deno.test('LocalNetBuilder - withValidators(count) creates default-named validators', () => {
  const config = LocalNetBuilder.create().withValidators(2).build();
  const validators = normalizeValidators(config.validators);

  assertEquals(validators.length, 2);
  assertEquals(validators[0].name, 'validator-1');
  assertEquals(validators[1].name, 'validator-2');
  assertEquals(config.basePort, 5000);
});

Deno.test('LocalNetBuilder - withValidators(...names) creates named validators', () => {
  const config = LocalNetBuilder.create()
    .withValidators('alice', 'bob')
    .build();
  const validators = normalizeValidators(config.validators);

  assertEquals(validators.length, 2);
  assertEquals(validators[0].name, 'alice');
  assertEquals(validators[1].name, 'bob');
});

Deno.test('LocalNetBuilder - addValidator with parties', () => {
  const config = LocalNetBuilder.create()
    .addValidator('alice', { parties: ['alice'] })
    .build();
  const validators = normalizeValidators(config.validators);

  assertEquals(validators.length, 1);
  assertEquals(validators[0].name, 'alice');
  assertExists(validators[0].parties);
  assertEquals(validators[0].parties!.length, 1);
  assertEquals(validators[0].parties![0].hint, 'alice');
});

Deno.test('LocalNetBuilder - addValidator with users', () => {
  const config = LocalNetBuilder.create()
    .addValidator('alice', {
      users: [{ id: 'alice-user', primaryParty: 'alice' }],
    })
    .build();
  const validators = normalizeValidators(config.validators);

  assertEquals(validators.length, 1);
  assertExists(validators[0].users);
  assertEquals(validators[0].users!.length, 1);
  assertEquals(validators[0].users![0].id, 'alice-user');
  assertEquals(validators[0].users![0].primaryParty, 'alice');
});

Deno.test('LocalNetBuilder - withBasePort sets custom base port', () => {
  const config = LocalNetBuilder.create()
    .withBasePort(6000)
    .withValidators(1)
    .build();

  assertEquals(config.basePort, 6000);
});

Deno.test('LocalNetBuilder - withAuth sets custom credentials', () => {
  const config = LocalNetBuilder.create()
    .withAuth('myadmin', 'secret')
    .withValidators(1)
    .build();

  assertEquals(config.auth.keycloak.admin, 'myadmin');
  assertEquals(config.auth.keycloak.password, 'secret');
});

Deno.test('LocalNetBuilder - default build with no validators creates 2', () => {
  const config = LocalNetBuilder.create().build();
  const validators = normalizeValidators(config.validators);

  assertEquals(validators.length, 2);
  assertEquals(validators[0].name, 'validator-1');
  assertEquals(validators[1].name, 'validator-2');
  assertEquals(config.basePort, 5000);
  assertEquals(config.auth.keycloak.admin, 'admin');
  assertEquals(config.auth.keycloak.password, 'admin');
});

// --- LocalNet / createLocalNet tests ---

Deno.test('LocalNet.fromConfig - config object returns LocalNet', async () => {
  const config = LocalNetBuilder.create().withValidators(2).build();
  const net = await LocalNet.fromConfig(config);

  assert(net instanceof LocalNet);
});

Deno.test('getCredentials utility - returns 4 entries for 2 validators', () => {
  const config = LocalNetBuilder.create().withValidators(2).build();
  const creds = getCredentials(config.validators, config.basePort);

  assertEquals(creds.length, 4);

  // SV entries
  assertEquals(creds[0].realm, 'SV');
  assertEquals(creds[0].username, 'sv');
  assertEquals(creds[0].purpose, 'SV management UI');
  assertEquals(creds[1].realm, 'SV');
  assertEquals(creds[1].purpose, 'SV wallet');

  // Validator entries
  assertEquals(creds[2].username, 'validator-1');
  assertEquals(creds[2].purpose, 'validator-1 wallet');
  assertEquals(creds[3].username, 'validator-2');
  assertEquals(creds[3].purpose, 'validator-2 wallet');
});

Deno.test('buildConfigEnvironmentInfo - returns sv + validators', () => {
  const config = LocalNetBuilder.create().withValidators(2).build();
  const env = buildConfigEnvironmentInfo(config);

  assertExists(env.validators.sv);
  assertEquals(env.validators.sv.role, 'sv');
  assertExists(env.validators.sv.endpoints.ledgerApi);

  assertExists(env.validators['validator-1']);
  assertEquals(env.validators['validator-1'].role, 'validator');
  assertExists(env.validators['validator-2']);
  assertEquals(env.validators['validator-2'].role, 'validator');

  assertEquals(env.network.domainId, null);
  assertEquals(env.network.dsoPartyId, null);
  assertEquals(env.validators.sv.participantId, null);
});

Deno.test('buildConfigEnvironmentInfo - endpoints exist for all validators', () => {
  const config = LocalNetBuilder.create().withValidators(2).build();
  const env = buildConfigEnvironmentInfo(config);
  const endpoints: Record<string, typeof env.validators[string]['endpoints']> = {};
  for (const [name, info] of Object.entries(env.validators)) {
    endpoints[name] = info.endpoints;
  }
  const keys = Object.keys(endpoints);

  assert(keys.includes('sv'));
  assert(keys.includes('validator-1'));
  assert(keys.includes('validator-2'));
  assertEquals(keys.length, 3);

  assertExists(endpoints.sv.ledgerApi);
  assertExists(endpoints.sv.jsonApi);
  assertExists(endpoints.sv.adminApi);
  assertExists(endpoints.sv.validatorAdminApi);
  assertExists(endpoints.sv.webUi);
  assertExists(endpoints['validator-1'].ledgerApi);
  assertExists(endpoints['validator-2'].ledgerApi);
});

// --- SDK exports test ---

Deno.test('SDK mod.ts exports all expected value symbols', async () => {
  const sdk = await import('../../src/sdk/mod.ts');

  assertExists(sdk.LocalNet);
  assertExists(sdk.LocalNetBuilder);

  assertExists(sdk.buildConfigEnvironmentInfo);
  assertExists(sdk.getCredentials);
  assertExists(sdk.loadConfigFile);
  assertExists(sdk.loadConfigFromString);
  assertExists(sdk.createMinimalConfig);
});

// --- builder validation ---

Deno.test('LocalNetBuilder - withValidators(count) throws RangeError for a bad count', () => {
  for (const bad of [0, -1, 2.5, NaN]) {
    assertThrows(() => LocalNetBuilder.create().withValidators(bad), RangeError);
  }
});

Deno.test('LocalNetBuilder - withValidators(10) and (11) work', () => {
  assertEquals(
    normalizeValidators(LocalNetBuilder.create().withValidators(10).build().validators).length,
    10,
  );
  assertEquals(
    normalizeValidators(LocalNetBuilder.create().withValidators(11).build().validators).length,
    11,
  );
});

Deno.test('LocalNetBuilder - build() rejects a count whose ports exceed 65535', () => {
  const builder = LocalNetBuilder.create().withValidators(55).withBasePort(60000);
  assertThrows(() => builder.build(), ZodError);
  // Order of the two calls does not matter.
  assertThrows(
    () => LocalNetBuilder.create().withBasePort(60000).withValidators(55).build(),
    ZodError,
  );
});

Deno.test('LocalNetBuilder - build() rejects duplicate validator names', () => {
  assertThrows(() => LocalNetBuilder.create().withValidators('a', 'A').build(), ZodError);
  assertThrows(
    () => LocalNetBuilder.create().addValidator('x').addValidator('x').build(),
    ZodError,
  );
});

Deno.test('LocalNet.fromConfig - a misspelt key loads with one config warning', async () => {
  const seen: string[] = [];
  const config = { validators: 1, auth: { keycloak: { admin: 'a', password: 'b' } }, basport: 1 };
  const widened: Record<string, unknown> = config;
  const net = await LocalNet.fromConfig(widened as unknown as LocalNetConfig, {
    instanceId: 't-warn',
    onWarning: (w) => seen.push(w.message),
  });
  assertEquals(net.warnings.length, 1);
  assertEquals(net.warnings[0].source, 'config');
  assertEquals(net.warnings[0].path, 'basport');
  assertEquals(seen.length, 1);
  assertEquals(net.getConfig().basePort, 5000);
});
