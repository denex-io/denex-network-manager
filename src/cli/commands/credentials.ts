import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError } from '../utils.ts';
import { getKeycloakPort } from '../../utils/ports.ts';
import type { LocalNetConfig } from '../../types/config.ts';
import type { CredentialInfo } from '../../utils/credentials.ts';

export { type CredentialInfo, getCredentials } from '../../utils/credentials.ts';

/**
 * The Keycloak master-realm admin login as configured in `auth.keycloak`.
 * The CLI adds this to `getCredentials()` output, which covers web UI logins only.
 */
export function keycloakAdminCredential(config: LocalNetConfig): CredentialInfo {
  return {
    realm: 'master',
    url: `http://localhost:${getKeycloakPort(config.basePort)}`,
    username: config.auth.keycloak.admin,
    password: config.auth.keycloak.password,
    purpose: 'Keycloak admin console',
  };
}

export const credentialsCommand = new Command()
  .name('credentials')
  .description('Show login credentials for web UIs')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const credentials = await localnet.getCredentials();
      const config = localnet.getConfig();
      const keycloakAdmin = keycloakAdminCredential(config);

      if (options.json) {
        console.log(JSON.stringify([...credentials, keycloakAdmin], null, 2));
        return;
      }

      console.log();
      console.log(colors.bold('Web UI Credentials'));
      console.log(colors.gray('Username equals password for the web UI logins below'));
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

      console.log();
      console.log(
        colors.gray(
          `Keycloak Admin: ${keycloakAdmin.url} (${keycloakAdmin.username} / ${keycloakAdmin.password})`,
        ),
      );
      console.log();
    } catch (error) {
      printError(`Failed to get credentials: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
