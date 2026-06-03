import type { AuthConfig, LocalNetConfig, ValidatorConfig } from '../types/config.ts';
import {
  DEFAULT_AUDIENCE,
  getRealmName,
  getServiceAccountUserId,
  getValidatorClientId,
  normalizeValidators,
} from '../types/config.ts';
import { getSvPorts, getValidatorPorts, SV_INTERNAL_PORTS } from '../utils/ports.ts';

/**
 * Generate the auth block for Splice config.
 * Uses RS-256 with JWKS URL pointing to Keycloak.
 */
function generateAuthBlock(
  _authConfig: AuthConfig,
  realm: string,
): string {
  // OAuth2 mode: Use RS-256 with JWKS from Keycloak
  // The JWKS URL must be accessible from within Docker network (keycloak hostname)
  const jwksUrl = `http://keycloak:8080/realms/${realm}/protocol/openid-connect/certs`;
  return `{
  algorithm = "rs-256"
  audience = "${DEFAULT_AUDIENCE}"
  jwks-url = "${jwksUrl}"
}`;
}

/**
 * Ensure a party hint matches Canton's required pattern: <organization>-<function>-<enumerator>
 * If the hint already matches (has at least 2 dashes with alphanumeric segments and integer suffix),
 * return it as-is. Otherwise, transform it to `<hint>-party-0`.
 */
function normalizePartyHint(hint: string): string {
  // Pattern: org-function-enumerator where org and function are alphanumeric (including underscores), enumerator is integer
  const pattern = /^[a-zA-Z0-9_]+-[a-zA-Z0-9_]+-\d+$/;
  if (pattern.test(hint)) {
    return hint;
  }
  // Transform: replace any non-alphanumeric chars (except underscores) with empty, append -party-0
  const sanitized = hint.replace(/[^a-zA-Z0-9_]/g, '');
  return `${sanitized}-party-0`;
}

function generateRealmLedgerApiAuthConfig(
  realm: string,
  clientId: string,
  clientSecret: string,
): string {
  return `{
      type = "client-credentials"
      well-known-config-url = "http://keycloak:8080/realms/${realm}/.well-known/openid-configuration"
      client-id = "${clientId}"
      client-secret = "${clientSecret}"
      audience = "${DEFAULT_AUDIENCE}"
    }`;
}

export function generateSpliceBaseConfig(): string {
  return `_storage {
  type = postgres
  config {
    dataSourceClass = "org.postgresql.ds.PGSimpleDataSource"
    properties = {
      serverName = \${?DB_SERVER}
      portNumber = 5432
      databaseName = validator
      currentSchema = validator
      user = \${?DB_USER}
      password = \${?DB_PASSWORD}
      tcpKeepAlive = true
    }
  }
  parameters {
    max-connections = 32
    migrate-and-start = true
  }
}

_validator_backend {
  latest-packages-only = true
  domain-migration-id = 0
  storage = \${_storage}
  admin-api = {
    address = "0.0.0.0"
    port = 5003
  }
  participant-client = {
    admin-api = {
      address = canton
      port = 5002
    }
    ledger-api.client-config = {
      address = canton
      port = 5001
    }
  }
  scan-client {
    type = "bft"
    seed-urls = []
  }
  app-instances {}
  domains.global.alias = "global"
  contact-point = ""
  canton-identifier-config.participant = participant
}

canton.features.enable-testing-commands = yes
`;
}

