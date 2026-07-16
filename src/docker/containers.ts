import type { ContainerSpec, HealthCheckConfig } from './types.ts';
import type { LocalNetConfig } from '../types/config.ts';
import {
  DEFAULT_AUDIENCE,
  getKeycloakUrl,
  getRealmName,
  normalizeValidators,
} from '../types/config.ts';
import { BOOTSTRAP_ADMIN_USERNAME } from '../generator/keycloak.ts';
import type { PortBinding } from './types.ts';
import {
  DEFAULT_BASE_PORT,
  getKeycloakPort,
  getSvPorts,
  getValidatorPorts,
  SV_INTERNAL_PORTS,
} from '../utils/ports.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function composeServiceLabels(
  serviceName: string,
  composeLabels?: Record<string, string>,
): Record<string, string> {
  if (!composeLabels || Object.keys(composeLabels).length === 0) return {};
  return {
    ...composeLabels,
    'com.docker.compose.service': serviceName,
    'com.docker.compose.container-number': '1',
  };
}

function portServiceLabels(ports: PortBinding[], labelPrefix: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const p of ports) {
    if (p.service && p.host !== undefined) {
      labels[`${labelPrefix}.port.${p.host}.service`] = p.service;
    }
  }
  return labels;
}

/**
 * Get all required environment variables for web UI containers.
 * Includes OAuth2 auth configuration and branding.
 */
function getWebUiEnvironment(
  config: LocalNetConfig,
  realmName: string,
  clientId: string,
): Record<string, string> {
  const env: Record<string, string> = {
    SPLICE_APP_UI_NETWORK_NAME: 'LocalNet',
    SPLICE_APP_UI_NETWORK_FAVICON_URL: 'https://www.canton.network/hubfs/cn-favicon-05%201-1.png',
    SPLICE_APP_UI_AMULET_NAME: 'Canton Coin',
    SPLICE_APP_UI_AMULET_NAME_ACRONYM: 'CC',
    SPLICE_APP_UI_NAME_SERVICE_NAME: 'Canton Name Service',
    SPLICE_APP_UI_NAME_SERVICE_NAME_ACRONYM: 'CNS',
    SPLICE_APP_UI_HTTP_URL: 'true',
    SPLICE_APP_UI_AUTH_AUDIENCE: DEFAULT_AUDIENCE,
  };

  const keycloakUrl = getKeycloakUrl(config);
  env.SPLICE_APP_UI_UNSAFE = 'false';
  env.SPLICE_APP_UI_AUTH_URL = `${keycloakUrl}/realms/${realmName}`;
  env.SPLICE_APP_UI_AUTH_CLIENT_ID = clientId;

  return env;
}

export interface ContainerImages {
  postgres: string;
  nginx: string;
  canton: string;
  splice: string;
  walletWebUi: string;
  ansWebUi: string;
  svWebUi: string;
  scanWebUi: string;
  keycloak: string;
}

export const DEFAULT_SPLICE_VERSION = '0.6.6';
export const DEFAULT_SPLICE_IMAGE_REPO = 'ghcr.io/digital-asset/decentralized-canton-sync/docker';

function spliceImage(name: string): string {
  return `${DEFAULT_SPLICE_IMAGE_REPO}/${name}:${DEFAULT_SPLICE_VERSION}`;
}

export const DEFAULT_IMAGES: ContainerImages = {
  postgres: 'postgres:14',
  nginx: 'nginx:1.27.0',
  canton: spliceImage('canton'),
  splice: spliceImage('splice-app'),
  walletWebUi: spliceImage('wallet-web-ui'),
  ansWebUi: spliceImage('ans-web-ui'),
  svWebUi: spliceImage('sv-web-ui'),
  scanWebUi: spliceImage('scan-web-ui'),
  keycloak: 'quay.io/keycloak/keycloak:26.1.0',
};

export interface ContainerBuilderOptions {
  networkName: string;
  configDir: string;
  dataDir: string;
  labelPrefix: string;
  instanceId?: string;
  images?: Partial<ContainerImages>;
  dbUser?: string;
  dbPassword?: string;
  composeLabels?: Record<string, string>;
}

