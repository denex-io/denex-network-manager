import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { LocalNet } from '../../localnet.ts';
import { colors, printError } from '../utils.ts';
import type { DiscoveredInstance } from '../../api/discovery-utils.ts';

export const instancesCommand = new Command()
  .name('instances')
  .description('List running LocalNet instances')
  .option('--json', 'Output as JSON')
  .option('--ids-only', 'Show only instance IDs (one per line)')
  .action(async (options) => {
    try {
      const instances = await LocalNet.discover();

      if (options.idsOnly) {
        instances.forEach((instance) => console.log(instance.id));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(instances, null, 2));
        return;
      }

      if (instances.length === 0) {
        console.log(colors.gray('No running LocalNet instances'));
        return;
      }

      renderInstancesTable(instances);
    } catch (error) {
      printError(`Failed to list instances: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });

function renderInstancesTable(instances: DiscoveredInstance[]): void {
  console.log();
  console.log(colors.bold(`Instances (${instances.length})`));
  console.log();

  const table = new Table()
    .header(['Instance ID', 'Status', 'Validators', 'Containers', 'Base Port'])
    .border(false);

  let hasUnsupported = false;

  for (const instance of instances) {
    if (instance.status === 'unsupported') {
      hasUnsupported = true;
    }

    const statusColor = instance.status === 'running'
      ? colors.green(instance.status)
      : instance.status === 'stopped'
      ? colors.gray(instance.status)
      : instance.status === 'mixed'
      ? colors.yellow(instance.status)
      : colors.red(instance.status);

    const validatorNames = instance.validatorNames.length > 0
      ? instance.validatorNames.join(', ')
      : '—';

    table.push([
      instance.id,
      statusColor,
      validatorNames,
      String(instance.containerCount),
      instance.basePort > 0 ? String(instance.basePort) : '—',
    ]);
  }

  table.render();

  if (hasUnsupported) {
    console.log();
    console.log(
      colors.yellow(
        'Note: Some instances use an unsupported schema. Run `denex-localnet destroy --instance <id>` to clean up.',
      ),
    );
  }
}
