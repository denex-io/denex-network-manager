import { assertEquals, assertExists } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  TEST_IMAGES,
} from './helpers.ts';

Deno.test({
  name: 'DockerClient.ping - returns true when Docker is running',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  async fn() {
    const client = createTestDockerClient();
    const result = await client.ping();
    assertEquals(result, true);
  },
});

Deno.test({
  name: 'DockerClient.imageExists - returns false for nonexistent image',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  async fn() {
    const client = createTestDockerClient();
    const exists = await client.imageExists('nonexistent-image-that-does-not-exist:latest');
    assertEquals(exists, false);
  },
});

Deno.test({
  name: 'DockerClient.pullImage - pulls alpine image',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    await client.pullImage(TEST_IMAGES.alpine);
    const exists = await client.imageExists(TEST_IMAGES.alpine);
    assertEquals(exists, true);
  },
});

Deno.test({
  name: 'DockerClient.createContainer - creates container with labels',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      await client.pullImage(TEST_IMAGES.alpine);

      const containerId = await client.createContainer({
        name: `${instanceId}-test-container`,
        image: TEST_IMAGES.alpine,
        command: ['sleep', '3600'],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      assertExists(containerId);

      const info = await client.getContainerInfo(containerId);
      assertExists(info);
      assertEquals(info.name, `${instanceId}-test-container`);
      assertEquals(info.state, 'created');
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'DockerClient.startContainer - starts and stops container',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      await client.pullImage(TEST_IMAGES.alpine);

      const containerId = await client.createContainer({
        name: `${instanceId}-start-stop-test`,
        image: TEST_IMAGES.alpine,
        command: ['sleep', '3600'],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      await client.startContainer(containerId);

      let info = await client.getContainerInfo(containerId);
      assertEquals(info?.state, 'running');

      await client.stopContainer(containerId, 5);

      info = await client.getContainerInfo(containerId);
      assertEquals(info?.state, 'exited');
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'DockerClient.listContainers - filters by label',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      await client.pullImage(TEST_IMAGES.alpine);

      await client.createContainer({
        name: `${instanceId}-list-test-1`,
        image: TEST_IMAGES.alpine,
        command: ['sleep', '3600'],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      await client.createContainer({
        name: `${instanceId}-list-test-2`,
        image: TEST_IMAGES.alpine,
        command: ['sleep', '3600'],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      const containers = await client.listContainers({
        'localnet.instance': instanceId,
      });

      assertEquals(containers.length, 2);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'DockerClient.execInContainer - executes command and returns output',
  ignore: true,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      await client.pullImage(TEST_IMAGES.alpine);

      const containerId = await client.createContainer({
        name: `${instanceId}-exec-test`,
        image: TEST_IMAGES.alpine,
        command: ['sleep', '3600'],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      await client.startContainer(containerId);

      const result = await client.execInContainer(containerId, ['echo', 'hello world']);

      assertEquals(result.exitCode, 0);
      assertEquals(result.output.includes('hello world'), true);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});