const DEFAULT_DB_USER = 'cnadmin';
const DEFAULT_DB_PASSWORD = 'supersafe';

export function buildPostgresContainer(
  config: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const normalizedValidators = normalizeValidators(config.validators);
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const initScript = readFileSync(`${options.configDir}/postgres-entrypoint.sh`, 'utf-8');

  const databases = [
    'participant-sv',
    'validator-sv',
    'sequencer',
    'mediator',
    'scan',
    'sv',
    ...normalizedValidators.flatMap((v) => [
      `participant-${v.name}`,
      `validator-${v.name}`,
    ]),
  ];

  return {
    name: 'postgres',
    image: images.postgres,
    hostname: 'postgres',
    entrypoint: [
      'sh',
      '-c',
      `printf "%s" "$POSTGRES_INIT_SCRIPT" > /docker-entrypoint-initdb.d/init.sh && \
chmod +x /docker-entrypoint-initdb.d/init.sh && \
exec /usr/local/bin/docker-entrypoint.sh postgres -c max_connections=1000`,
    ],
    environment: {
      POSTGRES_USER: options.dbUser ?? DEFAULT_DB_USER,
      POSTGRES_PASSWORD: options.dbPassword ?? DEFAULT_DB_PASSWORD,
      POSTGRES_DB: 'postgres',
      POSTGRES_INIT_SCRIPT: initScript,
      ...Object.fromEntries(
        databases.map((db, i) => [`CREATE_DATABASE_${String(i + 1).padStart(2, '0')}`, db]),
      ),
    },
    ports: [{ container: 5432 }],
    volumes: [
      {
        source: `${options.instanceId ?? options.labelPrefix}-postgres-data`,
        target: '/var/lib/postgresql/data',
      },
    ],
    networks: [options.networkName],
    healthCheck: {
      type: 'exec',
      target: `pg_isready -U ${options.dbUser ?? DEFAULT_DB_USER} -d postgres`,
      interval: 10,
      timeout: 3,
      retries: 6,
      startPeriod: 10,
    },
    restart: 'unless-stopped',
    labels: {
      [`${options.labelPrefix}.service`]: 'postgres',
      [`${options.labelPrefix}.role`]: 'database',
      ...composeServiceLabels('postgres', options.composeLabels),
    },
  };
}

export function buildCantonContainer(
  config: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const normalizedValidators = normalizeValidators(config.validators);
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const svPorts = getSvPorts(config.basePort);
  const appConfig = readFileSync(`${options.configDir}/canton/app.conf`, 'utf-8');

  const ports = [
    { container: svPorts.ledgerApi, host: svPorts.ledgerApi, service: 'SV Ledger API' },
    { container: svPorts.adminApi, host: svPorts.adminApi, service: 'SV Admin API' },
    { container: svPorts.jsonApi, host: svPorts.jsonApi, service: 'SV JSON API' },
  ];

  for (let i = 0; i < normalizedValidators.length; i++) {
    const vPorts = getValidatorPorts(i, config.basePort);
    const vName = normalizedValidators[i].name;
    ports.push(
      { container: vPorts.ledgerApi, host: vPorts.ledgerApi, service: `${vName} Ledger API` },
      { container: vPorts.adminApi, host: vPorts.adminApi, service: `${vName} Admin API` },
      { container: vPorts.jsonApi, host: vPorts.jsonApi, service: `${vName} JSON API` },
    );
  }

  return {
    name: 'canton',
    image: images.canton,
    hostname: 'canton',
    environment: {
      DB_SERVER: 'postgres',
      DB_USER: options.dbUser ?? DEFAULT_DB_USER,
      DB_PASSWORD: options.dbPassword ?? DEFAULT_DB_PASSWORD,
      SPLICE_APP_VALIDATOR_AUTH_AUDIENCE: DEFAULT_AUDIENCE,
      ADDITIONAL_CONFIG_LOCALNET: appConfig,
    },
    ports,
    networks: [options.networkName],
    healthCheck: {
      type: 'http',
      target: `http://localhost:${svPorts.httpHealth}/health`,
      interval: 5,
      timeout: 30,
      retries: 10,
      startPeriod: 5,
    },
    dependsOn: ['postgres'],
    restart: 'unless-stopped',
    labels: {
      [`${options.labelPrefix}.service`]: 'canton',
      [`${options.labelPrefix}.role`]: 'participant',
      ...portServiceLabels(ports, options.labelPrefix),
      ...composeServiceLabels('canton', options.composeLabels),
    },
  };
}

