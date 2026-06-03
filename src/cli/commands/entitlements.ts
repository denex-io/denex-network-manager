import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError } from '../utils.ts';
import type { ApiUserRight } from '../../api/canton.ts';

function formatRight(right: ApiUserRight): string {
  const kind = right.kind;
  if ('CanActAs' in kind) {
    const party = kind.CanActAs.value.party;
    const hint = party.split('::')[0] ?? party;
    return `ActAs(${hint})`;
  }
  if ('CanReadAs' in kind) {
    const party = kind.CanReadAs.value.party;
    const hint = party.split('::')[0] ?? party;
    return `ReadAs(${hint})`;
  }
  if ('CanExecuteAs' in kind) {
    const party = kind.CanExecuteAs.value.party;
    const hint = party.split('::')[0] ?? party;
    return `ExecAs(${hint})`;
  }
  if ('ParticipantAdmin' in kind) return 'Admin';
  if ('CanReadAsAnyParty' in kind) return 'ReadAs(*)';
  if ('CanExecuteAsAnyParty' in kind) return 'ExecAs(*)';
  if ('IdentityProviderAdmin' in kind) return 'IDPAdmin';
  return 'Unknown';
}

export const entitlementsCommand = new Command()
  .name('entitlements')
  .description('List users with their rights on the LocalNet')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('-v, --validator <name:string>', 'Filter by validator')
  .option('--verbose', 'Show verbose error logging')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const users = await localnet.getUsersWithRights(options.validator);

      if (options.json) {
        console.log(JSON.stringify(users, null, 2));
        return;
      }

      if (users.length === 0) {
        console.log(colors.gray('No users found'));
        return;
      }

      const table = new Table()
        .header(['User ID', 'Primary Party', 'Rights', 'Validator', 'Active'])
        .border(false);

      for (const user of users) {
        const rightsDisplay = user.rights.length > 0
          ? user.rights.map(formatRight).join(', ')
          : colors.gray('none');

        table.push([
          user.id,
          user.primaryParty
            ? (user.primaryParty.length > 30
              ? user.primaryParty.substring(0, 27) + '...'
              : user.primaryParty)
            : colors.gray('-'),
          rightsDisplay,
          user.validator,
          user.isDeactivated ? colors.red('no') : colors.green('yes'),
        ]);
      }

      console.log();
      console.log(colors.bold(`Users & Entitlements (${users.length})`));
      console.log();
      table.render();
    } catch (error) {
      printError(`Failed to list entitlements: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
