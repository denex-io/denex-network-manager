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

/**
 * Everything a client needs to connect to an instance, as returned by
 * {@link LocalNet.getEnvironment} and {@link buildConfigEnvironmentInfo}.
 */
export interface FullEnvironmentInfo {
  /**
   * Network-wide identifiers. `domainId` is always `null`; `dsoPartyId` is `null` until filled in
   * from a running instance.
   */
  network: NetworkEnvironment;
  /**
   * Per-node info keyed by `'sv'` and each validator name: role, `participantId` (`null` until
   * filled in from a running instance), endpoint URLs, and the Keycloak realm, token URL,
   * client IDs, client secret, and audience used to get tokens for that node.
   */
  validators: Record<string, ValidatorEnvironmentInfo>;
  /**
   * Keycloak URL and admin credentials, and the ledger API token settings (RS256, audience, and
   * the `sub` subject claim).
   */
  auth: EnvironmentAuthConfig;
  /**
   * Web UI logins, as returned by {@link getCredentials}, including its known-broken
   * per-validator wallet entries.
   */
  credentials: CredentialEntry[];
  /** Each party once, under its hosting validator, read from the running instance; empty when built from config alone or when no participant responds. */
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

/**
 * Host URLs for one node, built from the port allocation. The API URLs use `localhost`; `webUi`
 * uses `sv.localhost` for the SV and `wallet.localhost` for validators, served through Nginx.
 */
export interface ValidatorEndpoints {
  /** Canton Ledger API (gRPC), written as an `http://` URL. */
  ledgerApi: string;
  /** Canton JSON Ledger API. */
  jsonApi: string;
  /** Canton Admin API (gRPC), written as an `http://` URL. */
  adminApi: string;
  /** Splice validator app admin API. */
  validatorAdminApi: string;
  /** Web UI: the SV UI for the SV, the wallet UI for validators. */
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

/** One web UI login, with the same shape as {@link CredentialInfo}. */
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

/**
 * A non-fatal problem reported through `LocalNetOptions.onWarning`.
 *
 * - `config`: a configuration problem.
 * - `query`: a per-validator query (parties, packages, users, rights) failed and its
 *   results are omitted from a partial result.
 * - `packages`: a package upload problem.
 */
export interface LocalNetWarning {
  source: 'config' | 'query' | 'packages';
  message: string;
  /** The validator the warning is about, when it concerns a single one. */
  validator?: string;
  /** The config path the warning is about, when it concerns a config field. */
  path?: string;
}

/** A {@link LocalNetWarning} about the configuration: `source` is `'config'` and `path` is set. */
export interface ConfigWarning extends LocalNetWarning {
  source: 'config';
  path: string;
}
