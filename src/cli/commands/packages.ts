import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError } from '../utils.ts';

export const packagesCommand = new Command()
  .name('packages')
  .description('List packages on the LocalNet')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('-v, --validator <name:string>', 'Filter by validator')
  .option('--verbose', 'Show verbose error logging')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const packages = await localnet.getPackages(options.validator);

      if (options.json) {
        console.log(JSON.stringify(packages, null, 2));
        return;
      }

      if (packages.length === 0) {
        console.log(colors.gray('No packages found'));
        return;
      }

      const table = new Table()
        .header(['Package ID', 'Size', 'Known Since', 'Validator'])
        .border(false);

      for (const pkg of packages) {
        const sizeKb = Math.round(pkg.packageSize / 1024);
        table.push([
          pkg.packageId.length > 40 ? pkg.packageId.substring(0, 37) + '...' : pkg.packageId,
          `${sizeKb} KB`,
          pkg.knownSince,
          pkg.validator,
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
