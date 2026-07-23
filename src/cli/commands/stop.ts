import { Command } from '@cliffy/command';
import { getRunningLocalNet, printError, printSuccess, progress } from '../utils.ts';

export const stopCommand = new Command()
  .name('stop')
  .description('Stop the Canton LocalNet')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('-t, --timeout <sec:number>', 'Stop timeout in seconds', { default: 30 })
  .action(async (options) => {
    const spin = progress('Stopping LocalNet...');

    try {
      const localnet = await getRunningLocalNet(options.instance);

      // StopOptions.timeout is milliseconds; the CLI flag is seconds.
      await localnet.stop({ timeout: options.timeout * 1000 });

      spin.stop();
      printSuccess(`LocalNet stopped (instance: ${localnet.instanceId})`);
    } catch (error) {
      spin.stop();
      printError(`Failed to stop LocalNet: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
