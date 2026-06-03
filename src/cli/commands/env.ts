import { Command } from '@cliffy/command';
import { Table } from '@cliffy/table';
import { colors, getRunningLocalNet, printError } from '../utils.ts';
import type { FullEnvironmentInfo } from '../../types/state.ts';

export const envCommand = new Command()
  .name('env')
  .description('Show environment info for the LocalNet')
  .option('--instance <id:string>', 'Instance ID (auto-resolves if only one running)')
  .option('--json', 'Output as JSON')
  .option('--shell', 'Output as shell export statements')
  .action(async (options) => {
    try {
      const localnet = await getRunningLocalNet(options.instance);
      const envInfo = await localnet.getEnvironment();

      try {
        const svClient = localnet.getCantonClient('sv');
        if (svClient) {
          const synchronizers = await svClient.listConnectedSynchronizers();
          if (synchronizers.length > 0) {
            envInfo.network.domainId = synchronizers[0].synchronizerId;
          }
        }
      } catch {
        void 0;
      }

      if (options.json) {
        outputJson(envInfo);
      } else if (options.shell) {
        outputShell(envInfo);
      } else {
        outputText(envInfo);
      }
    } catch (error) {
      printError(
        `Failed to get environment info: ${error instanceof Error ? error.message : error}`,
      );
      Deno.exit(1);
    }
  });

function outputJson(envInfo: FullEnvironmentInfo): void {
  console.log(JSON.stringify(envInfo, null, 2));
}

function outputText(envInfo: FullEnvironmentInfo): void {
  const separator = '─'.repeat(50);
  const na = colors.gray('(not available)');

  console.log();
  console.log(colors.bold('Network Info'));
  console.log(separator);
  console.log(`  Domain ID:          ${envInfo.network.domainId ?? na}`);
  console.log(`  DSO Party ID:       ${envInfo.network.dsoPartyId ?? na}`);

  for (const validator of Object.values(envInfo.validators)) {
    console.log();
    if (validator.role === 'sv') {
      console.log(colors.bold('Super Validator (sv)'));
    } else {
      console.log(colors.bold(`Validator: ${validator.name}`));
    }
    console.log(separator);
    console.log(
      `  Ledger API:         ${colors.cyan(validator.endpoints.ledgerApi)}`,
    );
    console.log(
      `  JSON API:           ${colors.cyan(validator.endpoints.jsonApi)}`,
    );
    console.log(
      `  Admin API:          ${colors.cyan(validator.endpoints.adminApi)}`,
    );
    console.log(
      `  Validator Admin:    ${colors.cyan(validator.endpoints.validatorAdminApi)}`,
    );
    console.log(
      `  Web UI:             ${colors.cyan(validator.endpoints.webUi)}`,
    );
    console.log(`  Keycloak Realm:     ${validator.auth.realm}`);
    console.log(`  Client ID:          ${validator.auth.clientId}`);
    console.log(`  User Client ID:     ${validator.auth.userClientId}`);
    console.log(
      `  Token URL:          ${colors.cyan(validator.auth.keycloakTokenUrl)}`,
    );
  }

  console.log();
  console.log(colors.bold('Keycloak'));
  console.log(separator);
  console.log(
    `  URL:                ${colors.cyan(envInfo.auth.keycloak.url)}`,
  );
  console.log(
    `  Admin Console:      ${colors.cyan(envInfo.auth.keycloak.adminConsoleUrl)}`,
  );
  console.log(`  Admin User:         ${envInfo.auth.keycloak.adminUsername}`);
  console.log(
    `  Admin Password:     ${envInfo.auth.keycloak.adminPassword}`,
  );

  console.log();
  console.log(colors.bold('Ledger API Auth'));
  console.log(separator);
  console.log(`  Mode:               ${envInfo.auth.ledgerApi.mode}`);
  console.log(`  Algorithm:          ${envInfo.auth.ledgerApi.algorithm}`);
  console.log(`  Audience:           ${envInfo.auth.ledgerApi.audience}`);
  console.log(`  Subject Claim:      ${envInfo.auth.ledgerApi.subjectClaim}`);

  console.log();
  console.log(colors.bold('Credentials'));
  console.log(separator);
  console.log();

  const credTable = new Table()
    .header(['Realm', 'URL', 'Username', 'Password', 'Purpose'])
    .border(false);

  for (const cred of envInfo.credentials) {
    credTable.push([
      cred.realm,
      colors.cyan(cred.url),
      colors.green(cred.username),
      colors.yellow(cred.password),
      cred.purpose,
    ]);
  }

  credTable.render();

  console.log();
  console.log(colors.bold('Parties'));
  console.log(separator);

  if (envInfo.parties.length === 0) {
    console.log(colors.gray('  (no parties available)'));
  } else {
    console.log();
    const partyTable = new Table()
      .header(['Hint', 'Display Name', 'Party ID', 'Validator'])
      .border(false);

    for (const party of envInfo.parties) {
      const partyId = party.partyId
        ? (party.partyId.length > 40 ? party.partyId.substring(0, 37) + '...' : party.partyId)
        : na;
      partyTable.push([
        party.hint,
        party.displayName,
        partyId,
        party.validator,
      ]);
    }

    partyTable.render();
  }

  console.log();
}

function toShellVarName(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}

function outputShell(envInfo: FullEnvironmentInfo): void {
  const emit = (key: string, value: string | null) => {
    console.log(`export ${key}="${value ?? ''}"`);
  };

  emit('LOCALNET_DOMAIN_ID', envInfo.network.domainId);
  emit('LOCALNET_DSO_PARTY_ID', envInfo.network.dsoPartyId);

  for (const validator of Object.values(envInfo.validators)) {
    const prefix = `LOCALNET_${toShellVarName(validator.name)}`;
    emit(`${prefix}_LEDGER_API`, validator.endpoints.ledgerApi);
    emit(`${prefix}_JSON_API`, validator.endpoints.jsonApi);
    emit(`${prefix}_ADMIN_API`, validator.endpoints.adminApi);
    emit(`${prefix}_VALIDATOR_ADMIN_API`, validator.endpoints.validatorAdminApi);
    emit(`${prefix}_WEB_UI`, validator.endpoints.webUi);
    emit(`${prefix}_KEYCLOAK_REALM`, validator.auth.realm);
    emit(`${prefix}_KEYCLOAK_TOKEN_URL`, validator.auth.keycloakTokenUrl);
    emit(`${prefix}_KEYCLOAK_CLIENT_ID`, validator.auth.clientId);
    emit(`${prefix}_KEYCLOAK_CLIENT_SECRET`, validator.auth.clientSecret);
    emit(`${prefix}_KEYCLOAK_USER_CLIENT_ID`, validator.auth.userClientId);
  }

  emit('LOCALNET_KEYCLOAK_URL', envInfo.auth.keycloak.url);
  emit('LOCALNET_KEYCLOAK_ADMIN_USER', envInfo.auth.keycloak.adminUsername);
  emit('LOCALNET_KEYCLOAK_ADMIN_PASSWORD', envInfo.auth.keycloak.adminPassword);

  emit('LOCALNET_LEDGER_API_AUTH_MODE', envInfo.auth.ledgerApi.mode);
  emit('LOCALNET_LEDGER_API_AUTH_ALGORITHM', envInfo.auth.ledgerApi.algorithm);
  emit('LOCALNET_LEDGER_API_AUTH_AUDIENCE', envInfo.auth.ledgerApi.audience);
  emit('LOCALNET_LEDGER_API_AUTH_SUBJECT_CLAIM', envInfo.auth.ledgerApi.subjectClaim);
}
