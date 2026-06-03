import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError } from '../utils.ts';
import { getKeycloakPort } from '../../utils/ports.ts';

export { type CredentialInfo, getCredentials } from '../../utils/credentials.ts';

export const credentialsCommand = new Command()
  .name('credentials')
  .description('Show login credentials for web UIs')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const credentials = await localnet.getCredentials();

      if (options.json) {
        console.log(JSON.stringify(credentials, null, 2));
        return;
      }

      console.log();
      console.log(colors.bold('Web UI Credentials'));
      console.log(colors.gray('Username equals password for all default users'));
      console.log();

      const table = new Table()
        .header(['Realm', 'URL', 'Username', 'Password', 'Purpose'])
        .border(false);

      for (const cred of credentials) {
        table.push([
          cred.realm,
          colors.cyan(cred.url),
          colors.green(cred.username),
          colors.yellow(cred.password),
          cred.purpose,
        ]);
      }

      table.render();

      const config = localnet.getConfig();
      const keycloakPort = getKeycloakPort(config.basePort);
      console.log();
      console.log(colors.gray(`Keycloak Admin: http://localhost:${keycloakPort} (admin / admin)`));
      console.log();
    } catch (error) {
      printError(`Failed to get credentials: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
