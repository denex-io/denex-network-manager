export interface PartyInfo {
  hint: string;
  partyId: string;
  displayName: string;
  validator: string;
  participantId: string;
}

export interface UserInfo {
  id: string;
  primaryParty: string;
  rights: UserRightInfo[];
  validator: string;
  isDeactivated: boolean;
}

export interface UserRightInfo {
  kind:
    | 'ParticipantAdmin'
    | 'CanActAs'
    | 'CanReadAs'
    | 'CanExecuteAs'
    | 'CanReadAsAnyParty'
    | 'CanExecuteAsAnyParty'
    | 'IdentityProviderAdmin';
  party?: string;
}

export interface PackageInfo {
  packageId: string;
  name: string;
  version: string;
  uploadedTo: string[];
}

export interface ValidatorInfo {
  name: string;
  role: 'sv' | 'validator';
  status: ContainerStatus;
  ports: ValidatorPorts;
  participantId?: string;
}

export interface ValidatorPorts {
  ledgerApi: number;
  adminApi: number;
  jsonApi: number;
  validatorAdminApi: number;
  httpHealth: number;
  grpcHealth: number;
}

export type ContainerStatus = 'starting' | 'healthy' | 'unhealthy' | 'stopped' | 'error';

export type LocalNetStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface LocalNetState {
  status: LocalNetStatus;
  startedAt?: Date;
  sv: ValidatorInfo;
  validators: ValidatorInfo[];
  parties: PartyInfo[];
  packages: PackageInfo[];
  networkName: string;
}

export interface FullEnvironmentInfo {
  network: NetworkEnvironment;
  validators: Record<string, ValidatorEnvironmentInfo>;
  auth: EnvironmentAuthConfig;
  credentials: CredentialEntry[];
  parties: PartyEnvironmentInfo[];
}

export interface NetworkEnvironment {
  domainId: string | null;
  dsoPartyId: string | null;
}

export interface ValidatorEnvironmentInfo {
  name: string;
  role: 'sv' | 'validator';
  participantId: string | null;
  endpoints: ValidatorEndpoints;
  auth: ValidatorAuth;
}

export interface ValidatorEndpoints {
  ledgerApi: string;
  jsonApi: string;
  adminApi: string;
  validatorAdminApi: string;
  webUi: string;
}

export interface ValidatorAuth {
  realm: string;
  keycloakTokenUrl: string;
  clientId: string;
  clientSecret: string;
  userClientId: string;
  audience: string;
}

export interface EnvironmentAuthConfig {
  keycloak: KeycloakEnvironment;
  ledgerApi: LedgerApiAuth;
}

export interface KeycloakEnvironment {
  url: string;
  adminConsoleUrl: string;
  adminUsername: string;
  adminPassword: string;
}

export interface LedgerApiAuth {
  mode: 'keycloak';
  algorithm: string;
  audience: string;
  subjectClaim: string;
}

export interface CredentialEntry {
  realm: string;
  url: string;
  username: string;
  password: string;
  purpose: string;
}

export interface PartyEnvironmentInfo {
  hint: string;
  displayName: string;
  partyId: string | null;
  validator: string;
}
