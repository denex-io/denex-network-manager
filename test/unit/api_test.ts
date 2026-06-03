import { assertEquals, assertExists } from '@std/assert';
import { createAuthHeader, TokenManager } from '../../src/api/auth.ts';
import type { AuthConfig, LocalNetConfig } from '../../src/types/config.ts';
import {
  CantonClient,
  createCanActAs,
  createCanExecuteAs,
  createCanExecuteAsAnyParty,
  createCanReadAs,
  createCanReadAsAnyParty,
  createIdentityProviderAdmin,
  createParticipantAdmin,
} from '../../src/api/canton.ts';
import { LocalNet } from '../../src/localnet.ts';

const oauth2Auth: AuthConfig = {
  keycloak: {
    admin: 'admin',
    password: 'admin',
  },
};

const testConfig: LocalNetConfig = {
  validators: 2,
  auth: oauth2Auth,
};

Deno.test('TokenManager - constructs with keycloak URL', () => {
  const manager = new TokenManager('http://localhost:5082');
  assertExists(manager);
});

Deno.test('TokenManager - cache can be cleared', () => {
  const manager = new TokenManager('http://localhost:5082');
  manager.clearCache();
});

Deno.test('createAuthHeader - creates bearer header', () => {
  const header = createAuthHeader('test-token');

  assertEquals(header, { Authorization: 'Bearer test-token' });
});

Deno.test('createCanActAs - creates correct right structure', () => {
  const right = createCanActAs('alice::participant1');

  assertEquals(right, { kind: { CanActAs: { value: { party: 'alice::participant1' } } } });
});

Deno.test('createCanReadAs - creates correct right structure', () => {
  const right = createCanReadAs('bob::participant2');

  assertEquals(right, { kind: { CanReadAs: { value: { party: 'bob::participant2' } } } });
});

Deno.test('createParticipantAdmin - creates correct right structure', () => {
  const right = createParticipantAdmin();

  assertEquals(right, { kind: { ParticipantAdmin: { value: {} } } });
});

Deno.test('createCanExecuteAs - creates correct right structure', () => {
  const right = createCanExecuteAs('charlie::participant3');

  assertEquals(right, { kind: { CanExecuteAs: { value: { party: 'charlie::participant3' } } } });
});

Deno.test('createCanReadAsAnyParty - creates correct right structure', () => {
  const right = createCanReadAsAnyParty();

  assertEquals(right, { kind: { CanReadAsAnyParty: { value: {} } } });
});

Deno.test('createCanExecuteAsAnyParty - creates correct right structure', () => {
  const right = createCanExecuteAsAnyParty();

  assertEquals(right, { kind: { CanExecuteAsAnyParty: { value: {} } } });
});

Deno.test('createIdentityProviderAdmin - creates correct right structure', () => {
  const right = createIdentityProviderAdmin();

  assertEquals(right, { kind: { IdentityProviderAdmin: { value: {} } } });
});

Deno.test('LocalNet - initializes API clients from config', () => {
  const localnet = new LocalNet(testConfig);

  assertExists(localnet);
  assertExists(localnet.getCantonClient('sv'));
  assertExists(localnet.getCantonClient('validator-1'));
  assertExists(localnet.getCantonClient('validator-2'));
});

Deno.test('LocalNet - returns undefined for unknown validators', () => {
  const localnet = new LocalNet(testConfig);

  assertEquals(localnet.getCantonClient('unknown'), undefined);
  assertEquals(localnet.getValidatorClient('unknown'), undefined);
});

Deno.test('CantonClient - listConnectedSynchronizers method exists', () => {
  const client = new CantonClient({ baseUrl: 'http://localhost:5075' });
  assertEquals(typeof client.listConnectedSynchronizers, 'function');
});

Deno.test('LocalNet - respects basePort in client initialization', () => {
  const configWithCustomBasePort: LocalNetConfig = {
    validators: 2,
    auth: oauth2Auth,
    basePort: 6000,
  };

  const localnet = new LocalNet(configWithCustomBasePort);

  // Get SV client and verify it uses port 6075 (6000 + 75)
  const svClient = localnet.getCantonClient('sv');
  assertExists(svClient);
  assertEquals(svClient.getBaseUrl(), 'http://localhost:6075');

  // Get validator-1 client and verify it uses port 6175 (6000 + 100 + 75)
  const validator1Client = localnet.getCantonClient('validator-1');
  assertExists(validator1Client);
  assertEquals(validator1Client.getBaseUrl(), 'http://localhost:6175');

  // Get validator-2 client and verify it uses port 6275 (6000 + 200 + 75)
  const validator2Client = localnet.getCantonClient('validator-2');
  assertExists(validator2Client);
  assertEquals(validator2Client.getBaseUrl(), 'http://localhost:6275');
});
