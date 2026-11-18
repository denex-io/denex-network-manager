/**
 * Integration test helpers for denex-network-manager.
 * Provides utilities for tests requiring Docker daemon access.
 */

import { DockerClient } from '../../src/docker/client.ts';
import { LABEL_INSTANCE, LABEL_PREFIX } from '../../src/api/discovery-utils.ts';
import {
  buildSpliceImages,
  type ContainerImages,
  DEFAULT_IMAGES,
  DEFAULT_SPLICE_VERSION,
} from '../../src/docker/containers.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { readTestSpliceVersion, withTestSpliceVersion } from './splice_version_selection.ts';

// Read once, when the first test module loads: a value the config schema refuses fails the run
// here, before any container exists.
const TEST_SPLICE_VERSION = readTestSpliceVersion(Deno.env.get('DNM_TEST_SPLICE_VERSION'));

/** The Splice release every integration LocalNet runs. */
export const SELECTED_SPLICE_VERSION = TEST_SPLICE_VERSION ?? DEFAULT_SPLICE_VERSION;

/** The Splice images of {@link SELECTED_SPLICE_VERSION}, for tests that use one directly. */
export const SELECTED_SPLICE_IMAGES: ContainerImages = {
  ...DEFAULT_IMAGES,
  ...buildSpliceImages(SELECTED_SPLICE_VERSION),
};
console.log(
  `[test-splice] DNM_TEST_SPLICE_VERSION=${TEST_SPLICE_VERSION ?? '(unset, bundled default)'}: ` +
    `canton ${SELECTED_SPLICE_IMAGES.canton}, splice ${SELECTED_SPLICE_IMAGES.splice}`,
);

/**
 * Every LocalNet config the integration suite defines goes through this, so it runs
 * {@link SELECTED_SPLICE_VERSION}. `test/unit/integration_config_guard_test.ts` checks that none
 * skips it.
 */
export function testConfig<T extends LocalNetConfig>(config: T): T {
  return withTestSpliceVersion(config, TEST_SPLICE_VERSION);
}

/** A Ledger JSON API that did not answer `GET /livez` with 2xx in time; `cause` is the last error. */
export class JsonApiNotReadyError extends Error {
  constructor(readonly url: string, readonly timeoutMs: number, options: ErrorOptions) {
    super(`${url} did not answer within ${timeoutMs / 1000}s`, options);
    this.name = 'JsonApiNotReadyError';
  }
}

/**
 * Waits until a participant's Ledger JSON API answers `GET /livez`. A start with
 * `skipInitialization` skips the readiness waits and can return before it does (`LocalNet.start`),
 * so a test that reads the ledger straight after one waits here first. Throws
 * {@link JsonApiNotReadyError} after `timeoutMs`, with the last error as its cause.
 */
export async function waitForLedgerJsonApi(jsonApiUrl: string, timeoutMs = 30_000): Promise<void> {
  const url = `${jsonApiUrl}/livez`;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      // Each request is bounded by the time left, so a hanging API cannot outlast the wait.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(0, deadline - Date.now())),
      });
      await response.body?.cancel();
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
  }
  throw new JsonApiNotReadyError(url, timeoutMs, { cause: lastError });
}

// Resources created by LocalNet or DockerClient with default options use the 'denex.localnet'
// prefix. Tests that label resources with 'localnet.instance' by hand, or use NetworkManager's
// default 'localnet' prefix, need the legacy prefix too. Clean up both.
const INSTANCE_LABEL_KEYS = [LABEL_INSTANCE, 'localnet.instance'];
const NETWORK_PREFIXES = [LABEL_PREFIX, 'localnet'];

const INTEGRATION_TEST_PREFIX = 'localnet-integration-test';

export async function isDockerAvailable(): Promise<boolean> {
  const client = new DockerClient();
  return await client.ping();
}

export function generateTestInstanceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${INTEGRATION_TEST_PREFIX}-${timestamp}-${random}`;
}

/**
 * Picks the newest file whose name matches `pattern` (version-aware ordering), or undefined.
 * Used to upload one or two shipped DARs instead of all ~180, which takes over half an hour.
 */
export function newestDar(files: string[], pattern: RegExp): string | undefined {
  return files.filter((f) => pattern.test(f)).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  ).at(-1);
}

export function createTestDockerClient(): DockerClient {
  return new DockerClient();
}

export async function cleanupTestResources(
  client: DockerClient,
  instanceId: string,
): Promise<void> {
  for (const labelKey of INSTANCE_LABEL_KEYS) {
    const containers = await client.listContainers({ [labelKey]: instanceId });
    for (const container of containers) {
      try {
        await client.stopContainer(container.id, 5);
      } catch {
        // Best-effort cleanup.
      }
      try {
        await client.removeContainer(container.id, true);
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  for (const prefix of NETWORK_PREFIXES) {
    try {
      await client.removeNetwork(`${prefix}-${instanceId}`);
    } catch {
      // Best-effort cleanup.
    }
  }

  for (const labelKey of INSTANCE_LABEL_KEYS) {
    const volumes = await client.listVolumes({ [labelKey]: instanceId });
    for (const volume of volumes) {
      try {
        await client.removeVolume(volume.name);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

export async function cleanupAllTestResources(client: DockerClient): Promise<void> {
  const containers = await client.listContainers();
  const testContainers = containers.filter((c) => c.name.includes(INTEGRATION_TEST_PREFIX));

  for (const container of testContainers) {
    try {
      await client.stopContainer(container.id, 5);
    } catch {
      // Best-effort cleanup.
    }
    try {
      await client.removeContainer(container.id, true);
    } catch {
      // Best-effort cleanup.
    }
  }
}

export async function skipIfDockerUnavailable(): Promise<void> {
  if (!(await isDockerAvailable())) {
    throw new Deno.errors.NotSupported(
      'Docker daemon is not available. Skipping integration test.',
    );
  }
}

export const TEST_CONFIG = {
  containerStartTimeout: 30000,
  healthCheckTimeout: 5000,
  healthCheckRetries: 10,
  healthCheckRetryDelay: 1000,
  containerStopTimeout: 10,
};

export async function waitFor(
  condition: () => Promise<boolean>,
  options?: {
    timeout?: number;
    interval?: number;
    message?: string;
  },
): Promise<void> {
  const timeout = options?.timeout ?? 30000;
  const interval = options?.interval ?? 1000;
  const message = options?.message ?? 'Condition not met within timeout';

  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(message);
}

export const TEST_IMAGES = {
  alpine: 'alpine:3.19',
  nginx: 'nginx:alpine',
  postgres: 'postgres:18-alpine',
};
