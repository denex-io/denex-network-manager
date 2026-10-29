import type { LocalNetConfig } from '../types/config.ts';
import type {
  CredentialEntry,
  EnvironmentAuthConfig,
  FullEnvironmentInfo,
  ValidatorAuth,
  ValidatorEndpoints,
  ValidatorEnvironmentInfo,
} from '../types/state.ts';
import {
  DEFAULT_AUDIENCE,
  getKeycloakUrl,
  getLedgerApiUserClientId,
  getRealmName,
  getValidatorClientId,
  normalizeValidators,
} from '../types/config.ts';
import { DEFAULT_BASE_PORT, getSvPorts, getValidatorPorts } from './ports.ts';
import { getCredentials } from './credentials.ts';

/**
 * Environment info computed from a config alone, without contacting Docker or any API.
 *
 * Endpoints, auth settings, and credentials are filled in from the port allocation and naming
 * rules. The live fields are left empty: `network.domainId`, `network.dsoPartyId`, and each
 * validator's `participantId` are `null`, and `parties` is `[]`. {@link LocalNet.getEnvironment}
 * fills in the live fields from a running instance.
 */
export function buildConfigEnvironmentInfo(
  config: LocalNetConfig,
): FullEnvironmentInfo {
  const basePort = config.basePort ?? DEFAULT_BASE_PORT;
  const keycloakUrl = getKeycloakUrl(config);
  const normalizedValidators = normalizeValidators(config.validators);

  const svPorts = getSvPorts(basePort);
  const svEndpoints: ValidatorEndpoints = {
    ledgerApi: `http://localhost:${svPorts.ledgerApi}`,
    jsonApi: `http://localhost:${svPorts.jsonApi}`,
    adminApi: `http://localhost:${svPorts.adminApi}`,
    validatorAdminApi: `http://localhost:${svPorts.validatorAdminApi}`,
    webUi: `http://sv.localhost:${svPorts.webUi}`,
  };
  const svAuth: ValidatorAuth = {
    realm: 'SV',
    keycloakTokenUrl: `${keycloakUrl}/realms/SV/protocol/openid-connect/token`,
    clientId: getValidatorClientId('sv'),
    clientSecret: 'sv-validator-secret',
    userClientId: getLedgerApiUserClientId('sv'),
    audience: DEFAULT_AUDIENCE,
  };
  const svInfo: ValidatorEnvironmentInfo = {
    name: 'sv',
    role: 'sv',
    participantId: null,
    endpoints: svEndpoints,
    auth: svAuth,
  };

  const validators: Record<string, ValidatorEnvironmentInfo> = { sv: svInfo };

  for (let i = 0; i < normalizedValidators.length; i++) {
    const validator = normalizedValidators[i];
    const ports = getValidatorPorts(i, basePort);
    const realmName = getRealmName(validator.name);

    const endpoints: ValidatorEndpoints = {
      ledgerApi: `http://localhost:${ports.ledgerApi}`,
      jsonApi: `http://localhost:${ports.jsonApi}`,
      adminApi: `http://localhost:${ports.adminApi}`,
      validatorAdminApi: `http://localhost:${ports.validatorAdminApi}`,
      webUi: `http://wallet.localhost:${ports.webUi}`,
    };
    const auth: ValidatorAuth = {
      realm: realmName,
      keycloakTokenUrl: `${keycloakUrl}/realms/${realmName}/protocol/openid-connect/token`,
      clientId: getValidatorClientId(validator.name),
      clientSecret: `${getValidatorClientId(validator.name)}-secret`,
      userClientId: getLedgerApiUserClientId(validator.name),
      audience: DEFAULT_AUDIENCE,
    };

    validators[validator.name] = {
      name: validator.name,
      role: 'validator',
      participantId: null,
      endpoints,
      auth,
    };
  }

  const authConfig: EnvironmentAuthConfig = {
    keycloak: {
      url: keycloakUrl,
      adminConsoleUrl: keycloakUrl,
      adminUsername: config.auth.keycloak.admin,
      adminPassword: config.auth.keycloak.password,
    },
    ledgerApi: {
      mode: 'keycloak',
      algorithm: 'RS256',
      audience: DEFAULT_AUDIENCE,
      subjectClaim: 'sub',
    },
  };

  const credentials: CredentialEntry[] = getCredentials(
    config.validators,
    basePort,
  );

  return {
    network: { domainId: null, dsoPartyId: null },
    validators,
    auth: authConfig,
    credentials,
    parties: [],
  };
}
