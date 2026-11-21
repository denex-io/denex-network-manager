import { assertEquals, assertExists } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { DEFAULT_SPLICE_IMAGE_REPO } from '../../src/docker/containers.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { buildConfigEnvironmentInfo } from '../../src/utils/env-info.ts';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  SELECTED_SPLICE_VERSION,
  testConfig,
} from './helpers.ts';

// The suite wrapper runs this first, on its own: the rest of the run is evidence for one Splice
// release only if the LocalNets really run it. Not ignored without Docker: no proof is a failure.
const CONFIG: LocalNetConfig = testConfig({
  validators: 1,
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

Deno.test({
  name: 'Splice version: canton and splice run the selected release',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(CONFIG, { instanceId });

    try {
      // A full start: with skipInitialization the start can return before the APIs answer.
      await localnet.start();

      for (const [container, image] of [['canton', 'canton'], ['splice', 'splice-app']]) {
        const info = await client.findContainer(`${instanceId}-${container}`);
        assertExists(info, `${instanceId}-${container} does not exist`);
        console.log(`[test-splice] ${instanceId}-${container}: ${info.image}`);
        assertEquals(
          info.image,
          `${DEFAULT_SPLICE_IMAGE_REPO}/${image}:${SELECTED_SPLICE_VERSION}`,
        );
      }

      // Evidence for the report, not compared against a number: the tag check above is the proof.
      const url = `${
        buildConfigEnvironmentInfo(CONFIG).validators.sv.endpoints.jsonApi
      }/v2/version`;
      const response = await fetch(url);
      const body = await response.text();
      console.log(`[test-splice] Canton GET /v2/version: HTTP ${response.status} ${body}`);
      assertEquals(response.ok, true, `GET ${url}: HTTP ${response.status} ${body}`);
      const version = JSON.parse(body).version;
      assertEquals(typeof version, 'string', `no version field in ${body}`);
    } finally {
      await localnet.destroy({ removeVolumes: true }).catch(() => {});
      await cleanupTestResources(client, instanceId);
    }
  },
});
