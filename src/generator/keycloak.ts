/**
 * Minimal Keycloak realm JSON generator.
 *
 * Generates small, focused realm configurations (~100 lines) instead of
 * the massive 2300-line exports from Keycloak admin console.
 */

import type { LocalNetConfig, ValidatorConfig } from '../types/config.ts';
import {
  DEFAULT_AUDIENCE,
  getLedgerApiUserClientId,
  getRealmName,
  getValidatorClientId,
  normalizeValidators,
} from '../types/config.ts';
import { getSvPorts, getValidatorPorts, DEFAULT_BASE_PORT } from '../utils/ports.ts';

export const BOOTSTRAP_ADMIN_USERNAME = 'localnet-internal-bootstrap-do-not-use';

export interface KeycloakClient {
  clientId: string;
  name?: string;
  enabled: boolean;
  publicClient: boolean;
  serviceAccountsEnabled: boolean;
  standardFlowEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  redirectUris: string[];
  webOrigins: string[];
  defaultClientScopes: string[];
  optionalClientScopes?: string[];
  secret?: string;
  attributes?: Record<string, string>;
}

export interface KeycloakUser {
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified: boolean;
  enabled: boolean;
  credentials: Array<{
    type: string;
    value: string;
    temporary: boolean;
  }>;
  realmRoles: string[];
  requiredActions?: string[];
  clientRoles?: Record<string, string[]>;
}

export interface KeycloakClientScope {
  name: string;
  protocol: string;
  attributes: Record<string, string>;
  protocolMappers: Array<{
    name: string;
    protocol: string;
    protocolMapper: string;
    consentRequired: boolean;
    config: Record<string, string>;
  }>;
}

export interface KeycloakRealm {
  realm: string;
  enabled: boolean;
  sslRequired: string;
  registrationAllowed: boolean;
  loginWithEmailAllowed: boolean;
  duplicateEmailsAllowed: boolean;
  resetPasswordAllowed: boolean;
  editUsernameAllowed: boolean;
  bruteForceProtected: boolean;
  defaultSignatureAlgorithm: string;
  accessTokenLifespan: number;
  ssoSessionIdleTimeout: number;
  ssoSessionMaxLifespan: number;
  clients: KeycloakClient[];
  clientScopes: KeycloakClientScope[];
  defaultDefaultClientScopes: string[];
  defaultOptionalClientScopes?: string[];
  users?: KeycloakUser[];
}

function createAudienceClientScope(audience: string): KeycloakClientScope {
  return {
    name: 'canton-audience',
    protocol: 'openid-connect',
    attributes: {
      'include.in.token.scope': 'true',
      'display.on.consent.screen': 'false',
    },
    protocolMappers: [
      {
        name: 'audience-mapper',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        consentRequired: false,
        config: {
          'included.custom.audience': audience,
          'id.token.claim': 'false',
          'access.token.claim': 'true',
        },
      },
      // Map username to 'sub' claim so Splice can identify the ledger user.
      // Splice's JwtClaims.getLedgerApiUser() falls back to using 'sub' when
      // the 'https://canton-network' claim is not present.
      {
        name: 'username-sub-mapper',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-usermodel-property-mapper',
        consentRequired: false,
        config: {
          'user.attribute': 'username',
          'claim.name': 'sub',
          'id.token.claim': 'true',
          'access.token.claim': 'true',
          'jsonType.label': 'String',
        },
      },
    ],
  };
}

