// SPDX-License-Identifier: Apache-2.0
// Copyright Cumberland Applications LLC 2026
import { Command } from '@cliffy/command';
import { startCommand } from './commands/start.ts';
import { stopCommand } from './commands/stop.ts';
import { statusCommand } from './commands/status.ts';
import { destroyCommand } from './commands/destroy.ts';
import { partiesCommand } from './commands/parties.ts';
import { packagesCommand } from './commands/packages.ts';
import { envCommand } from './commands/env.ts';
import { initCommand } from './commands/init.ts';
import { configCommand } from './commands/config.ts';
import { credentialsCommand } from './commands/credentials.ts';
import { instancesCommand } from './commands/instances.ts';
import { entitlementsCommand } from './commands/entitlements.ts';
import { discoveryCommand } from './commands/discovery.ts';

const VERSION = '0.1.0';

export const cli = new Command()
  .name('dnm')
  .version(VERSION)
  .description('Canton LocalNet management CLI')
  .action(function () {
    this.showHelp();
  })
  .command('start', startCommand)
  .command('stop', stopCommand)
  .command('status', statusCommand)
  .command('destroy', destroyCommand)
  .command('init', initCommand)
  .command('config', configCommand)
  .command('parties', partiesCommand)
  .command('packages', packagesCommand)
  .command('env', envCommand)
  .command('credentials', credentialsCommand)
  .command('instances', instancesCommand)
  .command('entitlements', entitlementsCommand)
  .command('discovery', discoveryCommand);

if (import.meta.main) {
  await cli.parse(Deno.args);
}
