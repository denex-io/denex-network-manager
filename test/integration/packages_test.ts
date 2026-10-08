import { assert, assertEquals, assertRejects } from '@std/assert';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNet } from '../../src/localnet.ts';
import { DEFAULT_IMAGES } from '../../src/docker/containers.ts';
import { readDarMainPackageId } from '../../src/api/dar.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import type { LocalNetWarning } from '../../src/types/state.ts';
import { generateTestInstanceId, isDockerAvailable } from './helpers.ts';

const CONFIG: LocalNetConfig = {
  basePort: 22000,
  validators: [{ name: 'validator-1' }],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
};

/** Copies the DARs shipped in the splice image to a temp directory with `docker cp`. */
async function copyImageDars(instanceId: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dnm-dars-'));
  const result = await new Deno.Command('docker', {
    args: ['cp', `${instanceId}-splice:/app/splice-node/dars/.`, dir],
    stdout: 'null',
    stderr: 'piped',
  }).output();
  if (!result.success) {
    throw new Error(`docker cp failed: ${new TextDecoder().decode(result.stderr)}`);
  }
  return dir;
}

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
  await docker(['create', '--name', name, DEFAULT_IMAGES.splice]);
  try {
    await docker(['cp', `${name}:/app/splice-node/dars/.`, dir]);
  } finally {
    await docker(['rm', '-f', name]).catch(() => {});
  }
  return dir;
}

Deno.test({
  name: 'Packages: getPackages lists built-ins and uploadDar returns an id visible on the target',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(CONFIG, { instanceId });

    try {
      await localnet.start({ timeout: 300000 });

      const before = await localnet.getPackages('validator-1');
      assert(before.length > 0, 'validator-1 should know built-in packages');
      assert(before.every((p) => p.validators.length === 1 && p.validators[0] === 'validator-1'));
      const known = new Set((await localnet.getPackages()).map((p) => p.packageId));

      // Pick a shipped DAR whose main package the participants do not know yet.
      const dir = await copyImageDars(instanceId);
      const dars = (await readdir(dir)).filter((f) => f.endsWith('.dar'));
      let probe: { path: string; packageId: string } | undefined;
      for (const name of dars) {
        const path = join(dir, name);
        const packageId = readDarMainPackageId(new Uint8Array(await Deno.readFile(path)));
        if (!known.has(packageId)) {
          probe = { path, packageId };
          break;
        }
      }
      assert(probe, 'expected a shipped DAR that is not yet uploaded on any participant');

      const id = await localnet.uploadDar(probe.path, ['validator-1']);
      assertEquals(id, probe.packageId);
      assert(/^[0-9a-f]{64}$/.test(id));

      const rows = await localnet.getPackages();
      const row = rows.find((p) => p.packageId === id);
      assert(row, 'uploaded package should be listed');
      assert(row.validators.includes('validator-1'));
      assert(!row.validators.includes('sv'), 'package should be absent on sv');

      await assertRejects(
        () => localnet.uploadDar(probe.path, ['nope']),
        Error,
        'Unknown validator: nope',
      );
    } finally {
      await localnet.destroy({ removeVolumes: true });
    }
  },
});

Deno.test({
  name: 'Packages: packages: in the config upload to uploadTo only, once, with a relative dar',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const instanceId = generateTestInstanceId();
    const dir = await extractImageDarsBeforeStart(instanceId);
    const dars = (await readdir(dir)).filter((f) => f.endsWith('.dar'));
    assert(dars.length > 0, 'the splice image should ship DARs');

    // A relative `dar` resolves against configDir; every shipped DAR goes to validator-1 only.
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
      await localnet.start({ timeout: 300000 });
      const packageWarnings = () => warnings.filter((w) => w.source === 'packages');
      assertEquals(packageWarnings(), [], 'first start should upload without warnings');

      const ids = new Set<string>();
      for (const f of dars) {
        ids.add(readDarMainPackageId(new Uint8Array(await Deno.readFile(join(dir, f)))));
      }
      const rows = await localnet.getPackages();
      const onlyV1 = rows.filter((r) =>
        ids.has(r.packageId) && r.validators.includes('validator-1') &&
        !r.validators.includes('sv')
      );
      assert(onlyV1.length > 0, 'expected a package on validator-1 and absent on sv');

      // A second run re-uploads the same DARs; Canton treats that as a no-op.
      await localnet.initializeResources();
      assertEquals(packageWarnings(), []);
    } finally {
      await localnet.destroy({ removeVolumes: true });
    }
  },
});
