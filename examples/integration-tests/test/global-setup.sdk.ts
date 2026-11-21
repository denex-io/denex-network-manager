/**
 * Global setup for the SDK pattern (`npm run test:integration:sdk`): the test run owns the
 * LocalNet through @denex/network-manager, with no dnm binary involved. It reuses a running
 * instance, starts one otherwise, and destroys only an instance it created.
 */
import { LocalNet } from '@denex/network-manager/sdk';
import type { TestProject } from 'vitest/node';
import { followContainerLogs, printLogTails } from '../scripts/container-logs.ts';
import { APP_VALIDATORS, CONFIG, DAR, INSTANCE, LOGS_DIR } from '../scripts/dnm.ts';

let net: LocalNet | undefined;
let created = false;
let logs: { stop(): Promise<void> } | undefined;

/** The instance if any of its containers exist, running or not; null if there is none. */
async function attach(): Promise<LocalNet | null> {
  try {
    return await LocalNet.fromInstanceId(INSTANCE);
  } catch (error) {
    // Only "nothing there yet" is ordinary. The SDK throws plain Errors, hence the message match.
    if (!String(error).includes('No running LocalNet found')) throw error;
    return null;
  }
}

export async function setup(project: TestProject): Promise<void> {
  logs = followContainerLogs();
  try {
    const existing = await attach();
    created = existing === null;
    // fromInstanceId only proves the containers exist; a stopped instance attaches too.
    if (existing && (await existing.isRunning())) {
      console.log(`Reusing LocalNet '${INSTANCE}'.`);
      net = existing;
    } else {
      console.log(`Starting LocalNet '${INSTANCE}' (a cold first start takes several minutes)...`);
      const fresh = await LocalNet.fromConfig(CONFIG, { instanceId: INSTANCE });
      // In milliseconds, and in dnm 0.1.0-beta.3 checked only between container layers.
      await fresh.start({ timeout: 900_000, onProgress: (m) => console.log(`  ${m}`) });
      net = fresh;
    }
    // Throws if any participant rejects the DAR, unlike the `packages:` upload in localnet.yaml.
    await net.uploadDar(DAR, APP_VALIDATORS);
    project.provide('localnet', await net.getEnvironment());
  } catch (error) {
    await logs.stop();
    printLogTails();
    if (created && net) await net.destroy();
    throw error;
  }
}

export async function teardown(): Promise<void> {
  await logs?.stop();
  console.log(`Container logs: ${LOGS_DIR}`);
  // Containers outlive the test run, so teardown is explicit.
  if (created) await net?.destroy();
  else console.log(`Left LocalNet '${INSTANCE}' running: it existed before this run.`);
}
