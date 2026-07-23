import { Command } from '@cliffy/command';
import {
  getDestroyableLocalNet,
  printError,
  printSuccess,
  printWarning,
  progress,
} from '../utils.ts';

export const destroyCommand = new Command()
  .name('destroy')
  .description('Destroy the LocalNet and remove all containers, networks, and data')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one instance found)')
  .option('-t, --timeout <sec:number>', 'Stop timeout in seconds', { default: 30 })
  .option('-f, --force', 'Skip confirmation')
  .action(async (options) => {
    if (!options.force) {
      printWarning('This will permanently delete all LocalNet data.');
      const confirmed = confirm('Are you sure you want to continue?');
      if (!confirmed) {
        console.log('Aborted.');
        return;
      }
    }

    const spin = progress('Destroying LocalNet...');

    try {
      const localnet = await getDestroyableLocalNet(options.instance);

      // StopOptions.timeout is milliseconds; the CLI flag is seconds.
      await localnet.destroy({
        timeout: options.timeout * 1000,
      });

      spin.stop();
      printSuccess(`LocalNet destroyed (instance: ${localnet.instanceId})`);
      console.log('  All data removed');
    } catch (error) {
      spin.stop();
      printError(`Failed to destroy LocalNet: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
