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

  /** Which validator hosts this party. Defaults to first validator if not specified. */
  validator?: string;
}

/**
 * Configuration for a user to be created on a Participant.
 */
export interface UserConfig {
  /** Unique user ID within the Participant. */
  id: string;

  /** Reference to party hint that this user's primary party will be. Optional — omit for users with only participant-wide rights. */
  primaryParty?: string;

  /** Rights to grant to this user. For participant-wide rights (e.g., ParticipantAdmin), list them here. For per-party rights, prefer using the `parties` field. Kept as UserRight[] for backward compatibility. */
  rights?: UserRight[];

  /** Additional party rights beyond primaryParty. Each entry specifies a party hint and optional rights (defaults to CanActAs). */
  parties?: UserPartyConfig[];

  /** Which validator this user belongs to. Defaults to same validator as primaryParty. */
  validator?: string;
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
   * and contain only letters, digits, and hyphens.
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

  /** Path to the DAR file. */
  dar: string;

  /** Which validators to upload this package to. Defaults to all validators. */
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
 * @deprecated Use 'localnet discovery serve' command instead. This type will be removed in a future version.
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
   * Regular validators to create: a count from 1 to 10 (named `validator-1`, `validator-2`, and
   * so on) or a non-empty list of validator configs. The SV is created in addition.
   */
  validators: number | ValidatorConfig[];

  /** Keycloak admin username and password (`auth.keycloak.admin` and `auth.keycloak.password`). */
  auth: AuthConfig;

  /**
   * DAR packages declared in the config, each with a `name`, a `dar` path, and optional
   * `uploadTo` validator names. Parsed and validated only: `start()` does not upload them.
   */
  packages?: PackageConfig[];

  /**
   * Discovery server configuration. Validated but does not start a discovery server.
   * @deprecated Run `dnm discovery serve` instead. This field is slated for removal.
   */
  discovery?: DiscoveryConfig;

  /**
   * Base port for port allocation, from 1024 to 60000. The SV's ports are offsets from it;
   * validator N (counting from 1) uses offsets from basePort + N × 100.
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
