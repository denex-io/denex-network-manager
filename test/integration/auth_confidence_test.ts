import { assert, assertEquals, assertExists } from '@std/assert';
import { chromium } from 'npm:playwright@1.57.0';
import { createAuthHeader, TokenManager } from '../../src/api/auth.ts';
import { CantonClient } from '../../src/api/canton.ts';

import { ValidatorAdminClient } from '../../src/api/validator.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import {
  getKeycloakUrl,
  getLedgerApiUserClientId,
  getRealmName,
  getValidatorClientId,
} from '../../src/types/config.ts';
import { localnetFetch } from '../../src/utils/fetch.ts';
import {
  getKeycloakPort,
  getSvPorts,
  getValidatorPorts,
  SV_INTERNAL_PORTS,
} from '../../src/utils/ports.ts';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
} from './helpers.ts';

const AUTH_CONFIDENCE_CONFIG: LocalNetConfig = {
  basePort: 7000,
  validators: [
    {
      name: 'validator-1',
      users: [
        {
          id: 'admin-user',
          rights: ['ParticipantAdmin'],
        },
      ],
    },
  ],
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

async function assertUnauthorized(url: string): Promise<void> {
  const response = await fetch(url);
  assertEquals(response.ok, false);
  assert(
    [401, 403].includes(response.status),
    `Expected unauthorized status for ${url}, got ${response.status}`,
  );
}

async function assertOkWithToken(url: string, token: string): Promise<Response> {
  const response = await fetch(url, {
    headers: createAuthHeader(token),
  });
  if (!response.ok) {
    throw new Error(
      `Expected authorized response for ${url}, got ${response.status}: ${await response.text()}`,
    );
  }
  return response;
}

async function loginAndObserveApi(
  url: string,
  username: string,
  password: string,
  successSelectors: string[],
): Promise<void> {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const onKeycloakLogin = await page.locator('#username').isVisible().catch(() => false);
    if (!onKeycloakLogin) {
      const loginButton = page.getByRole('button', { name: /log\s*in|sign\s*in/i });
      if (await loginButton.count() > 0) {
        await loginButton.first().click();
      }
      await page.waitForSelector('#username', { timeout: 60000 });
    }

    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#kc-login');
    await page.waitForURL((currentUrl) => !currentUrl.toString().includes('/realms/'), {
      timeout: 60000,
    });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);

    const currentUrl = page.url();
    assertEquals(
      currentUrl.includes('/realms/'),
      false,
      `Expected login to return from Keycloak realm flow for ${url}`,
    );
    const matchedSelector = await Promise.any(
      successSelectors.map(async (selector) => {
        await page.waitForSelector(selector, { timeout: 60000 });
        return selector;
      }),
    ).catch(() => null);
    assert(
      matchedSelector !== null,
      `Expected one of ${successSelectors.join(', ')} after login for ${url}`,
    );

    await context.close();
  } finally {
    await browser.close();
  }
}