export function buildSpliceContainer(
  config: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const normalizedValidators = normalizeValidators(config.validators);
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const svPorts = getSvPorts(config.basePort);
  const appConfig = readFileSync(`${options.configDir}/splice/app.conf`, 'utf-8');

  const ports = [
    {
      container: svPorts.validatorAdminApi,
      host: svPorts.validatorAdminApi,
      service: 'SV Validator Admin',
    },
    {
      container: SV_INTERNAL_PORTS.scanAdmin,
      host: SV_INTERNAL_PORTS.scanAdmin,
      service: 'Scan Admin',
    },
    { container: SV_INTERNAL_PORTS.svAdmin, host: SV_INTERNAL_PORTS.svAdmin, service: 'SV Admin' },
  ];

  for (let i = 0; i < normalizedValidators.length; i++) {
    const vPorts = getValidatorPorts(i, config.basePort);
    const vName = normalizedValidators[i].name;
    ports.push({
      container: vPorts.validatorAdminApi,
      host: vPorts.validatorAdminApi,
      service: `${vName} Validator Admin`,
    });
  }

  return {
    name: 'splice',
    image: images.splice,
    hostname: 'splice',
    environment: {
      DB_SERVER: 'postgres',
      DB_USER: options.dbUser ?? DEFAULT_DB_USER,
      DB_PASSWORD: options.dbPassword ?? DEFAULT_DB_PASSWORD,
      SPLICE_APP_VALIDATOR_AUTH_AUDIENCE: DEFAULT_AUDIENCE,
      SPLICE_APP_VALIDATOR_LEDGER_API_AUTH_AUDIENCE: DEFAULT_AUDIENCE,
      SPLICE_SV_IS_DEVNET: 'true',
      ADDITIONAL_CONFIG_LOCALNET: appConfig,
    },
    ports,
    networks: [options.networkName],
    healthCheck: {
      type: 'http',
      target: `http://localhost:${SV_INTERNAL_PORTS.scanAdmin}/api/scan/status`,
      interval: 5,
      timeout: 40,
      retries: 30,
      startPeriod: 30,
    },
    dependsOn: ['canton'],
    restart: 'unless-stopped',
    labels: {
      [`${options.labelPrefix}.service`]: 'splice',
      [`${options.labelPrefix}.role`]: 'validator',
      ...portServiceLabels(ports, options.labelPrefix),
      ...composeServiceLabels('splice', options.composeLabels),
    },
  };
}