export function generateSvSpliceConfig(
  onboardingSecrets: string[],
  authConfig: AuthConfig,
  basePort?: number,
): string {
  const svPorts = getSvPorts(basePort);
  const svClientId = getValidatorClientId('sv');
  const svLedgerApiUser = getServiceAccountUserId(svClientId);
  const svWalletUser = 'sv';

  const expectedOnboardings = onboardingSecrets
    .map((secret) => `      { secret = "${secret}" }`)
    .join(',\n');

  const ledgerApiAuth = generateRealmLedgerApiAuthConfig('SV', svClientId, `${svClientId}-secret`);
  const svAuth = generateAuthBlock(authConfig, 'SV');

  return `_sv_participant_client {
  admin-api {
    address = canton
    port = ${svPorts.adminApi}
  }
  ledger-api {
    client-config {
      address = canton
      port = ${svPorts.ledgerApi}
    }
    auth-config ${ledgerApiAuth}
  }
}

_sv_auth = ${svAuth}

_splice-instance-names {
  network-name = "LocalNet"
  network-favicon-url = "https://www.hyperledger.org/hubfs/hyperledgerfavicon.png"
  amulet-name = "Amulet"
  amulet-name-acronym = "AMT"
  name-service-name = "Amulet Name Service"
  name-service-name-acronym = "ANS"
}

canton {
  validator-apps.sv-validator_backend = \${_validator_backend} {
    canton-identifier-config.participant = sv
    onboarding = null
    scan-client = null
    scan-client = {
      type = "trust-single"
      url = "http://localhost:${SV_INTERNAL_PORTS.scanAdmin}"
    }
    sv-user = "${svLedgerApiUser}"
    sv-validator = true
    storage.config.properties.databaseName = "validator-sv"
    admin-api.port = ${svPorts.validatorAdminApi}
    participant-client = \${_sv_participant_client}
    auth = \${_sv_auth}
    ledger-api-user = "${svLedgerApiUser}"
    validator-wallet-users = ["${svWalletUser}"]
  }

  scan-apps.scan-app {
    is-first-sv = true
    domain-migration-id = 0
    storage = \${_storage} {
      config.properties {
        databaseName = scan
        currentSchema = scan
      }
    }

    admin-api = {
      address = "0.0.0.0"
      port = ${SV_INTERNAL_PORTS.scanAdmin}
    }
    participant-client = \${_sv_participant_client}
    synchronizer-nodes {
      current {
        sequencer = {
          address = canton
          port = ${SV_INTERNAL_PORTS.sequencerAdmin}
        }
        mediator = {
          address = canton
          port = ${SV_INTERNAL_PORTS.mediatorAdmin}
        }
      }
    }
    sv-user = "${svLedgerApiUser}"
    splice-instance-names = \${_splice-instance-names}
  }

  sv-apps.sv {
    latest-packages-only = true
    domain-migration-id = 0
    expected-validator-onboardings = [
${expectedOnboardings}
    ]
    scan {
      public-url = "http://localhost:${SV_INTERNAL_PORTS.scanAdmin}"
      internal-url = "http://localhost:${SV_INTERNAL_PORTS.scanAdmin}"
    }
    local-synchronizer-nodes.current {
      sequencer {
        admin-api {
          address = canton
          port = ${SV_INTERNAL_PORTS.sequencerAdmin}
        }
        internal-api {
          address = canton
          port = ${SV_INTERNAL_PORTS.sequencerPublic}
        }
        external-public-api-url = "http://canton:${SV_INTERNAL_PORTS.sequencerPublic}"
      }
      mediator.admin-api {
        address = canton
        port = ${SV_INTERNAL_PORTS.mediatorAdmin}
      }

      comet-bft-config {
        enabled = false
      }
    }

    storage = \${_storage} {
      config.properties {
        databaseName = sv
        currentSchema = sv
      }
    }

    admin-api = {
      address = "0.0.0.0"
      port = ${SV_INTERNAL_PORTS.svAdmin}
    }
    participant-client = \${_sv_participant_client}

    domains {
      global {
        alias = "global"
      }
    }

    onboarding = {
      type = found-dso
      name = sv
      first-sv-reward-weight-bps = 10000
      is-dev-net = true
    }

    contact-point = ""
    canton-identifier-config = {
      participant = sv
      sequencer = sv
      mediator = sv
    }

    splice-instance-names = \${_splice-instance-names}
    auth = \${_sv_auth}
    ledger-api-user = "${svLedgerApiUser}"
    validator-ledger-api-user = "${svLedgerApiUser}"
  }
}
`;
}

