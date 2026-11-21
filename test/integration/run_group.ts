/**
 * Runs one integration group (groups.ts):
 *
 *   deno run --allow-all test/integration/run_group.ts <group> [--expect-splice=<release>]
 *     [deno test flags]
 *
 * With `--expect-splice`, before anything starts, the Splice images that the group's LocalNets
 * would run (its shared networks', and what testConfig() gives every other test) are checked
 * against that release, and a difference fails the group by name. It takes no LocalNet: the
 * workflow passes its matrix entry, so a job the release did not reach cannot pass for it.
 *
 * The group's shared networks are started once, one after the other, before any test, and their
 * instance ids reach the test files in the environment (shared_localnet.ts). Then `deno test`
 * runs the group's files, with the given flags. The shared networks are destroyed in `finally`,
 * whatever happened. If a shared start fails, that is the one failure reported: the files do not
 * run, and with `--junit-path` the report holds that failure as one named test case.
 */

import { buildSpliceImages } from '../../src/docker/containers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { resolveSpliceVersion } from '../../src/utils/splice-version.ts';
import { GROUPS } from './groups.ts';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  testConfig,
} from './helpers.ts';
import {
  SHARED_NETWORKS,
  SHARED_START_OPTIONS,
  sharedNetworkEnv,
  type SharedNetworkName,
} from './shared_localnet.ts';

const [groupName, ...args] = Deno.args;
const expectFlag = args.find((arg) => arg.startsWith('--expect-splice='));
const expectedSplice = expectFlag?.slice('--expect-splice='.length);
const testFlags = args.filter((arg) => arg !== expectFlag);
const group = groupName === undefined ? undefined : GROUPS[groupName];
if (group === undefined) {
  console.error(
    `usage: run_group.ts <${Object.keys(GROUPS).join('|')}> [deno test flags]` +
      (groupName === undefined ? '' : ` (no group '${groupName}')`),
  );
  Deno.exit(2);
}

// A group's tests must run one at a time. "runtime createUser: idempotency" and "Initialization:
// initializeResources is idempotent" compare exact counts of whole listings on a shared network
// before and after one call; they hold only because no other test of the group runs in between.
// `--parallel` would run the group's files concurrently against the same networks.
const parallel = testFlags.find((flag) => /^--(parallel|jobs)\b/.test(flag));
if (parallel !== undefined) {
  console.error(`run_group.ts: '${parallel}' is refused; a group's tests run one at a time`);
  Deno.exit(2);
}

const { networks = [], files } = group;
const client = createTestDockerClient();
const env: Record<string, string> = {};
const started: Array<{ name: SharedNetworkName; net: LocalNet }> = [];
let child: Deno.ChildProcess | undefined;
let startFailed = false;
let code = 1;

// Ctrl-C reaches the test process as well; outlive it so the networks are destroyed. A SIGTERM
// is passed on to the test process, with the same effect.
Deno.addSignalListener('SIGINT', () => {});
Deno.addSignalListener('SIGTERM', () => child?.kill('SIGTERM'));

/** The `--junit-path` the caller gave, in either form, or undefined. */
function junitPath(flags: string[]): string | undefined {
  for (const [i, flag] of flags.entries()) {
    if (flag.startsWith('--junit-path=')) return flag.slice('--junit-path='.length);
    if (flag === '--junit-path') return flags[i + 1];
  }
  return undefined;
}

const xmlEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A JUnit report with one failed test case, `testCase`, failing with `reason`. */
async function writeFailureReport(path: string, testCase: string, reason: string) {
  await Deno.writeTextFile(
    path,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<testsuites name="deno test" tests="1" failures="1" errors="0">\n` +
      `  <testsuite name="./test/integration/run_group.ts" tests="1" failures="1" errors="0">\n` +
      `    <testcase name="${xmlEscape(testCase)}" classname="run_group.ts">\n` +
      `      <failure message="${xmlEscape(reason)}">${xmlEscape(reason)}</failure>\n` +
      `    </testcase>\n  </testsuite>\n</testsuites>\n`,
  );
}

const log = (message: string) =>
  console.log(`[group ${groupName}] ${new Date().toISOString()} ${message}`);

/**
 * The canton and splice images that do not run `expected` among those a LocalNet with `config`
 * would run. Building the handle contacts nothing.
 */
function imagesNotAt(expected: string, what: string, config: LocalNetConfig): string[] {
  const net = new LocalNet(config, { instanceId: 'splice-version-check' });
  const images = {
    ...buildSpliceImages(resolveSpliceVersion(net.getConfig())),
    ...net.getOptions().images,
  };
  return (['canton', 'splice'] as const)
    .filter((key) => images[key]?.split(':').at(-1) !== expected)
    .map((key) => `${what} would run ${key} ${images[key]}`);
}

if (expectedSplice !== undefined) {
  const subjects: Array<[string, LocalNetConfig]> = [
    ...networks.map((name): [string, LocalNetConfig] => [
      `shared LocalNet ${name}`,
      SHARED_NETWORKS[name],
    ]),
    [
      "a test's own LocalNet (testConfig())",
      testConfig({ validators: 1, auth: { keycloak: { admin: 'admin', password: 'admin' } } }),
    ],
  ];
  const wrong = subjects.flatMap(([what, config]) => imagesNotAt(expectedSplice, what, config));
  if (wrong.length > 0) {
    const reason = `expected Splice ${expectedSplice}: ${wrong.join('; ')}`;
    console.error(
      `::error title=Splice version of group ${groupName}::group '${groupName}' did not run: ${reason}`,
    );
    const report = junitPath(testFlags);
    if (report !== undefined) {
      await writeFailureReport(report, `group ${groupName} runs Splice ${expectedSplice}`, reason);
    }
    Deno.exit(1);
  }
  log(`Splice ${expectedSplice}: canton and splice images of every LocalNet of the group match`);
}

try {
  for (const name of networks) {
    const instanceId = generateTestInstanceId();
    log(`create shared LocalNet ${name} ${instanceId}`);
    const net = new LocalNet(SHARED_NETWORKS[name], { instanceId });
    started.push({ name, net });
    try {
      await net.start({ ...SHARED_START_OPTIONS[name], onProgress: (m) => log(`${name}: ${m}`) });
    } catch (error) {
      startFailed = true;
      const reason = error instanceof Error ? error.message : String(error);
      // `::error::` makes it the run's headline on GitHub Actions; elsewhere it is one line.
      console.error(
        `::error title=shared LocalNet ${name}::shared LocalNet ${name} (${instanceId}) ` +
          `failed to start, so group '${groupName}' did not run: ${reason}`,
      );
      const report = junitPath(testFlags);
      if (report !== undefined) {
        await writeFailureReport(
          report,
          `shared LocalNet ${name} starts (group ${groupName})`,
          reason,
        );
      }
      throw error;
    }
    log(`ready shared LocalNet ${name} ${instanceId}`);
    env[sharedNetworkEnv(name)] = instanceId;
  }

  child = new Deno.Command(Deno.execPath(), {
    args: [
      'test',
      '--allow-all',
      ...testFlags,
      ...files.map((f) => new URL(f, import.meta.url).pathname),
    ],
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
  code = (await child.status).code;
} catch (error) {
  if (!startFailed) console.error(error);
  code = 1;
} finally {
  for (const { name, net } of started.reverse()) {
    log(`destroy shared LocalNet ${name} ${net.instanceId}`);
    await net.destroy({ removeVolumes: true }).catch((error) =>
      console.error(`destroying shared LocalNet ${name} failed: ${error}`)
    );
    await cleanupTestResources(client, net.instanceId);
  }
  log('done');
}

Deno.exit(code);
