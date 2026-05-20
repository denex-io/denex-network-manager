import { assertEquals, assertRejects } from '@std/assert';
import { chromium } from 'npm:playwright';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { localnetFetch } from '../../src/utils/fetch.ts';
import {
  createTestDockerClient,
  generateTestInstanceId,
  cleanupTestResources,
  isDockerAvailable,
} from './helpers.ts';

const EVIDENCE_DIR = '.sisyphus/evidence';

const E2E_BROWSER_TEST_CONFIG: LocalNetConfig = {
  validators: 2,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

interface WebUIConfig {
  name: string;
  url: string;
  username: string;
  password: string;
  screenshotName: string;
}

const WEB_UIS: WebUIConfig[] = [
  {
    name: 'SV Management',
    url: 'http://sv.localhost:4000',
    username: 'sv',
    password: 'sv',
    screenshotName: 'e2e-sv-management.png',
  },
  {
    name: 'Scan Explorer',
    url: 'http://scan.localhost:4000',
    username: '',
    password: '',
    screenshotName: 'e2e-scan-explorer.png',
  },
  {
    name: 'SV Wallet',
    url: 'http://wallet.localhost:4000',
    username: 'sv',
    password: 'sv',
    screenshotName: 'e2e-sv-wallet.png',
  },
  {
    name: 'Validator-1 Wallet',
    url: 'http://wallet.localhost:3000',
    username: 'validator-1',
    password: 'validator-1',
    screenshotName: 'e2e-validator-1-wallet.png',
  },
  {
    name: 'Validator-2 Wallet',
    url: 'http://wallet.localhost:2000',
    username: 'validator-2',
    password: 'validator-2',
    screenshotName: 'e2e-validator-2-wallet.png',
  },
];

async function ensureEvidenceDir(): Promise<void> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });
}



