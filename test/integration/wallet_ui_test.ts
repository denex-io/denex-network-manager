import { assertEquals } from '@std/assert';
import type { Browser } from 'npm:playwright@1.57.0';
import { launchChrome } from './browser.ts';
import { isDockerAvailable } from './helpers.ts';
import { acquireSharedLocalNet, releaseSharedLocalNet } from './shared_localnet.ts';

const EVIDENCE_DIR = '.sisyphus/evidence';
const VALIDATOR_1_WALLET_URL = 'http://wallet.localhost:5180';
const PAGE_TIMEOUT_MS = 60_000;

const NOT_ONBOARDED_REGEX =
  /not.{0,10}onboarded|onboarding.{0,10}(required|pending|in progress)|not yet provisioned|wallet.{0,10}not.{0,10}(installed|available)/i;

// Every test runs on the shared network S2 (validator-1 and validator-2, base port 5000). The
// config entry Class 3 reads is wal-bob there: party wal-bob on validator-1 and user wal-bob with
// that primary party (shared_localnet.ts). Class 4 creates wal-alice at run time.

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
    const localnet = await acquireSharedLocalNet('S2');
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      browser = await launchChrome();
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
      await releaseSharedLocalNet(localnet);
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
    // Splice auto-onboards only `validator_1-wallet-admin` (see Class 1), which is
    // the login `getCredentials()` reports. The validator-named Keycloak user
    // `validator-1` is not onboarded, so we assert ONLY that OAuth round-trips;
    // the wallet UI may render an empty / "not onboarded" state, and that is
    // expected. It documents why the credentials must not list this login.
    const localnet = await acquireSharedLocalNet('S2');
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      browser = await launchChrome();
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
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'wallet UI Class 3 — YAML-config-defined user (bob) — T7 latent-bug fix proof',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('S2');
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      browser = await launchChrome();
      const page = await browser.newPage();
      await loginAndAssertWalletWorks(
        page,
        VALIDATOR_1_WALLET_URL,
        'wal-bob',
        'wal-bob',
        true,
        `${EVIDENCE_DIR}/task-11-class-3-yaml-bob.png`,
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'wallet UI Class 4 — Runtime-created user (alice) — T5 createUser feature proof',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('S2');
    // deno-lint-ignore no-explicit-any
    let browser: any;
    try {
      await localnet.createUser('wal-alice', 'validator-1', { primaryParty: 'wal-alice' });

      browser = await launchChrome();
      const page = await browser.newPage();
      await loginAndAssertWalletWorks(
        page,
        VALIDATOR_1_WALLET_URL,
        'wal-alice',
        'wal-alice',
        true,
        `${EVIDENCE_DIR}/task-11-class-4-runtime-alice.png`,
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'wallet UI Class 5 — every wallet login reported by getCredentials() works',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('S2');
    let browser: Browser | undefined;
    try {
      const walletLogins = (await localnet.getCredentials()).filter((c) =>
        c.purpose.endsWith(' wallet')
      );
      assertEquals(walletLogins.length, 3);
      assertEquals(walletLogins.map((c) => c.username), [
        'sv',
        'validator_1-wallet-admin',
        'validator_2-wallet-admin',
      ]);

      const launched = await launchChrome();
      browser = launched;
      for (const cred of walletLogins) {
        const page = await launched.newPage();
        try {
          await loginAndAssertWalletWorks(
            page,
            cred.url,
            cred.username,
            cred.password,
            true,
            `${EVIDENCE_DIR}/task-11-class-5-${cred.username}.png`,
          );
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await releaseSharedLocalNet(localnet);
    }
  },
});
