import {
  getRealmName,
  getWalletAdminUserId,
  normalizeValidators,
  type ValidatorConfig,
} from '../types/config.ts';
import { DEFAULT_BASE_PORT, getSvPorts, getValidatorPorts } from './ports.ts';

export interface CredentialInfo {
  realm: string;
  url: string;
  username: string;
  password: string;
  purpose: string;
}

/**
 * Logins for the web UIs of a LocalNet: the SV, then each validator.
 *
 * Per validator, the first row is the wallet-admin login (`<name with - as _>-wallet-admin`),
 * the only user Splice onboards by default, so it is the one that can use the wallet. It is
 * followed by one row per YAML user. A YAML user can use the wallet only if it has a
 * `primaryParty`; otherwise its purpose says "not onboarded". A user whose id repeats an
 * earlier login in the same realm is skipped. Username equals password for every row.
 */
export function getCredentials(
  validatorsConfig: number | ValidatorConfig[],
  basePort: number = DEFAULT_BASE_PORT,
): CredentialInfo[] {
  const validators = normalizeValidators(validatorsConfig);
  const credentials: CredentialInfo[] = [];

  const svWebUiPort = getSvPorts(basePort).webUi;

  credentials.push({
    realm: 'SV',
    url: `http://sv.localhost:${svWebUiPort}`,
    username: 'sv',
    password: 'sv',
    purpose: 'SV management UI',
  });

  credentials.push({
    realm: 'SV',
    url: `http://wallet.localhost:${svWebUiPort}`,
    username: 'sv',
    password: 'sv',
    purpose: 'SV wallet',
  });

  for (let i = 0; i < validators.length; i++) {
    const validator = validators[i];

    const realmName = getRealmName(validator.name);

    const uiPort = getValidatorPorts(i, basePort).webUi;
    const walletAdminId = getWalletAdminUserId(validator.name);

    credentials.push({
      realm: realmName,
      url: `http://wallet.localhost:${uiPort}`,
      username: walletAdminId,
      password: walletAdminId,
      purpose: `${validator.name} wallet`,
    });

    if (validator.users) {
      const seen = new Set<string>([walletAdminId]);
      for (const user of validator.users) {
        if (seen.has(user.id)) continue;
        seen.add(user.id);
        credentials.push({
          realm: realmName,
          url: `http://wallet.localhost:${uiPort}`,
          username: user.id,
          password: user.id,
          purpose: user.primaryParty
            ? `${user.id} (custom user)`
            : `${user.id} (custom user, not onboarded — no primaryParty, wallet login will not work)`,
        });
      }
    }
  }

  return credentials;
}