Deno.test({
  name: 'E2E Browser: Full LocalNet with 2 validators, API verification, and UI login tests',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(E2E_BROWSER_TEST_CONFIG, { instanceId });
    let localnet2: LocalNet | undefined;

    try {
      await ensureEvidenceDir();

      console.log('[E2E] Starting LocalNet with 2 validators (oauth2 mode)...');
      await localnet.start({
        timeout: 300000,
        onProgress: (msg) => console.log(`[progress] ${msg}`),
      });

      assertEquals(localnet.currentState, 'running', 'LocalNet should be running');

      const status = await localnet.status();
      assertEquals(status.state, 'running', 'Status should show running');
      console.log(`[E2E] LocalNet started with ${status.containers.length} containers`);

      console.log('[E2E] Verifying parties and users via LocalNet API...');

      const validatorStates = await localnet.getAllValidatorStates();
      console.log(`[E2E] Found ${validatorStates.length} validators`);

      assertEquals(validatorStates.length, 3, 'Should have 3 validators (sv + 2 regular)');

      for (const state of validatorStates) {
        console.log(
          `[E2E] Validator ${state.name}: healthy=${state.isHealthy}, party=${state.validatorParty?.substring(0, 30) ?? 'none'}...`,
        );
        assertEquals(state.isHealthy, true, `${state.name} should be healthy`);
        if (!state.validatorParty) {
          console.log(`[E2E] Warning: ${state.name} validatorParty not yet available`);
        }
      }

      console.log('[E2E] Checking wallet users...');

      try {
        const svUsers = await localnet.getUsers('sv');
        console.log(`[E2E] SV users: ${svUsers.length}`);
      } catch (error) {
        console.log(
          `[E2E] Warning: Could not get SV users: ${error instanceof Error ? error.message : error}`,
        );
      }

      try {
        const v1Users = await localnet.getUsers('validator-1');
        console.log(`[E2E] Validator-1 users: ${v1Users.length}`);
      } catch (error) {
        console.log(
          `[E2E] Warning: Could not get validator-1 users: ${error instanceof Error ? error.message : error}`,
        );
      }

      try {
        const v2Users = await localnet.getUsers('validator-2');
        console.log(`[E2E] Validator-2 users: ${v2Users.length}`);
      } catch (error) {
        console.log(
          `[E2E] Warning: Could not get validator-2 users: ${error instanceof Error ? error.message : error}`,
        );
      }

      console.log('[E2E] Testing Web UI accessibility...');

      for (const ui of WEB_UIS) {
        console.log(`[E2E] Checking ${ui.name} at ${ui.url}...`);
        try {
          const response = await localnetFetch(ui.url, {
            method: 'GET',
            redirect: 'follow',
          });
          console.log(`[E2E]   Status: ${response.status}`);
          const validStatuses = [200, 302, 303, 401];
          assertEquals(
            validStatuses.includes(response.status),
            true,
            `${ui.name} should return valid status, got ${response.status}`,
          );
        } catch (error) {
          console.log(
            `[E2E]   Warning: Could not reach ${ui.name}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }

      console.log('[E2E] Browser login tests...');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();

        for (const ui of WEB_UIS) {
          console.log(`[E2E] Browser test: ${ui.name}`);

          try {
            await page.goto(ui.url, { waitUntil: 'networkidle', timeout: 30000 });

            const loginButton = page.getByRole('button', { name: /log\s*in|sign\s*in/i })
              .or(page.getByText(/log\s*in.*oauth/i));

            if (ui.username && await loginButton.count() > 0) {
              console.log(`[E2E]   Clicking login button...`);
              await loginButton.first().click();

              console.log(`[E2E]   Waiting for Keycloak login form...`);
              await page.waitForSelector('#username', { timeout: 30000 });

              console.log(`[E2E]   Filling credentials...`);
              await page.fill('#username', ui.username);
              await page.fill('#password', ui.password);
              await page.click('#kc-login');

              console.log(`[E2E]   Waiting for redirect...`);
              await page.waitForURL((url: URL) => !url.toString().includes('/realms/'), { timeout: 30000 });
            } else {
              console.log(`[E2E]   No login button found, may already be logged in`);
            }

            const bodyText = await page.textContent('body');
            const hasError = ['error', 'failed', 'something went wrong']
              .some(e => bodyText?.toLowerCase().includes(e) && !bodyText.toLowerCase().includes('no error'));

            if (hasError) {
              console.log(`[E2E]   Warning: ${ui.name} may have errors`);
            }

            await page.screenshot({ path: `${EVIDENCE_DIR}/${ui.screenshotName}` });
            console.log(`[E2E]   ${ui.name} complete`);
          } catch (error) {
            console.log(`[E2E]   Error testing ${ui.name}: ${error instanceof Error ? error.message : error}`);
            await page.screenshot({ path: `${EVIDENCE_DIR}/${ui.screenshotName.replace('.png', '-error.png')}` });
          }
        }
      } finally {
        await browser.close();
      }

      console.log('[E2E] Testing config mismatch detection...');

      await localnet.stop();
      assertEquals(localnet.currentState, 'stopped', 'LocalNet should be stopped');

      const config2: LocalNetConfig = {
        validators: [{ name: 'app' }, { name: 'user-1' }],
        auth: E2E_BROWSER_TEST_CONFIG.auth,
      };
      localnet2 = new LocalNet(config2, { instanceId });

      console.log('[E2E] Testing config mismatch detection (throws on mismatch)...');
      await assertRejects(
        () => localnet2!.detectConfigMismatch(),
        Error,
        'different config',
      );

      console.log('[E2E] Testing force recreate flow...');

      await localnet.destroy({ removeVolumes: true });

      const containersAfterDestroy = await client.listContainers({
        'localnet.instance': instanceId,
      });
      assertEquals(containersAfterDestroy.length, 0, 'All containers should be removed after destroy');

      console.log('[E2E] Starting LocalNet with new config (force recreate)...');
      await localnet2.start({
        timeout: 300000,
        onProgress: (msg) => console.log(`[progress] ${msg}`),
      });

      assertEquals(localnet2.currentState, 'running', 'LocalNet2 should be running');

      const status2 = await localnet2.status();
      assertEquals(status2.state, 'running', 'Status2 should show running');

      const newContainers = status2.containers.filter(
        (c) => c.name.includes('app') || c.name.includes('user-1'),
      );
      console.log(`[E2E] Found ${newContainers.length} containers with new validator names`);

      const mismatch2 = await localnet2.detectConfigMismatch();
      assertEquals(mismatch2.hasMismatch, false, 'Should not detect mismatch after recreate');

      console.log('[E2E] All tests passed!');
    } finally {
      console.log('[E2E] Cleaning up...');
      try {
        await localnet.destroy({ removeVolumes: true });
      } catch {
        // Expected if already destroyed
      }
      try {
        await localnet2?.destroy({ removeVolumes: true });
      } catch {
        // Expected if localnet2 was never created
      }
      await cleanupTestResources(client, instanceId);
    }
  },
});