export function generateValidatorSpliceConfig(
  name: string,
  index: number,
  onboardingSecret: string,
  svAddress: string,
  scanAddress: string,
  partyHint: string,
  authConfig: AuthConfig,
  basePort?: number,
): string {
  const ports = getValidatorPorts(index, basePort);
  const participantName = name.replace(/-/g, '_');
  const validatorClientId = getValidatorClientId(name);
  const validatorUser = getServiceAccountUserId(validatorClientId);
  const walletUser = `${participantName}-wallet-admin`;

  const validatorRealmName = getRealmName(name);
  const ledgerApiAuth = generateRealmLedgerApiAuthConfig(
    validatorRealmName,
    validatorClientId,
    `${validatorClientId}-secret`,
  );
  const validatorAuth = generateAuthBlock(authConfig, validatorRealmName);

  return `_${participantName}_participant_client {
  admin-api {
    address = canton
    port = ${ports.adminApi}
  }
  ledger-api {
    client-config {
      address = canton
      port = ${ports.ledgerApi}
    }
    auth-config ${ledgerApiAuth}
  }
}

_${participantName}_auth = ${validatorAuth}

canton.validator-apps.${participantName}-validator_backend = \${_validator_backend} {
  onboarding.secret = "${onboardingSecret}"
  storage.config.properties.databaseName = "validator-${name}"
  admin-api.port = ${ports.validatorAdminApi}
  participant-client = \${_${participantName}_participant_client}
  validator-party-hint = "${partyHint}"
  scan-client.seed-urls.0 = "${scanAddress}"
  onboarding.sv-client.admin-api.url = "${svAddress}"
  auth = \${_${participantName}_auth}
  ledger-api-user = "${validatorUser}"
  validator-wallet-users = ["${walletUser}"]

  # NOTE: target-throughput=0 (the default) disables the auto-topup automation
  # AND bypasses Splice's "reserved traffic" precondition check on every
  # synchronizer-routed Daml command. With target-throughput>0, every on-ledger
  # operation (party allocation, wallet onboarding, transfers) requires the
  # validator to hold >=200_000 bytes of purchased extra traffic — which is
  # impossible on a fresh LocalNet because the validator wallet has 0 amulets
  # to buy traffic with, and there is no upstream auto-tap. For LocalNet/dev
  # we use the unmetered free-tier sequencer traffic; topup is a feature for
  # production deployments where amulets actually have value.
  # See: splice/apps/validator/src/main/scala/.../ValidatorAppConfig.scala
  #      reservedTrafficO returns None when targetThroughput<=0.
  domains.global.buy-extra-traffic {
    min-topup-interval = 1m
    target-throughput = 0
  }
}
`;
}

export function generateFullSpliceConfig(
  configOrValidators: LocalNetConfig | number | ValidatorConfig[],
  authConfig?: AuthConfig,
): string {
  const validators = typeof configOrValidators === 'object' && 'validators' in configOrValidators
    ? configOrValidators.validators
    : configOrValidators;
  const resolvedAuthConfig = typeof configOrValidators === 'object' && 'auth' in configOrValidators
    ? configOrValidators.auth
    : authConfig;
  const basePort = typeof configOrValidators === 'object' && 'validators' in configOrValidators
    ? configOrValidators.basePort
    : undefined;
  if (!resolvedAuthConfig) {
    throw new Error('generateFullSpliceConfig requires auth configuration');
  }

  const normalizedValidators = normalizeValidators(validators);
  const onboardingSecrets = normalizedValidators.map(
    (_, i) => `validator-${i + 1}-onboarding-secret`,
  );

  let config = generateSpliceBaseConfig();
  config += '\n';
  config += generateSvSpliceConfig(onboardingSecrets, resolvedAuthConfig, basePort);

  const svAddress = `http://localhost:${SV_INTERNAL_PORTS.svAdmin}`;
  const scanAddress = `http://localhost:${SV_INTERNAL_PORTS.scanAdmin}`;

  for (let i = 0; i < normalizedValidators.length; i++) {
    const validator = normalizedValidators[i];
    // Derive validator party hint from validator name, NOT from user parties.
    // validator-party-hint is the validator operator's own party identity,
    // conceptually distinct from user-configured application parties.
    const sanitizedName = validator.name.replace(/[^a-zA-Z0-9_]/g, '');
    const rawHint = `localnet-${sanitizedName}-${i + 1}`;
    const partyHint = normalizePartyHint(rawHint);
    config += '\n';
    config += generateValidatorSpliceConfig(
      validator.name,
      i,
      onboardingSecrets[i],
      svAddress,
      scanAddress,
      partyHint,
      resolvedAuthConfig,
      basePort,
    );
  }

  return config;
}
