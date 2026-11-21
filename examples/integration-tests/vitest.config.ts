import process from 'node:process';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The CLI pattern by default: scripts/localnet.ts owns the LocalNet and the setup only reads
    // its environment. LOCALNET_LIFECYCLE=sdk (`npm run test:integration:sdk`) hands the
    // lifecycle to the setup instead, through the SDK.
    globalSetup: process.env.LOCALNET_LIFECYCLE === 'sdk'
      ? 'test/global-setup.sdk.ts'
      : 'test/global-setup.cli.ts',
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
