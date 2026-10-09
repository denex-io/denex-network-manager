import { DEFAULT_BASE_PORT, getKeycloakPort } from '../utils/ports.ts';

/**
 * Configuration types for Canton LocalNet.
 *
 * Key concepts:
 * - Super Validator (SV): IMPLICIT required infrastructure - always exactly 1
 *   - Runs the Global Synchronizer (Sequencer + Mediator)
 *   - Runs SV App (governance), Scan App (monitoring), and Validator App
 * - Regular Validators: CONFIGURABLE - users specify count (1-N)
 *   - Runs Participant + Validator App only
 *   - Connects to the SV's Global Synchronizer
 */

/**
 * Participant-wide rights that don't require a party.
 */
export type ParticipantWideRight =
  | 'ParticipantAdmin'
  | 'CanReadAsAnyParty'
  | 'CanExecuteAsAnyParty'
  | 'IdentityProviderAdmin';

/**
 * Per-party rights that require a specific party.
 */
export type PerPartyRight = 'CanActAs' | 'CanReadAs' | 'CanExecuteAs';

/**
 * Rights that can be granted to a user on a Participant.
 */
export type UserRight = ParticipantWideRight | PerPartyRight;

/**
 * Configuration for additional party rights on a user.
 */
export interface UserPartyConfig {
  /** Party hint reference. Must match a party in the validator's parties list or will be auto-allocated. */
  hint: string;
  /** Rights on this party. Defaults to ['CanActAs'] if omitted. */
  rights?: PerPartyRight[];
}

/**
 * Configuration for a party to be allocated on the ledger.
 */
export interface PartyConfig {
  /** Human-readable hint for the party ID. Will be part of the full party ID. */
  hint: string;

  /** Optional display name for the party. Defaults to hint if not specified. */
  displayName?: string;
}

/**
 * Configuration for a user to be created on a Participant.
 */
export interface UserConfig {
  /**
   * Unique user ID within the Participant. Must be lowercase (Keycloak lowercases usernames);
   * rejected on input otherwise.
   */
  id: string;

  /** Reference to party hint that this user's primary party will be. Optional — omit for users with only participant-wide rights. */
  primaryParty?: string;

  /** Rights to grant to this user. For participant-wide rights (e.g., ParticipantAdmin), list them here. For per-party rights, prefer using the `parties` field. Kept as UserRight[] for backward compatibility. */
  rights?: UserRight[];

  /** Additional party rights beyond primaryParty. Each entry specifies a party hint and optional rights (defaults to CanActAs). */
  parties?: UserPartyConfig[];
}

/**
 * Configuration for a regular validator. The Super Validator is always created and is not
 * configured here.
 */
export interface ValidatorConfig {
  /**
   * Name of this validator. Identifies it in SDK methods and names its Keycloak realm; ports are
   * assigned by its position in the list, not by its name.
   *
   * Must be at most 12 characters: Splice node names have a 30-character limit
   * and the validator backend appends "-validator_backend" (18 chars). Must start with a letter
   * and contain only letters, digits, and hyphens. Must also be lowercase, unique, not `sv`, and
   * not map to the same Keycloak realm as another validator; rejected on input otherwise.
   */
  name: string;

  /**
   * Parties to allocate on this validator's participant during `start()`, each by its `hint`
   * (passed to the ledger as given) and optional `displayName`.
   */
  parties?: PartyConfig[];

  /**
   * Users to create on this validator's participant during `start()`, each with
   * {@link LocalNet.createUser}. User IDs must be unique within the validator.
   */
  users?: UserConfig[];
}

/**
 * Configuration for a DAR package to be uploaded.
 */
export interface PackageConfig {
  /** Name to identify this package. */
  name: string;

  /**
   * Path to the DAR file. A relative path resolves against the config file's directory
   * (`LocalNetOptions.configDir`), then the current directory, when the package is
   * uploaded; the config itself keeps the path as written.
   */
  dar: string;

  /**
   * Which participants to upload this package to: `'sv'` and/or validator names. Defaults
   * to `sv` and every validator (applied at upload time). Must not be empty.
   */
  uploadTo?: string[];
}

/**
 * OAuth2 authentication configuration (Keycloak).
 */
export interface OAuth2Config {
  keycloak: {
    /** Admin username. */
    admin: string;

    /** Admin password. */
    password: string;
  };
}

/**
 * Authentication configuration.
 */
export type AuthConfig = OAuth2Config;

/**
 * Discovery server configuration.
 * @deprecated Use `dnm discovery serve` (CLI) or `MultiInstanceDiscoveryServer` (SDK) instead. This type will be removed in a future version.
 */
export interface DiscoveryConfig {
  /** Port to run the discovery server on. */
  port: number;

  /** Host to bind the discovery server to. */
  host: string;
}

