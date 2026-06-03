import { getRealmName, normalizeValidators, type ValidatorConfig } from '../types/config.ts';
import { DEFAULT_BASE_PORT, getSvPorts, getValidatorPorts } from './ports.ts';

export interface CredentialInfo {
  realm: string;
  url: string;
  username: string;
  password: string;
  purpose: string;
}

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
