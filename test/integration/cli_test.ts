import { assertEquals } from '@std/assert';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  isDockerAvailable,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

// These tests drive the real CLI entry point as a subprocess (like `dnm ...`),
// not the SDK directly. That distinction is the whole point: the stop/destroy
// timeout-unit bug (CLI passes seconds, SDK expects milliseconds → t=0.03 →
// Docker HTTP 500) lived entirely in the CLI→SDK seam. Every SDK-level test
// called stop()/destroy() with no timeout, so it used the ms-scale default and
// never reproduced the failure. Only exercising the CLI surface catches it.

const CLI_ENTRY = new URL('../../src/cli/mod.ts', import.meta.url).href;

const CLI_TEST_CONFIG: LocalNetConfig = {
  validators: 1,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<CliResult> {
  const command = new Deno.Command('deno', {
    args: ['run', '--allow-all', CLI_ENTRY, ...args],
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test({
  name: 'CLI: `stop` with default timeout stops containers (regression guard for t=0.03 HTTP 500)',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(CLI_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, skipInitialization: true, timeout: 60000 });

      // Invoke the CLI exactly as a user would, WITHOUT --timeout so it uses the
      // default (30 seconds). Before the fix this became t=30/1000=0.03, which
      // Docker rejects with `strconv.Atoi: parsing "0.03": invalid syntax`.
      const result = await runCli(['stop', '--instance', instanceId]);

      assertEquals(
        result.code,
        0,
        `dnm stop should exit 0; got ${result.code}. stderr: ${result.stderr}`,
      );

      const combined = result.stdout + result.stderr;
      assertEquals(
        combined.includes('strconv.Atoi'),
        false,
        `dnm stop must not trigger the timeout-unit HTTP 500. Output: ${combined}`,
      );

      // The containers must actually be stopped, not merely reported as stopped.
      const status = await localnet.status();
      for (const container of status.containers) {
        assertEquals(
          container.state === 'running',
          false,
          `Container ${container.name} should not be running after dnm stop`,
        );
      }
    } finally {
      await localnet.destroy();
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'CLI: `destroy` with default timeout removes all containers and volumes',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(CLI_TEST_CONFIG, { instanceId });

    try {
      await localnet.start({ skipHealthChecks: true, skipInitialization: true, timeout: 60000 });

      // `destroy` internally calls stop() first — the same path that produced
      // the t=0.03 HTTP 500 — so it exercises the fix end-to-end via the CLI.
      const result = await runCli(['destroy', '--instance', instanceId, '--force']);

      assertEquals(
        result.code,
        0,
        `dnm destroy should exit 0; got ${result.code}. stderr: ${result.stderr}`,
      );

      const combined = result.stdout + result.stderr;
      assertEquals(
        combined.includes('strconv.Atoi'),
        false,
        `dnm destroy must not trigger the timeout-unit HTTP 500. Output: ${combined}`,
      );

      const containersAfter = await client.listContainers({
        'localnet.instance': instanceId,
      });
      assertEquals(containersAfter.length, 0, 'All containers should be removed after dnm destroy');

      const volumesAfter = await client.listVolumes({
        'localnet.instance': instanceId,
      });
      assertEquals(volumesAfter.length, 0, 'All volumes should be removed after dnm destroy');
    } finally {
      await cleanupTestResources(client, instanceId);
    }
  },
});
