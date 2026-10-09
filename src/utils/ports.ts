export const DEFAULT_BASE_PORT = 5000;

export const PORT_SUFFIXES = {
  ledgerApi: 1,
  adminApi: 2,
  validatorAdminApi: 3,
  jsonApi: 75,
  httpHealth: 0,
  grpcHealth: 61,
  webUi: 80,
  keycloak: 82,
} as const;

/**
 * Offsets from basePort for the SV-only ports. All are below 100 and distinct from
 * every {@link PORT_SUFFIXES} value (0,1,2,3,61,75,80,82), so no SV-level port can equal
 * a validator port (basePort + 100 * (i + 1) + suffix).
 *
 * The sequencer and mediator ports and the canton Prometheus reporter are bound inside the canton
 * container. The Scan and SV admin ports and the splice Prometheus reporter are bound inside the
 * splice container. Only Scan and SV admin are published to the host, on the same number as the
 * container port.
 */
export const SV_INTERNAL_PORT_OFFSETS = {
  mediatorAdmin: 7,
  sequencerPublic: 8,
  sequencerAdmin: 9,
  scanAdmin: 12,
  splicePrometheus: 13,
  svAdmin: 14,
  sequencerGrpcHealth: 62,
  mediatorGrpcHealth: 63,
  cantonPrometheus: 64,
} as const;

/** The highest port number a host can use. */
export const MAX_PORT = 65535;

/** Resolved SV-only internal port numbers, keyed like {@link SV_INTERNAL_PORT_OFFSETS}. */
export type SvInternalPorts = { [K in keyof typeof SV_INTERNAL_PORT_OFFSETS]: number };

/**
 * Returns the SV-only ports for a given basePort: sequencer (public, admin, gRPC health),
 * mediator (admin, gRPC health), Scan admin, SV admin and the splice and canton Prometheus
 * reporters.
 *
 * Every consumer (the HOCON/app.conf bind, the Docker port mapping, the healthcheck, nginx
 * `proxy_pass` and in-process URLs) must take its value from here, so the bind and the
 * clients always agree and no derived port can collide with an internal one. Only Scan and
 * SV admin are published to the host, and the container port equals the host port.
 */
export function getSvInternalPorts(basePort: number = DEFAULT_BASE_PORT): SvInternalPorts {
  return {
    mediatorAdmin: basePort + SV_INTERNAL_PORT_OFFSETS.mediatorAdmin,
    sequencerPublic: basePort + SV_INTERNAL_PORT_OFFSETS.sequencerPublic,
    sequencerAdmin: basePort + SV_INTERNAL_PORT_OFFSETS.sequencerAdmin,
    scanAdmin: basePort + SV_INTERNAL_PORT_OFFSETS.scanAdmin,
    splicePrometheus: basePort + SV_INTERNAL_PORT_OFFSETS.splicePrometheus,
    svAdmin: basePort + SV_INTERNAL_PORT_OFFSETS.svAdmin,
    sequencerGrpcHealth: basePort + SV_INTERNAL_PORT_OFFSETS.sequencerGrpcHealth,
    mediatorGrpcHealth: basePort + SV_INTERNAL_PORT_OFFSETS.mediatorGrpcHealth,
    cantonPrometheus: basePort + SV_INTERNAL_PORT_OFFSETS.cantonPrometheus,
  };
}

export function getSvPort(
  basePort: number,
  portType: keyof typeof PORT_SUFFIXES,
): number {
  return basePort + PORT_SUFFIXES[portType];
}

export function getValidatorPort(
  basePort: number,
  validatorIndex: number,
  portType: keyof typeof PORT_SUFFIXES,
): number {
  return basePort + ((validatorIndex + 1) * 100) + PORT_SUFFIXES[portType];
}

export interface ValidatorPorts {
  ledgerApi: number;
  adminApi: number;
  validatorAdminApi: number;
  jsonApi: number;
  httpHealth: number;
  grpcHealth: number;
  webUi: number;
}

export function getSvPorts(basePort: number = DEFAULT_BASE_PORT): ValidatorPorts {
  return {
    ledgerApi: basePort + PORT_SUFFIXES.ledgerApi,
    adminApi: basePort + PORT_SUFFIXES.adminApi,
    validatorAdminApi: basePort + PORT_SUFFIXES.validatorAdminApi,
    jsonApi: basePort + PORT_SUFFIXES.jsonApi,
    httpHealth: basePort + PORT_SUFFIXES.httpHealth,
    grpcHealth: basePort + PORT_SUFFIXES.grpcHealth,
    webUi: basePort + PORT_SUFFIXES.webUi,
  };
}

export function getValidatorPorts(
  validatorIndex: number,
  basePort: number = DEFAULT_BASE_PORT,
): ValidatorPorts {
  const offset = basePort + ((validatorIndex + 1) * 100);
  return {
    ledgerApi: offset + PORT_SUFFIXES.ledgerApi,
    adminApi: offset + PORT_SUFFIXES.adminApi,
    validatorAdminApi: offset + PORT_SUFFIXES.validatorAdminApi,
    jsonApi: offset + PORT_SUFFIXES.jsonApi,
    httpHealth: offset + PORT_SUFFIXES.httpHealth,
    grpcHealth: offset + PORT_SUFFIXES.grpcHealth,
    webUi: offset + PORT_SUFFIXES.webUi,
  };
}

export function getKeycloakPort(basePort: number = DEFAULT_BASE_PORT): number {
  return basePort + PORT_SUFFIXES.keycloak;
}

/**
 * The highest port a LocalNet with this basePort and validator count uses. Callers compare
 * it against {@link MAX_PORT}. Never builds a validators array.
 */
export function getHighestPort(basePort: number, validatorCount: number): number {
  const candidates = [
    ...Object.values(getSvPorts(basePort)),
    ...Object.values(getSvInternalPorts(basePort)),
    getKeycloakPort(basePort),
  ];
  if (validatorCount >= 1) {
    candidates.push(...Object.values(getValidatorPorts(validatorCount - 1, basePort)));
  }
  return Math.max(...candidates);
}
