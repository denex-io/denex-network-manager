/**
 * High-level SDK types for the LocalNetBuilder API.
 *
 * These types provide a simplified, fluent interface for constructing LocalNet configurations.
 * They map cleanly to the lower-level types in src/types/config.ts.
 *
 * @module sdk/types
 */

/**
 * Simplified validator definition for the builder API.
 *
 * Represents a single regular Validator node in the LocalNet.
 * The Super Validator (SV) is implicit and always created automatically.
 *
 * @example
 * ```typescript
 * const validator: ValidatorSpec = {
 *   name: 'alice',
 *   parties: ['alice', 'alice-trading'],
 *   users: [
 *     { id: 'alice-user', primaryParty: 'alice' },
 *     { id: 'admin', rights: ['ParticipantAdmin'] },
 *   ],
 * };
 * ```
 */
export interface ValidatorSpec {
  /**
   * Validator name.
   *
   * Used for identification, port allocation, and Keycloak realm naming.
   * Examples: 'alice', 'bob-val', 'validator-1'.
   *
   * Must be unique across all validators in the LocalNet, and at most 12
   * characters (Splice appends "-validator_backend" to form a node name, which
   * has a 30-character limit).
   * Keycloak realm name is derived by title-casing each dash-separated segment.
   * Example: 'alice-val' → realm 'AliceVal'.
   */
  name: string;

  /**
   * Party hints to allocate on this validator.
   *
   * Each string is a party hint that will be allocated during initialization.
   * Hints are normalized to match the pattern `<org>-<function>-<enumerator>`.
   * Example: 'alice' → 'alice-party-0'.
   *
   * Maps to ValidatorConfig.parties[].hint in the lower-level config.
   *
   * @default undefined (no parties allocated)
   */
  parties?: string[];

  /**
   * Users to create on this validator.
   *
   * Each user is created on the validator's Participant node during initialization.
   * Users can have primary parties and multi-party rights.
   *
   * Maps to ValidatorConfig.users in the lower-level config.
   *
   * @default undefined (no users created)
   */
  users?: UserSpec[];
}

/**
 * Simplified user definition for the builder API.
 *
 * Represents a single user to be created on a Participant node.
 * Users can have participant-wide rights and per-party rights.
 *
 * @example
 * ```typescript
 * const user: UserSpec = {
 *   id: 'alice-user',
 *   primaryParty: 'alice',
 *   rights: ['ParticipantAdmin'],
 * };
 * ```
 */
export interface UserSpec {
  /**
   * User ID.
   *
   * Unique identifier for this user within the Participant.
   * Also used as the default password in Keycloak (username = password).
   *
   * Maps to UserConfig.id in the lower-level config.
   */
  id: string;

  /**
   * Primary party hint.
   *
   * The party that this user's primary identity is associated with.
   * The user automatically gets CanActAs rights on this party.
   *
   * If omitted, the user has no primary party (useful for admin-only users).
   *
   * Maps to UserConfig.primaryParty in the lower-level config.
   *
   * @default undefined
   */
  primaryParty?: string;

  /**
   * Participant-wide rights.
   *
   * Rights that don't require a specific party. Valid values:
   * - 'ParticipantAdmin' — Full admin access (list/create users, grant rights)
   * - 'CanReadAsAnyParty' — Read transactions for any party
   * - 'CanExecuteAsAnyParty' — Execute commands as any party
   * - 'IdentityProviderAdmin' — Manage identity providers
   *
   * Maps to UserConfig.rights in the lower-level config.
   *
   * @default undefined (no participant-wide rights)
   */
  rights?: string[];
}

/**
 * Intermediate builder state — internal to LocalNetBuilder.
 *
 * This type represents the accumulated configuration state during builder construction.
 * It is NOT part of the public SDK API; it's used internally by LocalNetBuilder
 * to track configuration before conversion to LocalNetConfig.
 *
 * @internal
 *
 * @example
 * ```typescript
 * const builderConfig: LocalNetBuilderConfig = {
 *   basePort: 5000,
 *   validators: [
 *     { name: 'alice', parties: ['alice'] },
 *     { name: 'bob', parties: ['bob'] },
 *   ],
 *   auth: {
 *     admin: 'admin',
 *     password: 'admin',
 *   },
 * };
 * ```
 */
export interface LocalNetBuilderConfig {
  /**
   * Base port for port allocation.
   *
   * The Super Validator uses ports starting at basePort.
   * Regular validators use basePort + (index * 100).
   * Example: basePort=5000 → SV at 5000-5099, validator-1 at 5100-5199, etc.
   *
   * Maps to LocalNetConfig.basePort in the lower-level config.
   */
  basePort: number;

  /**
   * Validator specifications.
   *
   * Array of ValidatorSpec objects, one per regular Validator.
   * The Super Validator is implicit and always created automatically.
   *
   * Maps to LocalNetConfig.validators in the lower-level config.
   */
  validators: ValidatorSpec[];

  /**
   * Keycloak admin credentials.
   *
   * Used to configure the OAuth2 identity provider.
   * Both username and password are set to the same value.
   *
   * Maps to LocalNetConfig.auth.keycloak in the lower-level config.
   */
  auth: {
    /** Keycloak admin username. */
    admin: string;

    /** Keycloak admin password. */
    password: string;
  };
}
