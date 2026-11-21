import { assert, assertEquals } from '@std/assert';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import type { LocalNetWarning } from '../../src/types/state.ts';
import {
  generateTestInstanceId,
  isDockerAvailable,
  newestDar,
  SELECTED_SPLICE_IMAGES,
  testConfig,
} from './helpers.ts';

// Moved unchanged from packages_test.ts so that it runs as its own group: each of the two package
// tests starts a LocalNet of its own, and one group per start keeps a job to one start.

const CONFIG: LocalNetConfig = testConfig({
  basePort: 22000,
  validators: [{ name: 'validator-1' }],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

/**
 * Extracts the DARs shipped in the splice image through a throwaway container
 * (`<instanceId>-dar-probe`, created and removed here, never started), so the files
 * exist before the instance under test starts.
 */
async function extractImageDarsBeforeStart(instanceId: string): Promise<string> {
  const name = `${instanceId}-dar-probe`;
  const docker = async (args: string[]) => {
    const result = await new Deno.Command('docker', {
      args,
      stdout: 'null',
      stderr: 'piped',
    }).output();
    if (!result.success) {
      throw new Error(`docker ${args[0]} failed: ${new TextDecoder().decode(result.stderr)}`);
    }
  };
  const dir = await mkdtemp(join(tmpdir(), 'dnm-dars-'));
  await docker(['create', '--name', name, SELECTED_SPLICE_IMAGES.splice]);
  try {
    await docker(['cp', `${name}:/app/splice-node/dars/.`, dir]);
  } finally {
    await docker(['rm', '-f', name]).catch(() => {});
  }
  return dir;
}

Deno.test({
  name: 'Packages: packages: in the config upload to uploadTo only, once, with a relative dar',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const instanceId = generateTestInstanceId();
    const dir = await extractImageDarsBeforeStart(instanceId);
    // Uploading all ~180 shipped DARs takes over half an hour and many exceed Canton's request
    // timeout, so use the newest of two apps that a default LocalNet does not upload.
    const shipped = (await readdir(dir)).filter((f) => f.endsWith('.dar'));
    const dars = [
      newestDar(shipped, /^splitwell-\d[\d.]*\.dar$/),
      newestDar(shipped, /^splice-token-test-trading-app-.*\.dar$/),
    ]
      .filter((f): f is string => f !== undefined);
    assert(dars.length > 0, 'the splice image should ship splitwell or token-test DARs');

    // A relative `dar` resolves against configDir; the DARs go to validator-1 only.
    const config: LocalNetConfig = {
      ...CONFIG,
      packages: dars.map((f) => ({ name: f, dar: f, uploadTo: ['validator-1'] })),
    };
    const warnings: LocalNetWarning[] = [];
    const localnet = new LocalNet(config, {
      instanceId,
      configDir: dir,
      onWarning: (w) => warnings.push(w),
    });

    try {
      await localnet.start();
      const packageWarnings = () => warnings.filter((w) => w.source === 'packages');
      assertEquals(packageWarnings(), [], 'first start should upload without warnings');

      // Built-in packages live on every participant, so any package on validator-1 and absent on
      // sv might be a built-in one. Uploading the same DARs to sv must make some of them appear
      // there, which proves they came from the configured upload.
      const rows = await localnet.getPackages();
      const onlyV1 = rows.filter((r) =>
        r.validators.includes('validator-1') && !r.validators.includes('sv')
      );
      assert(onlyV1.length > 0, 'expected a package on validator-1 and absent on sv');
      for (const f of dars) await localnet.uploadDar(join(dir, f), ['sv']);
      const afterSv = new Map(
        (await localnet.getPackages()).map((r) => [r.packageId, r.validators]),
      );
      assert(
        onlyV1.some((r) => afterSv.get(r.packageId)?.includes('sv')),
        'the configured DARs should be what landed on validator-1',
      );

      // A second run re-uploads the same DARs; Canton treats that as a no-op.
      await localnet.initializeResources();
      assertEquals(packageWarnings(), []);
    } finally {
      await localnet.destroy({ removeVolumes: true });
    }
  },
});
