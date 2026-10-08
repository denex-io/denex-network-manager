import { getRealmName, normalizeValidators, type ValidatorConfig } from '../types/config.ts';
import { DEFAULT_BASE_PORT, getSvPorts, getValidatorPorts } from './ports.ts';

/** One web UI login: where to sign in and with which Keycloak user. */
export interface CredentialInfo {
  /** Keycloak realm of the user, such as `SV` or `Validator1`. */
  realm: string;
  /** Web UI URL. */
  url: string;
  username: string;
  password: string;
  /** Human-readable label, such as `validator-1 wallet`. */
  purpose: string;
}

/**
 * Web UI login entries derived from a validators config. Makes no network calls and does not
 * check that any login works.
 *
 * Returns, in order: the SV UI and SV wallet (user `sv`, password `sv`), then for each validator
 * a wallet entry whose username and password are the validator name, followed by one entry per
 * configured user with username and password set to the user ID. Validator entries use
 * `http://wallet.localhost:<port>` and SV entries `http://sv.localhost:<port>` or
 * `http://wallet.localhost:<port>`, with ports from the port allocation.
 *
 * Known bug: the per-validator wallet entry does not work as a wallet login. The Keycloak user
 * named after the validator can sign in but is not onboarded to the wallet. The onboarded wallet
 * user is `<validator_name>-wallet-admin`, where `<validator_name>` is the validator name with
 * hyphens replaced by underscores (for example `validator_1-wallet-admin`), and its password is
 * the same as its username. Entries for configured users without a `primaryParty` are not
 * onboarded to the wallet either.
 *
 * @param validatorsConfig - The config's `validators` value: a count or a list of validators.
 * @param basePort - Defaults to 5000.
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

    credentials.push({
      realm: realmName,
      url: `http://wallet.localhost:${uiPort}`,
      username: validator.name,
      password: validator.name,
      purpose: `${validator.name} wallet`,
    });

    if (validator.users) {
      for (const user of validator.users) {
        credentials.push({
          realm: realmName,
          url: `http://wallet.localhost:${uiPort}`,
          username: user.id,
          password: user.id,
          purpose: `${user.id} (custom user)`,
        });
      }
    }
  }

  return credentials;
}
