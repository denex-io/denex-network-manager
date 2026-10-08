import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { getCredentials } from '../../src/utils/credentials.ts';
import { keycloakAdminCredential } from '../../src/cli/commands/credentials.ts';
import {
  generateAllRealms,
  generateFullSpliceConfig,
  generateValidatorAuthEnv,
} from '../../src/generator/mod.ts';

const CONFIG: LocalNetConfig = {
  validators: [
    { name: 'validator-1' },
    {
      name: 'app',
      users: [
        { id: 'app_user', primaryParty: 'alice' },
        { id: 'no_party' },
        { id: 'app-wallet-admin' },
        { id: 'app-wallet-admin' },
      ],
    },
  ],
  auth: { keycloak: { admin: 'realadmin', password: 'realpassword123' } },
};

function walletLogin(name: string): string {
  const cred = getCredentials(CONFIG.validators).find((c) => c.purpose === `${name} wallet`);
  assert(cred, `no wallet credential for ${name}`);
  assertEquals(cred.password, cred.username);
  return cred.username;
}

Deno.test('wallet login is present in Keycloak realm, Splice wallet users and env', () => {
  const realms = generateAllRealms(CONFIG);
  const splice = generateFullSpliceConfig(CONFIG);
  for (const validator of CONFIG.validators as { name: string }[]) {
    const login = walletLogin(validator.name);
    assertEquals(login, `${validator.name.replace(/-/g, '_')}-wallet-admin`);

    const realm = realms.find((r) => (r.users ?? []).some((u) => u.username === login));
    assert(realm, `no Keycloak realm contains ${login}`);
    assertStringIncludes(splice, `validator-wallet-users = ["${login}"]`);
    assertStringIncludes(
      generateValidatorAuthEnv(validator, CONFIG),
      `_WALLET_ADMIN_USER_NAME=${login}\n`,
    );
  }
});

Deno.test('getCredentials - skips a user id repeating the wallet-admin login', () => {
  const creds = getCredentials(CONFIG.validators).filter((c) => c.realm === 'App');
  const ids = creds.map((c) => c.username);
  assertEquals(ids, ['app-wallet-admin', 'app_user', 'no_party']);
});

Deno.test('getCredentials - users without primaryParty are labelled not onboarded', () => {
  const creds = getCredentials(CONFIG.validators);
  const withParty = creds.find((c) => c.username === 'app_user');
  const without = creds.find((c) => c.username === 'no_party');
  assertEquals(withParty?.purpose, 'app_user (custom user)');
  assertStringIncludes(without?.purpose ?? '', 'not onboarded');
});

Deno.test('keycloakAdminCredential - reflects configured login and port', () => {
  const cred = keycloakAdminCredential({ ...CONFIG, basePort: 7000 });
  assertEquals(cred.realm, 'master');
  assertEquals(cred.username, 'realadmin');
  assertEquals(cred.password, 'realpassword123');
  assertEquals(cred.purpose, 'Keycloak admin console');
  assertStringIncludes(cred.url, 'http://localhost:');
});