export function buildKeycloakContainer(
  config: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const basePort = config.basePort ?? DEFAULT_BASE_PORT;

  const keycloakEnv: Record<string, string> = {
    // Use a fixed sentinel name for the Keycloak bootstrap admin to avoid colliding
    // with the user-facing admin imported from master-realm.json (keycloak#34286).
    // The user-facing admin (config.auth.keycloak.{admin,password}) is provisioned
    // via realm import; this bootstrap account is deleted post-startup by
    // LocalNet.deleteBootstrapAdmin().
    KC_BOOTSTRAP_ADMIN_USERNAME: BOOTSTRAP_ADMIN_USERNAME,
    KC_BOOTSTRAP_ADMIN_PASSWORD: 'localnet-internal-bootstrap-password-not-used',
    KC_HEALTH_ENABLED: 'true',
    KC_HTTP_ENABLED: 'true',
    KC_HOSTNAME_STRICT: 'false',
  };

  // Pass Keycloak config files as env vars for injection at startup.
  // The filename is preserved verbatim after the LOCALNET_INIT_ prefix (case,
  // dots, and dashes intact) so the entrypoint can recover it exactly by
  // stripping the prefix — no lossy name mangling. Such names aren't valid
  // shell identifiers, but they live in the process environment and are read
  // back via env/printenv, which don't care.
  const keycloakConfigDir = join(options.configDir, 'keycloak');
  const files = readdirSync(keycloakConfigDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  for (const file of jsonFiles) {
    const filePath = join(keycloakConfigDir, file);
    const content = readFileSync(filePath, 'utf-8');
    keycloakEnv[`LOCALNET_INIT_${file}`] = content;
  }

  return {
    name: 'keycloak',
    image: images.keycloak,
    hostname: 'keycloak',
    environment: keycloakEnv,
    entrypoint: [
      'bash',
      '-c',
      `CONFIG_DIR="/opt/keycloak/data/import" && mkdir -p "$CONFIG_DIR" && ` +
      `for var in $(env | grep '^LOCALNET_INIT_' | cut -d= -f1); do ` +
      `filename="${'${var#LOCALNET_INIT_}'}"; ` +
      `printenv "$var" > "$CONFIG_DIR/$filename"; ` +
      `done && ` +
      `exec /opt/keycloak/bin/kc.sh start-dev --import-realm --proxy-headers=forwarded`,
    ],
    ports: [{ container: 8080, host: getKeycloakPort(basePort) }],
    networks: [options.networkName],
    healthCheck: {
      // Use bash /dev/tcp instead of curl (curl not available in Keycloak UBI image)
      // Keycloak 26.x serves health on management port 9000 (separate from HTTP port 8080)
      type: 'exec',
      target:
        'bash -c "exec 3<>/dev/tcp/localhost/9000 && echo -e "GET /health/ready HTTP/1.1\\r\\nHost: localhost:9000\\r\\nConnection: close\\r\\n\\r\\n" >&3 && cat <&3 | grep -q \'200 OK\'"',
      interval: 5,
      timeout: 5,
      retries: 30,
      startPeriod: 20,
    },
    dependsOn: ['postgres'],
    restart: 'unless-stopped',
    labels: {
      [`${options.labelPrefix}.service`]: 'keycloak',
      [`${options.labelPrefix}.role`]: 'auth',
      ...composeServiceLabels('keycloak', options.composeLabels),
    },
  };
}

export function buildNginxContainer(
  localNetConfig: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const normalizedValidators = normalizeValidators(localNetConfig.validators);
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const basePort = localNetConfig.basePort ?? DEFAULT_BASE_PORT;
  const svWebUiPort = getSvPorts(basePort).webUi;
  const configContent = readFileSync(`${options.configDir}/nginx/nginx.conf`, 'utf-8');

  const ports: PortBinding[] = [
    { container: svWebUiPort, host: svWebUiPort, service: 'SV Web UIs (sv/scan/wallet.localhost)' },
  ];

  for (let i = 0; i < normalizedValidators.length; i++) {
    const walletPort = getValidatorPorts(i, basePort).webUi;
    const vName = normalizedValidators[i].name;
    ports.push({ container: walletPort, host: walletPort, service: `${vName} Wallet UI` });
  }

  return {
    name: 'nginx',
    image: images.nginx,
    hostname: 'nginx',
    environment: {
      NGINX_CONFIG: configContent,
    },
    ports,
    command: [
      'sh',
      '-c',
      'printf "%s" "$NGINX_CONFIG" > /etc/nginx/nginx.conf && nginx -g "daemon off;"',
    ],
    networks: [options.networkName],
    healthCheck: {
      type: 'http',
      target: `http://localhost:${svWebUiPort}/`,
      interval: 5,
      timeout: 5,
      retries: 3,
    },
    dependsOn: ['splice'],
    restart: 'always',
    labels: {
      [`${options.labelPrefix}.service`]: 'nginx',
      [`${options.labelPrefix}.role`]: 'proxy',
      ...portServiceLabels(ports, options.labelPrefix),
      ...composeServiceLabels('nginx', options.composeLabels),
    },
  };
}

function buildWebUiContainer(
  name: string,
  image: string,
  options: ContainerBuilderOptions,
  environment: Record<string, string>,
  accessUrl?: string,
): ContainerSpec {
  const labels: Record<string, string> = {
    [`${options.labelPrefix}.service`]: name,
    [`${options.labelPrefix}.role`]: 'web-ui',
    ...composeServiceLabels(name, options.composeLabels),
  };
  if (accessUrl) {
    labels[`${options.labelPrefix}.access-url`] = accessUrl;
  }
  return {
    name,
    image,
    hostname: name,
    environment,
    networks: [options.networkName],
    healthCheck: {
      type: 'http',
      target: 'http://localhost:8080/',
      interval: 5,
      timeout: 5,
      retries: 3,
    },
    dependsOn: ['splice'],
    labels,
  };
}

export function buildWalletWebUiContainers(
  localNetConfig: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec[] {
  const normalizedValidators = normalizeValidators(localNetConfig.validators);
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const basePort = localNetConfig.basePort ?? DEFAULT_BASE_PORT;
  const containers: ContainerSpec[] = [];

  // SV wallet UI
  const svEnv = getWebUiEnvironment(localNetConfig, 'SV', 'sv-wallet');
  const svWalletPort = getSvPorts(basePort).webUi;
  containers.push(
    buildWebUiContainer(
      'wallet-web-ui-sv',
      images.walletWebUi,
      options,
      svEnv,
      `http://wallet.localhost:${svWalletPort}`,
    ),
  );

  // Validator wallet UIs
  for (let i = 0; i < normalizedValidators.length; i++) {
    const validator = normalizedValidators[i];
    const realmName = getRealmName(validator.name);
    const clientId = `${validator.name}-wallet`;
    const walletPort = getValidatorPorts(i, basePort).webUi;
    const env = getWebUiEnvironment(localNetConfig, realmName, clientId);

    containers.push(
      buildWebUiContainer(
        `wallet-web-ui-${validator.name}`,
        images.walletWebUi,
        options,
        env,
        `http://wallet.localhost:${walletPort}`,
      ),
    );
  }

  return containers;
}

export function buildSvWebUiContainer(
  localNetConfig: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const basePort = localNetConfig.basePort ?? DEFAULT_BASE_PORT;
  const env = getWebUiEnvironment(localNetConfig, 'SV', 'sv-web-ui');
  const svWebUiPort = getSvPorts(basePort).webUi;

  return buildWebUiContainer(
    'sv-web-ui',
    images.svWebUi,
    options,
    env,
    `http://sv.localhost:${svWebUiPort}`,
  );
}

export function buildScanWebUiContainer(
  localNetConfig: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec {
  const images = { ...DEFAULT_IMAGES, ...options.images };
  const basePort = localNetConfig.basePort ?? DEFAULT_BASE_PORT;
  const env = getWebUiEnvironment(localNetConfig, 'SV', 'scan-web-ui');
  const svWebUiPort = getSvPorts(basePort).webUi;

  return buildWebUiContainer(
    'scan-web-ui',
    images.scanWebUi,
    options,
    env,
    `http://scan.localhost:${svWebUiPort}`,
  );
}

export function buildAllContainers(
  config: LocalNetConfig,
  options: ContainerBuilderOptions,
): ContainerSpec[] {
  return [
    buildPostgresContainer(config, options),
    buildCantonContainer(config, options),
    buildSpliceContainer(config, options),
    buildNginxContainer(config, options),
    ...buildWalletWebUiContainers(config, options),
    buildSvWebUiContainer(config, options),
    buildScanWebUiContainer(config, options),
    buildKeycloakContainer(config, options),
  ];
}

export function getStartupOrder(containers: ContainerSpec[]): ContainerSpec[][] {
  const layers: ContainerSpec[][] = [];
  const placed = new Set<string>();

  while (placed.size < containers.length) {
    const layer: ContainerSpec[] = [];

    for (const container of containers) {
      if (placed.has(container.name)) continue;

      const deps = container.dependsOn ?? [];
      const allDepsPlaced = deps.every((dep) => placed.has(dep));

      if (allDepsPlaced) {
        layer.push(container);
      }
    }

    if (layer.length === 0 && placed.size < containers.length) {
      throw new Error('Circular dependency detected in container definitions');
    }

    for (const c of layer) {
      placed.add(c.name);
    }

    layers.push(layer);
  }

  return layers;
}

export function getHealthCheckConfig(container: ContainerSpec): HealthCheckConfig | null {
  return container.healthCheck ?? null;
}
