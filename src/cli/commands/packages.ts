import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError, warnToStderr } from '../utils.ts';
import { normalizeValidators } from '../../types/config.ts';

export const packagesCommand = new Command()
  .name('packages')
  .description('List packages known to each participant (built-ins included)')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('-v, --validator <name:string>', 'Only show this validator')
  .option('--verbose', 'Show verbose error logging')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const unreachable = new Set<string>();
      const localnet = await getRunningLocalNet(options.instance, {
        onWarning: (warning) => {
          if (warning.source === 'query' && warning.validator) unreachable.add(warning.validator);
          warnToStderr(warning);
        },
      });
      const packages = await localnet.getPackages(options.validator);

      if (options.json) {
        console.log(JSON.stringify(packages, null, 2));
        return;
      }

      if (packages.length === 0) {
        console.log(colors.gray('No packages found'));
        return;
      }

      const participants = options.validator
        ? [options.validator]
        : ['sv', ...normalizeValidators(localnet.getConfig().validators).map((v) => v.name)];

      const table = new Table()
        .header([
          'Package ID',
          ...participants.map((p) => unreachable.has(p) ? `${p} (unreachable)` : p),
        ])
        .border(false);

      for (const pkg of packages) {
        table.push([
          pkg.packageId,
          ...participants.map((p) =>
            unreachable.has(p) ? '?' : pkg.validators.includes(p) ? colors.green('✓') : ''
          ),
        ]);
      }

      console.log();
      console.log(colors.bold(`Packages (${packages.length})`));
      console.log();
      table.render();
    } catch (error) {
      printError(`Failed to list packages: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
