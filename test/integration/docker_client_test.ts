import { assertEquals, assertExists } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  ensureImage,
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
      await ensureImage(client, TEST_IMAGES.alpine);

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
      await ensureImage(client, TEST_IMAGES.alpine);

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
      await ensureImage(client, TEST_IMAGES.alpine);

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

const dockerAvailable = await (await import('./helpers.ts')).isDockerAvailable();

async function startSleeper(
  client: ReturnType<typeof createTestDockerClient>,
  instanceId: string,
  command: string[] = ['sleep', '3600'],
  image: string = TEST_IMAGES.alpine,
): Promise<string> {
  await ensureImage(client, image);
  const containerId = await client.createContainer({
    name: `${instanceId}-exec-test`,
    image,
    command,
    labels: {
      'localnet.instance': instanceId,
    },
  });
  await client.startContainer(containerId);
  return containerId;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const parts: string[] = [];
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(decoder.decode(value, { stream: true }));
  }
  return parts.join('');
}

Deno.test({
  name: 'DockerClient.execInContainer - executes command and returns output',
  ignore: !dockerAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      const containerId = await startSleeper(client, instanceId);

      const result = await client.execInContainer(containerId, ['echo', 'hello world']);

      assertEquals(result.exitCode, 0);
      assertEquals(result.output, 'hello world\n');
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'DockerClient.execInContainer - separates stdout and stderr and reports the exit code',
  ignore: !dockerAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      const containerId = await startSleeper(client, instanceId);

      const result = await client.execInContainer(containerId, [
        'sh',
        '-c',
        'echo out; echo err >&2; exit 3',
      ]);

      assertEquals(result.exitCode, 3);
      assertEquals(result.stdout, 'out\n');
      assertEquals(result.stderr, 'err\n');
      assertEquals(result.output.length, 'out\nerr\n'.length);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'DockerClient.getContainerLogs - returns clean text for stdout and stderr',
  ignore: !dockerAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      const containerId = await startSleeper(client, instanceId, [
        'sh',
        '-c',
        'echo to-stdout; echo to-stderr >&2; sleep 3600',
      ]);
      await new Promise((r) => setTimeout(r, 1000));

      const text = await readAll(await client.getContainerLogs(containerId, { tail: 50 }));

      assertEquals(text.includes('to-stdout\n'), true);
      assertEquals(text.includes('to-stderr\n'), true);
      assertEquals([...text].some((ch) => ch.charCodeAt(0) < 9), false);
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'DockerClient.getContainerLogs - follow yields new output and cancel returns',
  ignore: !dockerAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();

    try {
      const containerId = await startSleeper(client, instanceId, [
        'sh',
        '-c',
        'while true; do echo tick; sleep 1; done',
      ]);

      const stream = await client.getContainerLogs(containerId, { tail: 1, follow: true });
      const reader = stream.getReader();
      const first = await reader.read();
      assertEquals(first.done, false);
      assertEquals(new TextDecoder().decode(first.value).includes('tick'), true);
      await reader.cancel();
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});

// A test helper that pulls an image the daemon already has depends on the registry on every call:
// a Docker Hub hiccup (HTTP 500 "failed to resolve reference … EOF") once failed four tests here.
// This image exists only on the local daemon, so a helper that pulls it anyway fails.
const LOCAL_ONLY_IMAGE = 'dnm-test.invalid/alpine:3.19';

async function docker(args: string[]): Promise<void> {
  const result = await new Deno.Command('docker', { args, stdout: 'null', stderr: 'piped' })
    .output();
  if (!result.success) {
    throw new Error(`docker ${args.join(' ')}: ${new TextDecoder().decode(result.stderr)}`);
  }
}

Deno.test({
  name: 'test helpers - an image the daemon already has is used without the registry',
  ignore: !dockerAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    await ensureImage(client, TEST_IMAGES.alpine);
    await docker(['tag', TEST_IMAGES.alpine, LOCAL_ONLY_IMAGE]);
    try {
      const containerId = await startSleeper(client, instanceId, ['sleep', '60'], LOCAL_ONLY_IMAGE);
      const result = await client.execInContainer(containerId, ['echo', 'local']);
      assertEquals(result.output, 'local\n');
    } finally {
      await cleanupTestResources(client, instanceId);
      await docker(['rmi', LOCAL_ONLY_IMAGE]);
    }
  },
});
