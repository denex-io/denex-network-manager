/**
 * The browser for the integration tests: the system's Google Chrome, driven by Playwright
 * (channel `chrome`). GitHub's ubuntu-24.04 runner image ships Google Chrome, so CI installs no
 * browser; locally, install Google Chrome. Every test that opens a page launches it here.
 */

import { type Browser, chromium } from 'npm:playwright@1.57.0';

/** Google Chrome was not found, or did not start. */
export class ChromeUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super(
      'Google Chrome is required for the browser tests and was not found or did not start ' +
        "(Playwright channel 'chrome'). Install Google Chrome; the ubuntu-24.04 runner has it. " +
        `Cause: ${options.cause instanceof Error ? options.cause.message : options.cause}`,
      options,
    );
    this.name = 'ChromeUnavailableError';
  }
}

/** Launches headless Google Chrome. @throws ChromeUnavailableError if it cannot. */
export async function launchChrome(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (cause) {
    throw new ChromeUnavailableError({ cause });
  }
}
