import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { ACCEPT_LIVE, colors, getRunningLocalNet, printError, warnToStderr } from '../utils.ts';

export const partiesCommand = new Command()
  .name('parties')
  .description('List parties and the validator that hosts each')
  .option(
    '--instance <id:string>',
    'Instance ID (auto-resolves to the one running or mixed instance)',
  )
  .option('-v, --validator <name:string>', 'Only parties hosted on this validator')
  .option('--verbose', 'Deprecated: has no effect', { hidden: true })
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(
        options.instance,
        { onWarning: warnToStderr },
        ACCEPT_LIVE,
      );
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
        .header(['Party ID', 'Hint', 'Display Name', 'Validator'])
        .border(false);

      for (const party of parties) {
        table.push([
          party.partyId.length > 40 ? party.partyId.substring(0, 37) + '...' : party.partyId,
          party.hint,
          party.displayName,
          party.validator,
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
