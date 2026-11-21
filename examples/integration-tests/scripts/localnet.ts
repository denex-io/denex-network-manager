/**
 * The CLI pattern: this script owns the LocalNet around the test run, driving the dnm CLI at the
 * version pinned in package.json. The npm scripts call it:
 *
 *   npm run localnet:up        start the LocalNet, or reuse a running one, and upload the DAR
 *   npm test                   run the tests against it, as often as you like
 *   npm run localnet:down      destroy it
 *   npm run test:integration   all three in one go; tears down only an instance it created.
 *                              This is what CI runs.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { followContainerLogs, printLogTails } from './container-logs.ts';
import {
  APP_VALIDATORS,
  CONFIG,
  DAR,
  DNM,
  dnm,
  dnmJson,
  INSTANCE,
  LOGS_DIR,
  output,
  ROOT,
  run,
} from './dnm.ts';

async function instanceExists(): Promise<boolean> {
  // Lists running, partly running and stopped instances, one id per line.
  const ids = await output(DNM, ['instances', '--ids-only']);
  return ids.split('\n').includes(INSTANCE);
}

/** Starts or reuses the instance and makes sure the DAR is on it. */
async function up(existed: boolean): Promise<void> {
  // `start` creates the instance, resumes a stopped one, repairs a partly running one, and leaves a
  // running one with the same config alone. `--timeout` is in milliseconds, and dnm 0.1.0-beta.3
  // checks it only between container layers, so image pulls and initialization can run past it:
  // in CI the job's own timeout is the real bound.
  await dnm('start', '--config', CONFIG, '--instance', INSTANCE, '--timeout', '900000');

  // On an instance that is already running, `start` skips initialization, so a rebuilt DAR would
  // not be uploaded. `init` uploads the `packages:` again.
  if (existed) await dnm('init', '--instance', INSTANCE);

  await assertDarUploaded();
}

/**
 * A workaround, not part of the recommended setup: dnm 0.1.0-beta.3 only warns when a `packages:`
 * upload fails, and `start` succeeds anyway. So check that the DAR's package reached every
 * participant that needs it.
 */
async function assertDarUploaded(): Promise<void> {
  const dar = JSON.parse(await output('dpm', ['inspect-dar', '--json', DAR]));
  const packageId: string = dar.main_package_id;
  const packages = await dnmJson<{ packageId: string; validators: string[] }[]>(
    'packages',
    '--instance',
    INSTANCE,
  );
  const on = packages.find((p) => p.packageId === packageId)?.validators ?? [];
  const missing = APP_VALIDATORS.filter((v) => !on.includes(v));
  if (missing.length > 0) {
    throw new Error(
      `The DAR's package ${packageId} is not on ${missing.join(', ')}; see the upload warning ` +
        `above. Canton rejects a changed DAR with an unchanged version: bump the version in ` +
        `daml/daml.yaml, or run \`npm run localnet:down\` and start clean.`,
    );
  }
}

async function down(): Promise<void> {
  if (!(await instanceExists())) {
    console.log(`No LocalNet '${INSTANCE}'.`);
    return;
  }
  await dnm('destroy', '--instance', INSTANCE, '--force');
}

/** up, the tests, then down if this run created the instance. Returns the exit code. */
async function test(): Promise<number> {
  const existed = await instanceExists();
  const logs = followContainerLogs();
  let passed = false;
  try {
    await up(existed);
    passed = (await run(join(ROOT, 'node_modules/.bin/vitest'), ['run'])) === 0;
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : error}`);
  } finally {
    await logs.stop();
  }

  if (passed) rmSync(LOGS_DIR, { recursive: true, force: true });
  else printLogTails();

  // Containers outlive this process, so teardown is explicit. Leave an instance that was already
  // there, such as the one a developer keeps up with `npm run localnet:up`.
  if (!existed) await down();
  else console.log(`Left LocalNet '${INSTANCE}' running: it existed before this run.`);

  return passed ? 0 : 1;
}

const command = process.argv[2];
if (command === 'up') await up(await instanceExists());
else if (command === 'down') await down();
else if (command === 'test') process.exitCode = await test();
else throw new Error('Usage: node scripts/localnet.ts up|down|test');
