import type { LocalNetConfig, ValidatorConfig } from '../types/config.ts';
import {
  DEFAULT_AUDIENCE,
  getRealmName,
  getServiceAccountUserId,
  getValidatorClientId,
  normalizeValidators,
} from '../types/config.ts';
import { getSvPorts, getValidatorPorts, SV_INTERNAL_PORTS } from '../utils/ports.ts';

function generateLedgerApiAuthServices(realmName: string): string {
  const jwksUrl = `http://keycloak:8080/realms/${realmName}/protocol/openid-connect/certs`;
  return `[{\n      type = jwt-jwks\n      url = "${jwksUrl}"\n      target-audience = "${DEFAULT_AUDIENCE}"\n    }]`;
}

export interface HoconGeneratorConfig {
  validators: number | ValidatorConfig[];
  dbServer: string;
  dbUser: string;
  dbPassword: string;
}

export function generateCantonBaseConfig(): string {
  return `_storage {
  type = postgres
  config {
    dataSourceClass = "org.postgresql.ds.PGSimpleDataSource"
    properties = {
      serverName = \${?DB_SERVER}
      portNumber = 5432
      databaseName = participant
      currentSchema = participant
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

canton {
  features {
    enable-preview-commands = yes
    enable-testing-commands = yes
  }
  parameters {
    manual-start = no
    non-standard-config = yes
    timeouts.processing.verify-active = 40.seconds
    timeouts.processing.slow-future-warn = 20.seconds
  }
  monitoring.logging.delay-logging-threshold = 40.seconds
}

_participant {
  init {
    generate-topology-transactions-and-keys = false
    identity.type = manual
  }

  storage = \${_storage}

  admin-api {
    address = "0.0.0.0"
    port = 5002
  }

  init.ledger-api.max-deduplication-duration = 30s

  ledger-api {
    max-token-lifetime = Inf
    admin-token-config.admin-claim = true
    address = "0.0.0.0"
    port = 5001
    rate-limit.max-api-services-queue-size = 80000
    interactive-submission-service {
      enable-verbose-hashing = true
    }
  }

  http-ledger-api {
    port = 7575
    address = "0.0.0.0"
  }

  parameters {
    initial-protocol-version = 34
    caching {
      contract-store {
        maximum-size = 1000
        expire-after-access = 120s
      }
    }
    journal-garbage-collection-delay = 24h
  }

  ledger-api {
    index-service {
      max-contract-state-cache-size = 1000
      max-contract-key-state-cache-size = 1000
      max-transactions-in-memory-fan-out-buffer-size = 200
    }
    command-service.max-commands-in-flight = 30
  }

  monitoring {
    grpc-health-server {
      address = "0.0.0.0"
      port = 5061
    }
    http-health-server {
      address = "0.0.0.0"
      port = 7000
    }
  }

  topology.broadcast-batch-size = 1
}
`;
}

export function generateSvCantonConfig(basePort?: number): string {
  const ports = getSvPorts(basePort);
  const adminUser = getServiceAccountUserId(getValidatorClientId('sv'));
  return `canton.participants.sv = \${_participant} {
  storage.config.properties.databaseName = "participant-sv"
  monitoring {
    http-health-server.port = ${ports.httpHealth}
    grpc-health-server.port = ${ports.grpcHealth}
  }
  http-ledger-api.port = ${ports.jsonApi}
  admin-api.port = ${ports.adminApi}
  ledger-api.port = ${ports.ledgerApi}
  ledger-api {
    auth-services = ${generateLedgerApiAuthServices('SV')}
    user-management-service.additional-admin-user-id = "${adminUser}"
  }
}

canton.sequencers.sequencer {
  init {
    generate-topology-transactions-and-keys = false
    identity.type = manual
  }

  storage = \${_storage} {
    config.properties {
      databaseName = "sequencer"
      currentSchema = "sequencer"
    }
  }

  public-api {
    address = "0.0.0.0"
    port = ${SV_INTERNAL_PORTS.sequencerPublic}
  }

  admin-api {
    address = "0.0.0.0"
    port = ${SV_INTERNAL_PORTS.sequencerAdmin}
  }

  monitoring.grpc-health-server {
    address = "0.0.0.0"
    port = 5062
  }

  sequencer {
    config {
      storage = \${_storage} {
        config.properties {
          databaseName = "sequencer"
          currentSchema = "sequencer_driver"
        }
      }
    }
    type = reference
  }
}

canton.mediators.mediator {
  init {
    generate-topology-transactions-and-keys = false
    identity.type = manual
  }

  storage = \${_storage} {
    config.properties {
      databaseName = "mediator"
      currentSchema = "mediator"
    }
  }

  admin-api {
    address = "0.0.0.0"
    port = ${SV_INTERNAL_PORTS.mediatorAdmin}
  }

  monitoring.grpc-health-server {
    address = "0.0.0.0"
    port = ${SV_INTERNAL_PORTS.mediatorGrpcHealth}
  }
}
`;
}

export function generateValidatorCantonConfig(
  name: string,
  index: number,
  basePort?: number,
): string {
  const ports = getValidatorPorts(index, basePort);
  const participantName = name.replace(/-/g, '_');
  const realmName = getRealmName(name);
  const adminUser = getServiceAccountUserId(getValidatorClientId(name));
  return `canton.participants.${participantName} = \${_participant} {
  storage.config.properties.databaseName = "participant-${name}"
  monitoring {
    http-health-server.port = ${ports.httpHealth}
    grpc-health-server.port = ${ports.grpcHealth}
  }
  http-ledger-api.port = ${ports.jsonApi}
  admin-api.port = ${ports.adminApi}
  ledger-api.port = ${ports.ledgerApi}
  ledger-api {
    auth-services = ${generateLedgerApiAuthServices(realmName)}
    user-management-service.additional-admin-user-id = "${adminUser}"
  }
}
`;
}

export function generateFullCantonConfig(
  configOrValidators: LocalNetConfig | number | ValidatorConfig[],
): string {
  const validators = typeof configOrValidators === 'object' && 'validators' in configOrValidators
    ? configOrValidators.validators
    : configOrValidators;
  const basePort = typeof configOrValidators === 'object' && 'validators' in configOrValidators
    ? configOrValidators.basePort
    : undefined;
  const normalizedValidators = normalizeValidators(validators);

  let config = generateCantonBaseConfig();
  config += '\n';
  config += generateSvCantonConfig(basePort);

  for (let i = 0; i < normalizedValidators.length; i++) {
    config += '\n';
    config += generateValidatorCantonConfig(normalizedValidators[i].name, i, basePort);
  }

  return config;
}
