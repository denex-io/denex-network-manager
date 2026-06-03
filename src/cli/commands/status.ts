import { Command } from '@cliffy/command';
import { getRunningLocalNet, printError, renderStatusTable } from '../utils.ts';
import { getRealmName, normalizeValidators } from '../../types/config.ts';
import { getKeycloakPort } from '../../utils/ports.ts';

export const statusCommand = new Command()
  .name('status')
  .description('Show LocalNet status')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const status = await localnet.status();

      if (options.json) {
        const config = localnet.getConfig();
        const keycloakPort = getKeycloakPort(config.basePort);
        const validators = normalizeValidators(config.validators);
        const realms = ['SV', ...validators.map((v) => getRealmName(v.name))];

        const output = {
          ...status,
          instanceId: localnet.instanceId,
          keycloak: {
            url: `http://localhost:${keycloakPort}`,
            adminUser: config.auth.keycloak.admin,
            realms,
          },
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        renderStatusTable(status);
      }
    } catch (error) {
      printError(`Failed to get status: ${error instanceof Error ? error.message : error}`);
      Deno.exit(1);
    }
  });
