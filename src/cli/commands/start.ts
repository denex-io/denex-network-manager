import { Command } from '@cliffy/command';
import { printSuccess, printError, progress } from '../utils.ts';
import { loadConfigFile, loadConfigFromDir } from '../../utils/yaml.ts';
import { LocalNet } from '../../localnet.ts';

export const startCommand = new Command()
  .name('start')
  .description('Start the Canton LocalNet')
  .option('-c, --config <path:string>', 'Path to config file')
  .option('-i, --instance <id:string>', 'Instance ID', { default: 'default' })
  .option('-t, --timeout <ms:number>', 'Startup timeout in milliseconds', { default: 300000 })
  .option('--no-parallel', 'Start containers sequentially')
  .option('--skip-health-checks', 'Skip container health checks')
  .option('--skip-init', 'Skip post-startup initialization (user/party setup)')
  .action(async (options) => {
    const spin = progress('Starting LocalNet...');

    try {
      const config = options.config
        ? await loadConfigFile(options.config)
        : await loadConfigFromDir();

      const localnet = await LocalNet.fromConfig(config, { instanceId: options.instance });

      const mismatch = await localnet.detectConfigMismatch();

      if (mismatch.hasMismatch) {
        spin.stop();
        printError('Config mismatch detected:');
        console.log(mismatch.message);
        console.log('');
        console.log("Existing containers don't match your config.");
        console.log("Run 'stop' or 'destroy' first, then 'start' again.");
        Deno.exit(1);
      }

      await localnet.start({
        timeout: options.timeout,
        parallel: options.parallel,
        skipHealthChecks: options.skipHealthChecks,
        skipInitialization: options.skipInit,
        onProgress: (message) => spin.update(message),
      });

      spin.stop();
      printSuccess(`LocalNet started (instance: ${options.instance})`);

      const status = await localnet.status();
      console.log(`  Containers: ${status.containers.length}`);
      console.log(`  Network:    ${status.network?.name ?? 'none'}`);

      if (config.discovery) {
        console.warn('Warning: "discovery" config field is deprecated. Use "localnet discovery serve" for multi-instance discovery.');
      }
    } catch (error) {
      spin.stop();
      printError(`Failed to start LocalNet: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
