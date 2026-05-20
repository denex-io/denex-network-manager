import { assert, assertEquals, assertExists } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { getKeycloakUrl, type LocalNetConfig } from '../../src/types/config.ts';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
} from './helpers.ts';

const MASTER_REALM_TEST_CONFIG: LocalNetConfig = {
  basePort: 8000,
  validators: 1,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

Deno.test({
  name: 'Keycloak: master realm has SSL disabled and admin REST API works over plain HTTP',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(MASTER_REALM_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipInitialization: true, timeout: 180000 });

      const keycloakUrl = getKeycloakUrl(MASTER_REALM_TEST_CONFIG);

      // Assertion 1: OIDC discovery works over plain HTTP
      const r1 = await fetch(`${keycloakUrl}/realms/master/.well-known/openid-configuration`);
      assertEquals(r1.status, 200);
      const j1 = await r1.json();
      assertExists(j1.issuer);
      assertExists(j1.jwks_uri);

      // Assertion 2: Admin password grant works over plain HTTP
      const r2 = await fetch(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: MASTER_REALM_TEST_CONFIG.auth.keycloak.admin,
          password: MASTER_REALM_TEST_CONFIG.auth.keycloak.password,
        }),
      });
      assertEquals(r2.status, 200);
      const tokenJson = await r2.json();
      const accessToken = tokenJson.access_token;
      assertExists(accessToken);

      // Assertion 3: Admin REST API works AND sslRequired is NONE
      const r3 = await fetch(`${keycloakUrl}/admin/realms/master`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      assertEquals(r3.status, 200);
      const j3 = await r3.json();
      assertEquals(
        String(j3.sslRequired).toLowerCase(),
        'none',
        `Expected sslRequired to indicate SSL is disabled, got ${j3.sslRequired}`,
      );
      assertEquals(j3.realm, 'master');

      // Assertion 4: All other realms still present
      const r4 = await fetch(`${keycloakUrl}/admin/realms`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      assertEquals(r4.status, 200);
      const j4 = await r4.json() as Array<{ realm: string }>;
      const names = j4.map((r) => r.realm);
      assert(names.includes('master'), `Expected 'master' in ${JSON.stringify(names)}`);
      assert(names.includes('SV'), `Expected 'SV' in ${JSON.stringify(names)}`);
      assert(names.includes('Validator1'), `Expected 'Validator1' in ${JSON.stringify(names)}`);

      // Assertion 5: Bootstrap user has been deleted post-startup
      const r5 = await fetch(
        `${keycloakUrl}/admin/realms/master/users?username=localnet-internal-bootstrap-do-not-use&exact=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      assertEquals(r5.status, 200);
      const j5 = await r5.json() as unknown[];
      assertEquals(j5.length, 0);
    } finally {
      await localnet.destroy({ removeVolumes: true }).catch(() => {});
      await cleanupTestResources(client, instanceId);
    }
  },
});
