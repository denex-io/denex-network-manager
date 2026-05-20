import { Command } from '@cliffy/command';
import { getRunningLocalNet, printSuccess, printError, progress } from '../utils.ts';

export const initCommand = new Command()
  .name('init')
  .description('Initialize resources on a running LocalNet (create users, link parties)')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .action(async (options) => {
    const spin = progress('Initializing resources...');

    try {
      const localnet = await getRunningLocalNet(options.instance);

      const status = await localnet.status();
      if (status.state !== 'running') {
        throw new Error(`LocalNet is not running (state: ${status.state}). Start it first with 'localnet start'.`);
      }

      await localnet.initializeResources((message) => spin.update(message));

      spin.stop();
      printSuccess('Resource initialization complete');
    } catch (error) {
      spin.stop();
      printError(`Failed to initialize resources: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