function createStandardClientScopes(): KeycloakClientScope[] {
  return [
    {
      name: 'offline_access',
      protocol: 'openid-connect',
      attributes: {
        'consent.screen.text': '${offlineAccessScopeConsentText}',
        'display.on.consent.screen': 'true',
      },
      protocolMappers: [],
    },
    {
      name: 'profile',
      protocol: 'openid-connect',
      attributes: {
        'include.in.token.scope': 'true',
        'consent.screen.text': '${profileScopeConsentText}',
        'display.on.consent.screen': 'true',
      },
      protocolMappers: [
        {
          name: 'username',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-usermodel-property-mapper',
          consentRequired: false,
          config: {
            'userinfo.token.claim': 'true',
            'user.attribute': 'username',
            'id.token.claim': 'true',
            'access.token.claim': 'true',
            'claim.name': 'preferred_username',
            'jsonType.label': 'String',
          },
        },
        {
          name: 'full name',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-full-name-mapper',
          consentRequired: false,
          config: {
            'id.token.claim': 'true',
            'access.token.claim': 'true',
            'userinfo.token.claim': 'true',
          },
        },
      ],
    },
    {
      name: 'email',
      protocol: 'openid-connect',
      attributes: {
        'include.in.token.scope': 'true',
        'consent.screen.text': '${emailScopeConsentText}',
        'display.on.consent.screen': 'true',
      },
      protocolMappers: [
        {
          name: 'email',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-usermodel-property-mapper',
          consentRequired: false,
          config: {
            'userinfo.token.claim': 'true',
            'user.attribute': 'email',
            'id.token.claim': 'true',
            'access.token.claim': 'true',
            'claim.name': 'email',
            'jsonType.label': 'String',
          },
        },
        {
          name: 'email verified',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-usermodel-property-mapper',
          consentRequired: false,
          config: {
            'userinfo.token.claim': 'true',
            'user.attribute': 'emailVerified',
            'id.token.claim': 'true',
            'access.token.claim': 'true',
            'claim.name': 'email_verified',
            'jsonType.label': 'boolean',
          },
        },
      ],
    },
    {
      name: 'roles',
      protocol: 'openid-connect',
      attributes: {
        'include.in.token.scope': 'false',
        'consent.screen.text': '${rolesScopeConsentText}',
        'display.on.consent.screen': 'true',
      },
      protocolMappers: [],
    },
    {
      name: 'web-origins',
      protocol: 'openid-connect',
      attributes: {
        'include.in.token.scope': 'false',
        'consent.screen.text': '',
        'display.on.consent.screen': 'false',
      },
      protocolMappers: [],
    },
  ];
}

function createValidatorClient(validatorName: string): KeycloakClient {
  return {
    clientId: getValidatorClientId(validatorName),
    name: `${validatorName} Validator`,
    enabled: true,
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ['canton-audience'],
    secret: `${getValidatorClientId(validatorName)}-secret`,
  };
}

function createWalletClient(
  validatorName: string,
  port: number,
): KeycloakClient {
  return {
    clientId: `${validatorName}-wallet`,
    name: `${validatorName} Wallet UI`,
    enabled: true,
    publicClient: true,
    serviceAccountsEnabled: false,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    redirectUris: [`http://wallet.localhost:${port}/*`],
    webOrigins: ['*'],
    defaultClientScopes: ['canton-audience', 'profile', 'email', 'roles', 'web-origins'],
    optionalClientScopes: ['offline_access'],
    attributes: {
      'oidc.ciba.grant.enabled': 'false',
      'oauth2.device.authorization.grant.enabled': 'false',
      'use.refresh.tokens': 'true',
    },
  };
}

function createLedgerApiUserClient(validatorName: string): KeycloakClient {
  return {
    clientId: getLedgerApiUserClientId(validatorName),
    name: `${validatorName} Ledger API User`,
    enabled: true,
    publicClient: true,
    serviceAccountsEnabled: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: true,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ['canton-audience'],
    attributes: {
      'oauth2.device.authorization.grant.enabled': 'false',
    },
  };
}

function createBackendClient(validatorName: string): KeycloakClient {
  return {
    clientId: `${validatorName}-backend`,
    name: `${validatorName} Backend Service`,
    enabled: true,
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ['canton-audience'],
    secret: `${validatorName}-backend-secret`,
  };
}

function createPqsClient(validatorName: string): KeycloakClient {
  return {
    clientId: `${validatorName}-pqs`,
    name: `${validatorName} PQS`,
    enabled: true,
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ['canton-audience'],
    secret: `${validatorName}-pqs-secret`,
  };
}

