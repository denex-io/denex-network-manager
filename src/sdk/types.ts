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
   * Validator name, such as `'alice'`, `'bob-val'`, or `'validator-1'`.
   *
   * Identifies the validator in SDK methods and names its Keycloak realm, built by title-casing
   * each hyphen-separated segment (`'alice-val'` becomes realm `AliceVal`). Ports are assigned by
   * the validator's position in the list, not by its name.
   *
   * Must be lowercase (Keycloak lowercases usernames, so 'Alice' would never authenticate;
   * `build()` throws a ZodError), unique across all validators in the LocalNet, must not be
   * 'sv', must not map to the same Keycloak realm as another validator, must start with a
   * letter and contain only letters, digits, and hyphens, and be at most 12 characters (Splice
   * appends "-validator_backend" to form a node name, which has a 30-character limit).
   */
  name: string;

  /**
   * Party hints to allocate on this validator during `start()`.
   *
   * Each hint is passed to the ledger as given, so the party ID is `<hint>::<namespace>`. Hints
   * must start with a letter and contain only letters, digits, and hyphens.
   *
   * Maps to `ValidatorConfig.parties[].hint`.
   */
  parties?: string[];

  /**
   * Users to create on this validator during `start()`, each with
   * {@link LocalNet.createUser}.
   *
   * Maps to `ValidatorConfig.users`.
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
   * User ID on the participant, unique within its validator.
   *
   * Also the user's Keycloak username and password.
   *
   * Maps to `UserConfig.id`.
   */
  id: string;

  /**
   * Hint of the user's primary party. The party is allocated if it does not exist, the user gets
   * `CanActAs` on it, and the user is onboarded to the validator's wallet.
   *
   * Omit for users without a primary party, such as admin-only users; they are not onboarded to
   * the wallet.
   *
   * Maps to `UserConfig.primaryParty`.
   */
  primaryParty?: string;

  /**
   * Rights to grant. `'ParticipantAdmin'`, `'CanReadAsAnyParty'`, `'CanExecuteAsAnyParty'`, and
   * `'IdentityProviderAdmin'` apply participant-wide. `'CanActAs'`, `'CanReadAs'`, and
   * `'CanExecuteAs'` apply to the primary party and are ignored without one. Other values fail
   * validation in {@link LocalNetBuilder.build}.
   *
   * Maps to `UserConfig.rights`.
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
   * The Super Validator's ports are offsets from basePort; validator N (counting from 1) uses
   * offsets from basePort + N × 100. Example: basePort=5000 puts the SV in 5000-5099 and
   * validator-1 in 5100-5199.
   *
   * Maps to `LocalNetConfig.basePort`.
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
   * Keycloak admin username and password.
   *
   * Maps to `LocalNetConfig.auth.keycloak`.
   */
  auth: {
    /** Keycloak admin username. */
    admin: string;

    /** Keycloak admin password. */
    password: string;
  };
}
