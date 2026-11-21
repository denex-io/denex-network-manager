import { assertEquals, assertExists } from '@std/assert';
import { DEFAULT_SPLICE_IMAGE_REPO } from '../../src/docker/containers.ts';
import { buildConfigEnvironmentInfo } from '../../src/utils/env-info.ts';
import { createTestDockerClient, SELECTED_SPLICE_VERSION } from './helpers.ts';
import {
  acquireSharedLocalNet,
  releaseSharedLocalNet,
  SHARED_NETWORKS,
} from './shared_localnet.ts';

// The suite wrapper runs this first, on its own: the rest of the run is evidence for one Splice
// release only if the LocalNets really run it. Not ignored without Docker: no proof is a failure.
// In group s1 it checks the shared network S1 (one validator), which the group's other files use.
const CONFIG = SHARED_NETWORKS.S1;

Deno.test({
  name: 'Splice version: canton and splice run the selected release',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    // A full start (the shared network's, or this test's own without the group runner): with
    // skipInitialization the start can return before the APIs answer.
    const localnet = await acquireSharedLocalNet('S1');
    const instanceId = localnet.instanceId;

    try {
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
      await releaseSharedLocalNet(localnet);
    }
  },
});
