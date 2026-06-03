import { assertEquals } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  TEST_CONFIG,
  TEST_IMAGES,
  waitFor,
} from './helpers.ts';
import { checkHealth } from '../../src/docker/health.ts';

Deno.test({
  name: 'PostgreSQL container starts and becomes healthy via TCP',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const containerName = `${instanceId}-postgres`;
    const hostPort = 15432;

    try {
      await client.pullImage(TEST_IMAGES.postgres);

      const containerId = await client.createContainer({
        name: containerName,
        image: TEST_IMAGES.postgres,
        environment: {
          POSTGRES_USER: 'testuser',
          POSTGRES_PASSWORD: 'testpass',
          POSTGRES_DB: 'testdb',
        },
        ports: [{ container: 5432, host: hostPort }],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      await client.startContainer(containerId);

      await waitFor(
        async () => {
          const result = await checkHealth(
            { type: 'tcp', target: `localhost:${hostPort}` },
            { timeout: TEST_CONFIG.healthCheckTimeout },
          );
          return result.healthy;
        },
        {
          timeout: TEST_CONFIG.containerStartTimeout,
          interval: TEST_CONFIG.healthCheckRetryDelay,
          message: 'PostgreSQL container did not become healthy in time',
        },
      );

      const info = await client.getContainerInfo(containerId);
      assertEquals(info?.state, 'running');
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'PostgreSQL container accepts connections after startup',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const containerName = `${instanceId}-postgres-conn`;
    const hostPort = 15433;

    try {
      await client.pullImage(TEST_IMAGES.postgres);

      const containerId = await client.createContainer({
        name: containerName,
        image: TEST_IMAGES.postgres,
        environment: {
          POSTGRES_USER: 'cnadmin',
          POSTGRES_PASSWORD: 'testpass',
          POSTGRES_DB: 'postgres',
        },
        ports: [{ container: 5432, host: hostPort }],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      await client.startContainer(containerId);

      await waitFor(
        async () => {
          const result = await checkHealth(
            { type: 'tcp', target: `localhost:${hostPort}` },
            { timeout: TEST_CONFIG.healthCheckTimeout },
          );
          return result.healthy;
        },
        {
          timeout: TEST_CONFIG.containerStartTimeout,
          interval: TEST_CONFIG.healthCheckRetryDelay,
        },
      );

      const tcpResult = await checkHealth(
        { type: 'tcp', target: `localhost:${hostPort}` },
        { timeout: 5000 },
      );
      assertEquals(tcpResult.healthy, true);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});
