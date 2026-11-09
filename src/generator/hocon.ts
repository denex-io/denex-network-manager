import type { LocalNetConfig, ValidatorConfig } from '../types/config.ts';
import {
  DEFAULT_AUDIENCE,
  getRealmName,
  getServiceAccountUserId,
  getValidatorClientId,
  normalizeValidators,
} from '../types/config.ts';
import { getSvInternalPorts, getSvPorts, getValidatorPorts } from '../utils/ports.ts';

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
  # A participant opens 1.5 x max-connections + 23 Postgres connections (node pools, Ledger API
  # pool, indexer), the sequencer 2 x max-connections. 8 is what Splice's own integration tests
  # use; 32 made 475 connections for SV + 2 validators and cost about 0.5 GB of Postgres memory.
  parameters {
    max-connections = 8
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
    # The containers log at INFO. Daml debug statements log at DEBUG by default, so raise them
    # to INFO to keep them visible.
    engine.submission-phase-logging.log-level = INFO
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
  const internal = getSvInternalPorts(basePort);
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
    # Splice's LocalNet limit, meant for the SV participant. Validator participants keep Canton's
    # default (256) so parallel test suites are not rejected past 30 in-flight commands.
    command-service.max-commands-in-flight = 30
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
    port = ${internal.sequencerPublic}
  }

  admin-api {
    address = "0.0.0.0"
    port = ${internal.sequencerAdmin}
  }

  monitoring.grpc-health-server {
    address = "0.0.0.0"
    port = ${internal.sequencerGrpcHealth}
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
    port = ${internal.mediatorAdmin}
  }

  monitoring.grpc-health-server {
    address = "0.0.0.0"
    port = ${internal.mediatorGrpcHealth}
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

  // The canton image also loads monitoring.conf, which binds a Prometheus reporter on a fixed
  // in-container port (10013) that can collide with a derived port. Nothing reads LocalNet
  // metrics, so replace the array with an empty one (HOCON replaces arrays): no reporter, no
  // port, and about 35 MB less native memory. basePort + 64 stays reserved for one.
  config += `
canton.monitoring.metrics.reporters = []
`;

  return config;
}