function createUser(
  username: string,
  password: string = username,
  email?: string,
): KeycloakUser {
  return {
    username,
    firstName: username,
    lastName: 'User',
    email: email ?? `${username}@${username}.localhost`,
    emailVerified: true,
    enabled: true,
    credentials: [
      {
        type: 'password',
        value: password,
        temporary: false,
      },
    ],
    realmRoles: ['default-roles', 'offline_access'],
  };
}

export function generateValidatorRealm(
   validator: ValidatorConfig,
   validatorIndex: number,
   config: LocalNetConfig,
 ): KeycloakRealm {
   const realmName = getRealmName(validator.name);
 
   const basePort = config.basePort ?? DEFAULT_BASE_PORT;
   const uiPort = getValidatorPorts(validatorIndex, basePort).webUi;

  const clients: KeycloakClient[] = [
    createValidatorClient(validator.name),
    createWalletClient(validator.name, uiPort),
    createLedgerApiUserClient(validator.name),
    createBackendClient(validator.name),
    createPqsClient(validator.name),
  ];

  const participantName = validator.name.replace(/-/g, '_');
  const walletAdminUser = `${participantName}-wallet-admin`;
  const users: KeycloakUser[] = [
    createUser(validator.name),
    createUser(walletAdminUser),
  ];

  if (validator.users) {
    for (const userConfig of validator.users) {
      users.push(createUser(userConfig.id));
    }
  }

  return {
    realm: realmName,
    enabled: true,
    sslRequired: 'none',
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: false,
    editUsernameAllowed: false,
    bruteForceProtected: false,
    defaultSignatureAlgorithm: 'RS256',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    clients,
    clientScopes: [createAudienceClientScope(DEFAULT_AUDIENCE), ...createStandardClientScopes()],
    defaultDefaultClientScopes: ['canton-audience', 'profile', 'email', 'roles', 'web-origins'],
    defaultOptionalClientScopes: ['offline_access'],
    users,
  };
}

export function generateSvRealm(config: LocalNetConfig): KeycloakRealm {
 
   const basePort = config.basePort ?? DEFAULT_BASE_PORT;
   const svWebUiPort = getSvPorts(basePort).webUi;
 
    const clients: KeycloakClient[] = [
      createValidatorClient('sv'),
      {
        clientId: 'sv-web-ui',
        name: 'SV Web UI',
        enabled: true,
        publicClient: true,
        serviceAccountsEnabled: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`http://sv.localhost:${svWebUiPort}/*`],
        webOrigins: ['*'],
        defaultClientScopes: ['canton-audience', 'profile', 'email', 'roles', 'web-origins'],
        optionalClientScopes: ['offline_access'],
        attributes: {
          'oidc.ciba.grant.enabled': 'false',
          'oauth2.device.authorization.grant.enabled': 'false',
          'use.refresh.tokens': 'true',
        },
      },
      {
        clientId: 'sv-wallet',
        name: 'SV Wallet UI',
        enabled: true,
        publicClient: true,
        serviceAccountsEnabled: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`http://wallet.localhost:${svWebUiPort}/*`],
        webOrigins: ['*'],
        defaultClientScopes: ['canton-audience', 'profile', 'email', 'roles', 'web-origins'],
        optionalClientScopes: ['offline_access'],
        attributes: {
          'oidc.ciba.grant.enabled': 'false',
          'oauth2.device.authorization.grant.enabled': 'false',
          'use.refresh.tokens': 'true',
        },
      },
      {
        clientId: 'scan-web-ui',
        name: 'Scan Web UI',
        enabled: true,
        publicClient: true,
        serviceAccountsEnabled: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`http://scan.localhost:${svWebUiPort}/*`],
        webOrigins: ['*'],
        defaultClientScopes: ['canton-audience', 'profile', 'email', 'roles', 'web-origins'],
        optionalClientScopes: ['offline_access'],
        attributes: {
          'oidc.ciba.grant.enabled': 'false',
          'oauth2.device.authorization.grant.enabled': 'false',
          'use.refresh.tokens': 'true',
        },
      },
      createLedgerApiUserClient('sv'),
    ];

  return {
    realm: 'SV',
    enabled: true,
    sslRequired: 'none',
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: false,
    editUsernameAllowed: false,
    bruteForceProtected: false,
    defaultSignatureAlgorithm: 'RS256',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    clients,
    clientScopes: [createAudienceClientScope(DEFAULT_AUDIENCE), ...createStandardClientScopes()],
    defaultDefaultClientScopes: ['canton-audience', 'profile', 'email', 'roles', 'web-origins'],
    defaultOptionalClientScopes: ['offline_access'],
    users: [createUser('sv', 'sv')],
  };
}

