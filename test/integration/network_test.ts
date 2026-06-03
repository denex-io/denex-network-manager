import { assertEquals, assertExists } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  TEST_IMAGES,
} from './helpers.ts';
import { NetworkManager } from '../../src/docker/network.ts';

Deno.test({
  name: 'NetworkManager creates and removes network',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const networkManager = new NetworkManager(client);
    const instanceId = generateTestInstanceId();

    try {
      const networkId = await networkManager.create(instanceId);
      assertExists(networkId);

      const info = await networkManager.get(instanceId);
      assertExists(info);
      assertEquals(info.name, `localnet-${instanceId}`);
      assertEquals(info.driver, 'bridge');

      await networkManager.remove(instanceId);

      const afterRemove = await networkManager.get(instanceId);
      assertEquals(afterRemove, null);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'Containers are connected to shared network',
  ignore: !(await (await import('./helpers.ts')).isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const networkManager = new NetworkManager(client);
    const instanceId = generateTestInstanceId();
    const networkName = `localnet-${instanceId}`;

    try {
      await client.pullImage(TEST_IMAGES.alpine);
      await networkManager.create(instanceId);

      const server1Id = await client.createContainer({
        name: `${instanceId}-server1`,
        image: TEST_IMAGES.alpine,
        hostname: 'server1',
        command: ['sleep', '3600'],
        networks: [networkName],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      const server2Id = await client.createContainer({
        name: `${instanceId}-server2`,
        image: TEST_IMAGES.alpine,
        hostname: 'server2',
        command: ['sleep', '3600'],
        networks: [networkName],
        labels: {
          'localnet.instance': instanceId,
        },
      });

      await client.startContainer(server1Id);
      await client.startContainer(server2Id);

      const networkInfo = await networkManager.get(instanceId);
      assertExists(networkInfo);
      assertEquals(networkInfo.containers.length, 2);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'NetworkManager.getExpectedNetworkName returns correct format',
  fn() {
    const client = createTestDockerClient();
    const networkManager = new NetworkManager(client);

    const name = networkManager.getExpectedNetworkName('my-instance');
    assertEquals(name, 'localnet-my-instance');
  },
});