/**
 * Configuration for one LocalNet, as written in YAML or built in code.
 *
 * Exactly one Super Validator (SV) is always created; only the regular validators are
 * configured. Validate a config with {@link LocalNet.fromConfig} or one of the loaders, which
 * return a {@link ParsedLocalNetConfig}.
 *
 * @example Validator count
 * ```typescript
 * const config: LocalNetConfig = {
 *   validators: 2, // validator-1 and validator-2, plus the SV
 *   auth: { keycloak: { admin: 'admin', password: 'admin' } },
 * };
 * ```
 *
 * @example Named validators with parties
 * ```typescript
 * const config: LocalNetConfig = {
 *   validators: [
 *     { name: 'alice', parties: [{ hint: 'alice' }] },
 *     { name: 'bob', parties: [{ hint: 'bob' }] },
 *   ],
 *   auth: { keycloak: { admin: 'admin', password: 'admin' } },
 * };
 * ```
 */
export interface LocalNetConfig {
  /** Config version string. Defaults to `'1.0'`; the SDK does not otherwise read it. */
  version?: string;

  /**
   * Regular Validators to create.
   * Can be a simple count (creates validator-1, validator-2, etc.; at least 1)
   * or a non-empty list of detailed configurations. Names must be lowercase,
   * unique, not `sv`, and must not map to the same Keycloak realm; user ids within a validator
   * must be unique and lowercase.
   * The highest port derived from `basePort` and the validator count must be
   * at most 65535 (see {@link LocalNetConfig.basePort}). These rules apply to
   * input; configs stored in container labels by older versions are not
   * re-checked.
   * The Super Validator is ALWAYS created automatically.
   */
  validators: number | ValidatorConfig[];

  /** Keycloak admin username and password (`auth.keycloak.admin` and `auth.keycloak.password`). */
  auth: AuthConfig;

  /** DAR packages uploaded to their `uploadTo` participants at the end of initialization. */
  packages?: PackageConfig[];

  /**
   * Discovery server configuration.
   * @deprecated Use `dnm discovery serve` (CLI) or `MultiInstanceDiscoveryServer` (SDK) instead. This field will be removed in a future version.
   */
  discovery?: DiscoveryConfig;

  /**
   * Base port for port allocation.
   * SV uses ports starting at basePort, validators use basePort + (index * 100).
   * Between 1024 and 60000; the highest derived port (which grows with the validator
   * count) must also be at most 65535, or the config is rejected.
   * @default 5000
   */
  basePort?: number;
}

export const DEFAULT_AUDIENCE = 'https://canton.network.global';

export const CONFIG_DEFAULTS = {
  version: '1.0',
  validatorCount: 2,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
  /** @deprecated Discovery config defaults — will be removed in a future version. */
  discovery: {
    port: 3100,
    host: '127.0.0.1',
  },
} as const;

/**
 * Derive the Keycloak URL from a LocalNetConfig.
 * The Keycloak URL is always derived from the base port - it's not user-configurable.
 */
export function getKeycloakUrl(config: LocalNetConfig): string {
  return getDefaultKeycloakUrl(config.basePort ?? DEFAULT_BASE_PORT);
}

export function getDefaultKeycloakUrl(basePort: number): string {
  const keycloakPort = getKeycloakPort(basePort ?? DEFAULT_BASE_PORT);
  return `http://localhost:${keycloakPort}`;
}

/**
 * Normalize validators config to always be an array of ValidatorConfig.
 */
export function normalizeValidators(
  validators: number | ValidatorConfig[],
): ValidatorConfig[] {
  if (typeof validators === 'number') {
    return Array.from({ length: validators }, (_, i) => ({
      name: `validator-${i + 1}`,
    }));
  }
  return validators;
}

/**
 * Convert validator name to Keycloak realm name.
 * Example: validator-1 → Validator1, alice-validator → AliceValidator
 */
export function getRealmName(validatorName: string): string {
  return validatorName
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Username of the one wallet-admin user Splice onboards for a validator
 * (`validator-wallet-users`) and that the generated Keycloak realm contains.
 * Hyphens become underscores: `validator-1` → `validator_1-wallet-admin`.
 * Internal: keep it in sync across the Splice, Keycloak, env and credentials generators.
 */
export function getWalletAdminUserId(validatorName: string): string {
  return `${validatorName.replace(/-/g, '_')}-wallet-admin`;
}

/**
 * Resolve realm name with special case for SV.
 * The SV realm is conventionally all-caps 'SV', not title-cased 'Sv'.
 * See generateSvRealm in src/generator/keycloak.ts:467 which hardcodes realm: 'SV'.
 */
export function resolveRealmName(validatorName: string): string {
  return validatorName === 'sv' ? 'SV' : getRealmName(validatorName);
}

export function getValidatorClientId(validatorName: string): string {
  return `${validatorName}-validator`;
}

export function getLedgerApiUserClientId(validatorName: string): string {
  return `${validatorName}-ledger-api-user`;
}

export function getServiceAccountUserId(clientId: string): string {
  return `service-account-${clientId}`;
}
