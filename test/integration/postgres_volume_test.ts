/**
 * The Postgres data volume must hold the data across a container recreate, for both mount
 * layouts. A wrong mount path either stops the postgres:18 entrypoint (a mount at
 * /var/lib/postgresql/data) or leaves the data in the image's anonymous volume, which a recreate
 * discards. `postgresDataMount()` picks the path; this checks the result against real images.
 */

import { assertEquals } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
  TEST_CONFIG,
  waitFor,
} from './helpers.ts';
import {
  buildPostgresContainer,
  type ContainerBuilderOptions,
} from '../../src/docker/containers.ts';
import { LABEL_INSTANCE } from '../../src/api/discovery-utils.ts';
import type { DockerClient } from '../../src/docker/client.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

const CONFIG: LocalNetConfig = {
  validators: 1,
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
};

async function startAndWait(
  client: DockerClient,
  spec: Parameters<DockerClient['createContainer']>[0],
) {
  const id = await client.createContainer(spec);
  await client.startContainer(id);
  // TCP readiness: during init the entrypoint's temporary server listens on the Unix socket only.
  await waitFor(
    async () => {
      const r = await client.execInContainer(id, [
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'cnadmin',
      ]);
      return r.exitCode === 0;
    },
    {
      timeout: TEST_CONFIG.containerStartTimeout * 2,
      interval: 1000,
      message: `${spec.image} did not become ready`,
    },
  );
  return id;
}

async function psql(client: DockerClient, id: string, sql: string): Promise<string> {
  const r = await client.execInContainer(id, [
    'psql',
    '-h',
    '127.0.0.1',
    '-U',
    'cnadmin',
    '-d',
    'postgres',
    '-At',
    '-c',
    sql,
  ]);
  assertEquals(r.exitCode, 0, r.output);
  return r.stdout.trim();
}

for (const image of ['postgres:18-alpine', 'postgres:16-alpine']) {
  Deno.test({
    name: `Postgres data survives a container recreate on the named volume (${image})`,
    ignore: !(await isDockerAvailable()),
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const client = createTestDockerClient();
      const instanceId = generateTestInstanceId();
      const options: ContainerBuilderOptions = {
        networkName: 'bridge',
        labelPrefix: 'denex.localnet',
        instanceId,
        images: { postgres: image },
        generatedConfigs: {
          cantonConfig: '',
          spliceConfig: '',
          nginxConfig: '',
          postgresInitScript: '#!/bin/sh\n',
          keycloakRealms: {},
        },
      };
      const built = buildPostgresContainer(CONFIG, options);
      const spec = {
        ...built,
        name: `${instanceId}-postgres`,
        labels: { ...built.labels, [LABEL_INSTANCE]: instanceId },
      };

      try {
        await client.pullImage(image);
        await client.createVolume(spec.volumes![0].source, { [LABEL_INSTANCE]: instanceId });

        const first = await startAndWait(client, spec);
        await psql(
          client,
          first,
          "CREATE TABLE marker (v text); INSERT INTO marker VALUES ('kept')",
        );
        const dataDir = await psql(client, first, 'SHOW data_directory');
        // The data directory is on the named volume, not in an anonymous one.
        assertEquals(dataDir.startsWith(spec.volumes![0].target), true, dataDir);

        await client.removeContainer(first, true);
        const second = await startAndWait(client, spec);
        assertEquals(await psql(client, second, 'SELECT v FROM marker'), 'kept');
      } finally {
        await cleanupTestResources(client, instanceId);
      }
    },
  });
}
