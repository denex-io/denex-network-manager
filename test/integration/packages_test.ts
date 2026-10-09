import { assert, assertEquals, assertRejects } from '@std/assert';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
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

Deno.test({
  name: 'Packages: getPackages lists built-ins and an uploaded DAR shows up on the target only',
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

      // Upload the shipped DARs to validator-1 only; at least one is new to every participant.
      const dir = await copyImageDars(instanceId);
      const dars = (await readdir(dir)).filter((f) => f.endsWith('.dar'));
      assert(dars.length > 0, 'expected shipped DARs in the splice image');
      for (const name of dars) {
        await localnet.uploadDar(join(dir, name), ['validator-1']);
      }

      const rows = await localnet.getPackages();
      const added = rows.filter((p) => !known.has(p.packageId));
      assert(added.length > 0, 'uploaded packages should be listed');
      for (const row of added) {
        assertEquals(row.validators, ['validator-1']);
      }

      await assertRejects(
        () => localnet.uploadDar(join(dir, dars[0]), ['nope']),
        Error,
        'Unknown validator: nope',
      );
    } finally {
      await localnet.destroy({ removeVolumes: true });
    }
  },
});
