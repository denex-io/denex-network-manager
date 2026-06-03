import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError } from '../utils.ts';

export const partiesCommand = new Command()
  .name('parties')
  .description('List parties on the LocalNet')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('-v, --validator <name:string>', 'Filter by validator')
  .option('--verbose', 'Show verbose error logging')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const parties = await localnet.getParties(options.validator);

      if (options.json) {
        console.log(JSON.stringify(parties, null, 2));
        return;
      }

      if (parties.length === 0) {
        console.log(colors.gray('No parties found'));
        return;
      }

      const table = new Table()
        .header(['Party ID', 'Hint', 'Display Name', 'Validator', 'Local'])
        .border(false);

      for (const party of parties) {
        table.push([
          party.partyId.length > 40 ? party.partyId.substring(0, 37) + '...' : party.partyId,
          party.hint,
          party.displayName,
          party.validator,
          party.isLocal ? colors.green('yes') : colors.gray('no'),
        ]);
      }

      console.log();
      console.log(colors.bold(`Parties (${parties.length})`));
      console.log();
      table.render();
    } catch (error) {
      printError(`Failed to list parties: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
