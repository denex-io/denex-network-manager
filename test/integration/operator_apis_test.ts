import { assertEquals, assertExists } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import {
  getLedgerApiUserClientId,
  getRealmName,
  type LocalNetConfig,
} from '../../src/types/config.ts';
import { getSvInternalPorts } from '../../src/utils/ports.ts';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
  testConfig,
} from './helpers.ts';

// What a LocalNet keeps working on every tested release, checked in one start:
// - Operator APIs. Splice 0.10 (Canton 3.7) turns off the participant repair service, which Scan's
//   ACS-by-party endpoint reads through (ExportAcs), and key download, which the validator's
//   identities dump needs; both work on 0.9.4.
// - User ids at the edge of the rule (src/schemas/localnet-config.ts, userIdProblem): long, with
//   '@', and not valid as an email local part. A user that is created must also log in; before,
//   Keycloak could import a user whose password grant then failed ("Account is not fully set up").
const BASE_PORT = 24000;
const CONFIG_USER = `ops.${'a'.repeat(100)}@corp.example`; // 117 characters
const RUNTIME_USER = `.rt+${'b'.repeat(90)}@corp.example`; // 107 characters, leading '.'
// Downstream tools sign in as <id>@localnet.localhost; ids that fit an email keep that address.
const PLAIN_USER = 'ops-plain';
const CONFIG: LocalNetConfig = testConfig({
  basePort: BASE_PORT,
  validators: [{
    name: 'validator-1',
    users: [{ id: CONFIG_USER, primaryParty: 'opsparty' }, { id: PLAIN_USER }],
  }],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

/** A Keycloak password grant on validator-1's realm, as CantonClient does per user. */
async function login(user: string, password = user): Promise<string> {
  const realm = getRealmName('validator-1');
  const response = await fetch(
    `http://localhost:${BASE_PORT + 82}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: getLedgerApiUserClientId('validator-1'),
        username: user,
        password,
      }),
    },
  );
  const body = await response.text();
  return response.ok ? 'ok' : `HTTP ${response.status} ${body.slice(0, 200)}`;
}

Deno.test({
  name: 'Operator APIs and user ids: ACS by party, identities dumps, edge-case users log in',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(CONFIG, { instanceId });
    try {
      await localnet.start();

      // Every answer is collected before one assertion, so a run shows all that fail.
      const results: Record<string, string> = {};
      const scan = `http://localhost:${getSvInternalPorts(BASE_PORT).scanAdmin}/api/scan`;
      const { dso_party_id: dso } = await (await fetch(`${scan}/v0/dso-party-id`)).json();
      assertExists(dso);
      const acs = await fetch(`${scan}/v0/acs/${encodeURIComponent(dso)}`);
      const acsBody = await acs.text();
      results['scan acs'] = acs.ok ? 'ok' : `HTTP ${acs.status} ${acsBody.slice(0, 200)}`;

      for (const name of ['sv', 'validator-1']) {
        const validator = localnet.getValidatorClient(name);
        assertExists(validator, name);
        // The client's authenticated request; it throws on a non-2xx answer, with the body.
        const request = Reflect.get(validator, 'request') as (
          m: string,
          p: string,
        ) => Promise<unknown>;
        results[`${name} identities`] = await request
          .call(validator, 'GET', '/api/validator/v0/admin/participant/identities')
          .then(
            (body) => (body ? 'ok' : 'empty'),
            (e) => (e instanceof Error ? e.message : String(e)).slice(0, 200),
          );
      }

      results['config user login'] = await login(CONFIG_USER);
      results['runtime createUser'] = await localnet
        .createUser(RUNTIME_USER, 'validator-1', { primaryParty: 'rtparty' })
        .then(() => 'ok', (e) => (e instanceof Error ? e.message : String(e)).slice(0, 200));
      results['runtime user login'] = await login(RUNTIME_USER);
      results['plain user login by email'] = await login(
        `${PLAIN_USER}@localnet.localhost`,
        PLAIN_USER,
      );

      assertEquals(results, {
        'scan acs': 'ok',
        'sv identities': 'ok',
        'validator-1 identities': 'ok',
        'config user login': 'ok',
        'runtime createUser': 'ok',
        'runtime user login': 'ok',
        'plain user login by email': 'ok',
      });
    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});
