import { LocalNet } from '../../src/mod.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { isDockerAvailable } from './helpers.ts';

const EVIDENCE_DIR = '.sisyphus/evidence';
const VALIDATOR_1_WALLET_URL = 'http://wallet.localhost:5180';
const PAGE_TIMEOUT_MS = 60_000;

const NOT_ONBOARDED_REGEX =
  /not.{0,10}onboarded|onboarding.{0,10}(required|pending|in progress)|not yet provisioned|wallet.{0,10}not.{0,10}(installed|available)/i;

const TEST_CONFIG: LocalNetConfig = {
  validators: [
    {
      name: 'validator-1',
      parties: [{ hint: 'bob' }],
      users: [{ id: 'bob', primaryParty: 'bob' }],
    },
    { name: 'validator-2' },
  ],
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

function uniqueInstanceId(): string {
  return `wallet-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// deno-lint-ignore no-explicit-any
async function loadPlaywrightOrThrow(): Promise<any> {
  try {
    const pw = await import('npm:playwright@1.57.0');
    return pw;
  } catch (err) {
    throw new Error(
      `chromium-not-installed: run \`npx playwright install chromium\` first. ` +
        `Original: ${err instanceof Error ? err.message : err}`,
    );
  }
}

async function loginAndAssertWalletWorks(
  // deno-lint-ignore no-explicit-any
  page: any,
  walletUrl: string,
  username: string,
  password: string,
  expectedToWork: boolean,
  screenshotPath: string,
): Promise<void> {
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  await page.goto(walletUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });

  const loginButton = page.getByRole('button', { name: /log\s*in|sign\s*in/i });
  if (await loginButton.count() > 0) {
    const onKeycloakLogin = await page.locator('#username').isVisible().catch(() => false);
    if (!onKeycloakLogin) {
      await loginButton.first().click();
    }
  }

  await page.waitForSelector('#username', { timeout: PAGE_TIMEOUT_MS });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#kc-login');

  await page.waitForURL(
    // deno-lint-ignore no-explicit-any
    (url: any) => !url.toString().includes('/realms/'),
    { timeout: PAGE_TIMEOUT_MS, waitUntil: 'commit' },
  );
  await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);

  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (expectedToWork) {
    await page
      .locator('text=/Balance|Send|Receive|Transactions|Wallet/i')
      .first()
      .waitFor({ timeout: 30_000 });

    const pageContent = await page.content();
    if (NOT_ONBOARDED_REGEX.test(pageContent)) {
      throw new Error(
        `Wallet shows 'not onboarded' state for ${username} — wallet onboarding failed. URL: ${page.url()}`,
      );
    }
  }
}

Deno.test({
  name:
    'wallet UI Class 1 — Splice-auto-onboarded user (validator_1-wallet-admin) regression-protect',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await LocalNet.fromConfig(TEST_CONFIG, { instanceId: uniqueInstanceId() });
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      await localnet.start({ timeout: 300_000 });
      const pw = await loadPlaywrightOrThrow();
      browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      // Auto-onboarded user format: `${participantName}-wallet-admin` where
      // `participantName = name.replace(/-/g, '_')`. So `validator-1` →
      // `validator_1-wallet-admin` (underscore, not hyphen). See
      // src/generator/splice.ts:283-287. Without this comment, copy-pasting
      // from other tests would silently produce a non-existent username.
      await loginAndAssertWalletWorks(
        page,
        VALIDATOR_1_WALLET_URL,
        'validator_1-wallet-admin',
        'validator_1-wallet-admin',
        true,
        `${EVIDENCE_DIR}/task-11-class-1-auto-onboarded.png`,
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await localnet.destroy({ removeVolumes: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name:
    'wallet UI Class 2 — Operator user (validator-1) OAuth-only check (documented expected state)',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Class 2 is documented as out-of-scope for the runtime-create-user
    // boulder: Splice auto-onboards `validator_1-wallet-admin` (the service
    // account, see Class 1) — NOT the operator-named Keycloak user
    // `validator-1`. We assert ONLY that OAuth round-trips; the wallet UI
    // may render an empty / "not onboarded" state and that is currently
    // expected. Do NOT "fix" this test by removing the operator user
    // without also planning the wallet-onboarding work.
    const localnet = await LocalNet.fromConfig(TEST_CONFIG, { instanceId: uniqueInstanceId() });
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      await localnet.start({ timeout: 300_000 });
      const pw = await loadPlaywrightOrThrow();
      browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await loginAndAssertWalletWorks(
        page,
        VALIDATOR_1_WALLET_URL,
        'validator-1',
        'validator-1',
        false,
        `${EVIDENCE_DIR}/task-11-class-2-operator.png`,
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await localnet.destroy({ removeVolumes: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: 'wallet UI Class 3 — YAML-config-defined user (bob) — T7 latent-bug fix proof',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await LocalNet.fromConfig(TEST_CONFIG, { instanceId: uniqueInstanceId() });
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      await localnet.start({ timeout: 300_000 });
      const pw = await loadPlaywrightOrThrow();
      browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await loginAndAssertWalletWorks(
        page,
        VALIDATOR_1_WALLET_URL,
        'bob',
        'bob',
        true,
        `${EVIDENCE_DIR}/task-11-class-3-yaml-bob.png`,
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await localnet.destroy({ removeVolumes: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: 'wallet UI Class 4 — Runtime-created user (alice) — T5 createUser feature proof',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await LocalNet.fromConfig(TEST_CONFIG, { instanceId: uniqueInstanceId() });
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      await localnet.start({ timeout: 300_000 });
      await localnet.createUser('alice', 'validator-1', { primaryParty: 'alice' });

      const pw = await loadPlaywrightOrThrow();
      browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await loginAndAssertWalletWorks(
        page,
        VALIDATOR_1_WALLET_URL,
        'alice',
        'alice',
        true,
        `${EVIDENCE_DIR}/task-11-class-4-runtime-alice.png`,
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await localnet.destroy({ removeVolumes: true }).catch(() => undefined);
    }
  },
});