/**
 * Generate the master realm with SSL disabled and a persistent admin user.
 *
 * **Why SSL is disabled (`sslRequired: 'none'`):**
 * Cross-network Docker containers need to reach Keycloak's admin REST API over plain HTTP.
 * Keycloak's default `sslRequired: 'external'` exempts only private IPs (localhost, 10.x.x.x,
 * 192.168.x.x, 172.16-31.x.x), but cross-network Docker bridge IPs may not be in that range.
 * Disabling SSL for the master realm allows the bootstrap admin deletion and other admin
 * operations to succeed from the LocalNet orchestration layer.
 *
 * **Why `requiredActions: []` is critical:**
 * Without it, imported users get default required actions (e.g., "Update Password") that block
 * the OAuth password grant with "Account is not fully set up" (keycloak#36108). This user must
 * be able to authenticate immediately via password grant for Keycloak admin operations.
 *
 * **Bootstrap admin vs. user-facing admin:**
 * Keycloak's `KC_BOOTSTRAP_ADMIN_USERNAME` env var creates a separate temporary admin with
 * a sentinel name (`BOOTSTRAP_ADMIN_USERNAME`) that gets deleted by `LocalNet.deleteBootstrapAdmin()`
 * post-startup. The user defined here (with `config.auth.keycloak.admin`/`password`) is the
 * persistent, user-facing admin that survives the bootstrap cleanup.
 */
export function generateMasterRealm(config: LocalNetConfig): KeycloakRealm {
  return {
    realm: 'master',
    enabled: true,
    sslRequired: 'none',
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: false,
    editUsernameAllowed: false,
    bruteForceProtected: false,
    defaultSignatureAlgorithm: 'RS256',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    clients: [],
    clientScopes: [],
    defaultDefaultClientScopes: [],
    users: [
      {
        username: config.auth.keycloak.admin,
        enabled: true,
        emailVerified: true,
        firstName: 'Admin',
        lastName: 'User',
        email: `${config.auth.keycloak.admin}@localhost`,
        credentials: [
          {
            type: 'password',
            value: config.auth.keycloak.password,
            temporary: false,
          },
        ],
        requiredActions: [],
        realmRoles: ['admin', 'default-roles-master', 'create-realm'],
        clientRoles: {
          'master-realm': ['realm-admin'],
          'account': ['manage-account', 'view-profile'],
        },
      },
    ],
  };
}

export function generateAllRealms(config: LocalNetConfig): KeycloakRealm[] {
  const normalizedValidators = normalizeValidators(config.validators);

  const realms: KeycloakRealm[] = [generateMasterRealm(config), generateSvRealm(config)];

  for (let i = 0; i < normalizedValidators.length; i++) {
    realms.push(generateValidatorRealm(normalizedValidators[i], i, config));
  }

  return realms;
}

export function generateRealmJson(realm: KeycloakRealm): string {
  return JSON.stringify(realm, null, 2);
}

export function generateAllRealmsJson(config: LocalNetConfig): Map<string, string> {
  const realms = generateAllRealms(config);
  const result = new Map<string, string>();

  for (const realm of realms) {
    result.set(`${realm.realm}-realm.json`, generateRealmJson(realm));
  }

  return result;
}
