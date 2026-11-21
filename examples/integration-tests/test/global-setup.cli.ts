/**
 * Global setup for the CLI pattern. scripts/localnet.ts, or `npm run localnet:up`, has already
 * started the LocalNet, so this only reads its environment, once, and gives every test file the
 * same snapshot. Party ids change with every fresh LocalNet, so nothing is hardcoded.
 */
import type { FullEnvironmentInfo } from '@denex/network-manager/sdk';
import type { TestProject } from 'vitest/node';
import { dnmJson, INSTANCE } from '../scripts/dnm.ts';

export async function setup(project: TestProject): Promise<void> {
  const env = await dnmJson<FullEnvironmentInfo>('env', '--instance', INSTANCE).catch((error) => {
    throw new Error(
      `Could not read LocalNet '${INSTANCE}' (${error.message}). Start it with ` +
        '`npm run localnet:up`, or run everything with `npm run test:integration`.',
    );
  });
  project.provide('localnet', env);
}
