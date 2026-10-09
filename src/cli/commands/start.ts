import { Command } from '@cliffy/command';
import { printError, printSuccess, progress, warnToStderr } from '../utils.ts';
import { dirname, resolve } from 'node:path';
import { findConfigFile, loadConfigFile } from '../../utils/yaml.ts';
import { LocalNet } from '../../localnet.ts';

export const startCommand = new Command()
  .name('start')
  .description('Start the Canton LocalNet')
  .option('-c, --config <path:string>', 'Path to config file')
  .option('-i, --instance <id:string>', 'Instance ID', { default: 'default' })
  .option('-t, --timeout <ms:number>', 'Startup timeout in milliseconds', { default: 300000 })
  .option('--no-parallel', 'Start containers sequentially')
  .option('--skip-health-checks', 'Skip container health checks')
  .option('--skip-init', 'Skip post-startup initialization (party and user setup, packages upload)')
  .action(async (options) => {
    const spin = progress('Starting LocalNet...');

    try {
      const configPath = options.config ?? await findConfigFile();
      if (!configPath) {
        throw new Error(
          'No configuration file found. Use --config <path> or run from a directory with one of: localnet.yaml, localnet.yml, .localnet.yaml, .localnet.yml.',
        );
      }
      const config = await loadConfigFile(configPath, { onWarning: warnToStderr });

      const localnet = await LocalNet.fromConfig(config, {
        instanceId: options.instance,
        configDir: dirname(resolve(configPath)),
      });

      const mismatch = await localnet.detectConfigMismatch();

      if (mismatch.hasMismatch) {
        spin.stop();
        printError('Config mismatch detected:');
        console.log(mismatch.message);
        console.log('');
        console.log("Existing containers don't match your config.");
        console.log(
          `Run 'dnm destroy --instance ${options.instance}' first (stop alone keeps the old containers), or use another --instance, then start again.`,
        );
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
        console.warn(
          'Warning: "discovery" config field is deprecated. Run `dnm discovery serve` for multi-instance discovery.',
        );
      }
    } catch (error) {
      spin.stop();
      printError(`Failed to start LocalNet: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
