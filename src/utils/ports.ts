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

export const SV_INTERNAL_PORTS = {
  sequencerPublic: 5008,
  sequencerAdmin: 5009,
  sequencerGrpcHealth: 5062,
  mediatorAdmin: 5007,
  mediatorGrpcHealth: 5063,
  scanAdmin: 5012,
  svAdmin: 5014,
};

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
