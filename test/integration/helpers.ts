/**
 * Integration test helpers for denex-localnet.
 * Provides utilities for tests requiring Docker daemon access.
 */

import { DockerClient } from '../../src/docker/client.ts';

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

export function createTestDockerClient(): DockerClient {
  return new DockerClient();
}

export async function cleanupTestResources(
  client: DockerClient,
  instanceId: string,
): Promise<void> {
  const containers = await client.listContainers({
    'localnet.instance': instanceId,
  });

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

  const networkName = `localnet-${instanceId}`;
  try {
    await client.removeNetwork(networkName);
  } catch {
    // Best-effort cleanup.
  }

  const volumes = await client.listVolumes({
    'localnet.instance': instanceId,
  });

  for (const volume of volumes) {
    try {
      await client.removeVolume(volume.name);
    } catch {
      // Best-effort cleanup.
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
  postgres: 'postgres:16-alpine',
};