Deno.test({
  name:
    'Auth confidence: Keycloak tokens work across Canton, validator, scan, sv, and UI login flows',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dockerClient = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(AUTH_CONFIDENCE_CONFIG, { instanceId });

    const basePort = AUTH_CONFIDENCE_CONFIG.basePort ?? 5000;
    const keycloakUrl = getKeycloakUrl(AUTH_CONFIDENCE_CONFIG);
    const keycloakPort = getKeycloakPort(basePort);
    const svPorts = getSvPorts(basePort);
    const validatorPorts = getValidatorPorts(0, basePort);
    const validatorRealm = getRealmName('validator-1');
    const validatorClientId = getValidatorClientId('validator-1');
    const svClientId = getValidatorClientId('sv');
    const svUserClientId = getLedgerApiUserClientId('sv');
    const validatorUserClientId = getLedgerApiUserClientId('validator-1');

    try {
      await localnet.start({ timeout: 300000 });

      const validatorStates = await localnet.getAllValidatorStates();
      assertEquals(validatorStates.length, 2);
      for (const state of validatorStates) {
        assertEquals(state.isHealthy, true, `${state.name} should be healthy`);
        assertExists(state.participantId);
      }

      const realmUrls = [
        `${keycloakUrl}/realms/SV/.well-known/openid-configuration`,
        `${keycloakUrl}/realms/${validatorRealm}/.well-known/openid-configuration`,
      ];
      for (const url of realmUrls) {
        const response = await fetch(url);
        assertEquals(response.ok, true, `${url} should be reachable`);
      }

      const keycloakRoot = await fetch(`http://localhost:${keycloakPort}`);
      assertEquals(keycloakRoot.ok, true);

      const tokenManager = new TokenManager(keycloakUrl);
      const svServiceToken = await tokenManager.getToken('SV', svClientId, `${svClientId}-secret`);
      const validatorServiceToken = await tokenManager.getToken(
        validatorRealm,
        validatorClientId,
        `${validatorClientId}-secret`,
      );
      const svUserToken = await tokenManager.getPasswordToken({
        realm: 'SV',
        clientId: svUserClientId,
        username: 'sv',
        password: 'sv',
      });
      const validatorAdminUserToken = await tokenManager.getPasswordToken({
        realm: validatorRealm,
        clientId: validatorUserClientId,
        username: 'admin-user',
        password: 'admin-user',
      });

      assert(svServiceToken.length > 20);
      assert(validatorServiceToken.length > 20);
      assert(svUserToken.length > 20);
      assert(validatorAdminUserToken.length > 20);

      await assertUnauthorized(`http://localhost:${svPorts.jsonApi}/v2/users`);
      await assertUnauthorized(
        `http://localhost:${validatorPorts.validatorAdminApi}/api/validator/v0/wallet/user-status`,
      );

      const svCantonClient = new CantonClient({
        baseUrl: `http://localhost:${svPorts.jsonApi}`,
        keycloakUrl,
        realm: 'SV',
        clientId: svClientId,
        clientSecret: `${svClientId}-secret`,
        userClientId: svUserClientId,
      });
      const validatorCantonClient = new CantonClient({
        baseUrl: `http://localhost:${validatorPorts.jsonApi}`,
        keycloakUrl,
        realm: validatorRealm,
        clientId: validatorClientId,
        clientSecret: `${validatorClientId}-secret`,
        userClientId: validatorUserClientId,
      });
      const validatorAdminUserClient = CantonClient.forUser(
        `http://localhost:${validatorPorts.jsonApi}`,
        'admin-user',
        {
          keycloakUrl,
          realm: validatorRealm,
          userClientId: validatorUserClientId,
        },
      );

      const svSynchronizers = await svCantonClient.listConnectedSynchronizers();
      assertEquals(Array.isArray(svSynchronizers), true);
      assert(svSynchronizers.length > 0, 'SV should report connected synchronizers');

      const svUsers = await svCantonClient.listUsers();
      assertEquals(Array.isArray(svUsers), true);

      const validatorParticipantId = await validatorCantonClient.getParticipantId();
      assert(validatorParticipantId.length > 0);

      const validatorUsers = await validatorCantonClient.listUsers();
      assertEquals(Array.isArray(validatorUsers), true);
      const validatorPackages = await validatorCantonClient.listPackages();
      assertEquals(Array.isArray(validatorPackages), true);
      const validatorParties = await validatorCantonClient.listParties();
      assertEquals(Array.isArray(validatorParties), true);

      const adminUsers = await validatorAdminUserClient.listUsers();
      assert(adminUsers.some((user) => user.id === 'admin-user'));
      const adminUserRights = await validatorAdminUserClient.listApiUserRights('admin-user');
      assert(adminUserRights.some((right) => 'ParticipantAdmin' in right.kind));

      const directSvUsersResponse = await assertOkWithToken(
        `http://localhost:${svPorts.jsonApi}/v2/users`,
        svServiceToken,
      );
      const directSvUsersJson = await directSvUsersResponse.json();
      assertExists(directSvUsersJson.users);

      const directValidatorUsersResponse = await assertOkWithToken(
        `http://localhost:${validatorPorts.jsonApi}/v2/users`,
        validatorAdminUserToken,
      );
      const directValidatorUsersJson = await directValidatorUsersResponse.json();
      assertExists(directValidatorUsersJson.users);

      const validatorAdminClient = new ValidatorAdminClient({
        baseUrl: `http://localhost:${validatorPorts.validatorAdminApi}`,
        authConfig: AUTH_CONFIDENCE_CONFIG.auth,
        keycloakUrl,
        realm: validatorRealm,
        clientId: validatorClientId,
        clientSecret: `${validatorClientId}-secret`,
      });

      assertEquals(await validatorAdminClient.healthCheck(), true);
      const walletUserStatus = await validatorAdminClient.getWalletUserStatus();
      assertEquals(typeof walletUserStatus.user_onboarded, 'boolean');
      assertEquals(typeof walletUserStatus.user_wallet_installed, 'boolean');
      assertEquals(typeof walletUserStatus.has_featured_app_right, 'boolean');
      const validatorParty = await validatorAdminClient.getValidatorParty();
      assert(validatorParty.length > 0);
      const dsoPartyId = await validatorAdminClient.getDsoPartyId();
      assert(dsoPartyId.length > 0);

      const scanResponse = await assertOkWithToken(
        `http://localhost:${SV_INTERNAL_PORTS.scanAdmin}/api/scan/v0/splice-instance-names`,
        svUserToken,
      );
      const scanJson = await scanResponse.json();
      assertExists(scanJson);

      const svAuthorizationResponse = await assertOkWithToken(
        `http://localhost:${SV_INTERNAL_PORTS.svAdmin}/api/sv/v0/admin/authorization`,
        svServiceToken,
      );
      const svAuthorizationText = await svAuthorizationResponse.text();
      assertEquals(typeof svAuthorizationText, 'string');

      const uiUrls = [
        `http://sv.localhost:${svPorts.webUi}`,
        `http://scan.localhost:${svPorts.webUi}`,
        `http://wallet.localhost:${validatorPorts.webUi}`,
      ];
      for (const url of uiUrls) {
        const response = await localnetFetch(url, { redirect: 'manual' });
        assert(
          [200, 302, 303, 307, 308].includes(response.status),
          `Expected UI response for ${url}, got ${response.status}`,
        );
      }

      const scanUiResponse = await localnetFetch(`http://scan.localhost:${svPorts.webUi}`);
      assertEquals(scanUiResponse.ok, true);
      const scanUiHtml = await scanUiResponse.text();
      assert(scanUiHtml.length > 0, 'Expected public Scan UI HTML response');

      await loginAndObserveApi(
        `http://sv.localhost:${svPorts.webUi}`,
        'sv',
        'sv',
        ['#svUser'],
      );

      await loginAndObserveApi(
        `http://wallet.localhost:${validatorPorts.webUi}`,
        'validator-1',
        'validator-1',
        ['#logged-in-user', '[data-testid="wallet-onboarding-welcome-title"]'],
      );
    } finally {
      await localnet.destroy({ removeVolumes: true }).catch(() => undefined);
      await cleanupTestResources(dockerClient, instanceId);
    }
  },
});
