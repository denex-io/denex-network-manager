/**
 * Fluent builder API for programmatic LocalNet configuration creation.
 *
 * Provides a type-safe, chainable interface to construct {@link ParsedLocalNetConfig}
 * objects without writing YAML or manually assembling config objects.
 *
 * The builder converts high-level {@link ValidatorSpec} objects into the lower-level
 * {@link ValidatorConfig} format, then delegates to {@link withDefaults} for Zod
 * schema validation and default population.
 *
 * @example Simple usage with validator count
 * ```typescript
 * const config = LocalNetBuilder.create()
 *   .withValidators(3)
 *   .build();
 * ```
 *
 * @example Named validators with parties and users
 * ```typescript
 * const config = LocalNetBuilder.create()
 *   .addValidator('alice', {
 *     parties: ['alice'],
 *     users: [{ id: 'alice-user', primaryParty: 'alice' }],
 *   })
 *   .addValidator('bob', { parties: ['bob'] })
 *   .withBasePort(6000)
 *   .build();
 * ```
 *
 * @module sdk/builder
 */

import type {
  PartyConfig,
  UserConfig,
  UserRight,
  ValidatorConfig,
} from '../types/config.ts';
import type { ParsedLocalNetConfig } from '../schemas/mod.ts';
import { withDefaults } from '../schemas/mod.ts';
import type {
  LocalNetBuilderConfig,
  UserSpec,
  ValidatorSpec,
} from './types.ts';

/**
 * Fluent builder for constructing LocalNet configurations programmatically.
 *
 * Creates a valid {@link ParsedLocalNetConfig} through method chaining.
 * All methods return `this` for fluent chaining. Call {@link build} to
 * produce the final validated config.
 *
 * The Super Validator (SV) is always implicit — only regular validators
 * are configured through the builder.
 *
 * @example
 * ```typescript
 * const config = LocalNetBuilder.create()
 *   .withValidators('alice', 'bob')
 *   .withBasePort(6000)
 *   .withAuth('myadmin', 'secret')
 *   .build();
 * ```
 */
export class LocalNetBuilder {
  private config: LocalNetBuilderConfig;

  private constructor() {
    this.config = {
      basePort: 5000,
      validators: [],
      auth: { admin: 'admin', password: 'admin' },
    };
  }

  /**
   * Create a new builder instance with default settings.
   *
   * Defaults: basePort=5000, no validators, auth=admin/admin.
   * If {@link build} is called without adding validators, defaults to 2.
   *
   * @returns A new {@link LocalNetBuilder} instance.
   */
  static create(): LocalNetBuilder {
    return new LocalNetBuilder();
  }

  /**
   * Set validators by count, creating default names (validator-1, validator-2, etc.).
   *
   * Replaces any previously configured validators.
   *
   * @param count - Number of validators to create (1-10).
   * @returns This builder for chaining.
   *
   * @example
   * ```typescript
   * builder.withValidators(3); // Creates validator-1, validator-2, validator-3
   * ```
   */
  withValidators(count: number): LocalNetBuilder;
  /**
   * Set validators by name.
   *
   * Replaces any previously configured validators. Each name becomes a validator
   * with no parties or users (add those with {@link addValidator} instead).
   *
   * @param names - One or more validator names.
   * @returns This builder for chaining.
   *
   * @example
   * ```typescript
   * builder.withValidators('alice', 'bob', 'charlie');
   * ```
   */
  withValidators(...names: string[]): LocalNetBuilder;
  withValidators(
    countOrName: number | string,
    ...rest: string[]
  ): LocalNetBuilder {
    if (typeof countOrName === 'number') {
      this.config.validators = Array.from(
        { length: countOrName },
        (_, i) => ({
          name: `validator-${i + 1}`,
        }),
      );
    } else {
      this.config.validators = [countOrName, ...rest].map((name) => ({
        name,
      }));
    }
    return this;
  }

  /**
   * Add a single validator with optional parties and users.
   *
   * Appends to the existing validator list (does not replace).
   * Use this for detailed per-validator configuration.
   *
   * @param name - Validator name. Must be unique across all validators.
   * @param options - Optional parties (as hint strings) and users.
   * @returns This builder for chaining.
   *
   * @example
   * ```typescript
   * builder
   *   .addValidator('alice', {
   *     parties: ['alice', 'alice-trading'],
   *     users: [
   *       { id: 'alice-user', primaryParty: 'alice' },
   *       { id: 'admin', rights: ['ParticipantAdmin'] },
   *     ],
   *   })
   *   .addValidator('bob', { parties: ['bob'] });
   * ```
   */
  addValidator(
    name: string,
    options?: { parties?: string[]; users?: UserSpec[] },
  ): LocalNetBuilder {
    this.config.validators.push({
      name,
      parties: options?.parties,
      users: options?.users,
    });
    return this;
  }

  /**
   * Set the base port for port allocation.
   *
   * The SV uses ports starting at basePort. Regular validators use
   * basePort + (index × 100). Must be between 1024 and 60000.
   *
   * @param port - Base port number.
   * @returns This builder for chaining.
   *
   * @example
   * ```typescript
   * builder.withBasePort(6000); // SV at 6000, validator-1 at 6100, etc.
   * ```
   */
  withBasePort(port: number): LocalNetBuilder {
    this.config.basePort = port;
    return this;
  }

  /**
   * Set Keycloak admin credentials.
   *
   * @param admin - Keycloak admin username.
   * @param password - Keycloak admin password.
   * @returns This builder for chaining.
   *
   * @example
   * ```typescript
   * builder.withAuth('myadmin', 'secretpass');
   * ```
   */
  withAuth(admin: string, password: string): LocalNetBuilder {
    this.config.auth = { admin, password };
    return this;
  }

  /**
   * Build the final validated configuration.
   *
   * Converts the accumulated builder state into a {@link ParsedLocalNetConfig}
   * by mapping {@link ValidatorSpec} objects to {@link ValidatorConfig} format,
   * then passing through Zod validation via {@link withDefaults}.
   *
   * If no validators were configured, defaults to 2 validators.
   *
   * @returns A fully validated {@link ParsedLocalNetConfig}.
   * @throws {ZodError} If the resulting config fails schema validation.
   *
   * @example
   * ```typescript
   * const config = LocalNetBuilder.create()
   *   .withValidators(2)
   *   .build();
   * // config is a fully validated ParsedLocalNetConfig
   * ```
   */
  build(): ParsedLocalNetConfig {
    const validators: ValidatorConfig[] | number =
      this.config.validators.length === 0
        ? 2
        : this.config.validators.map((spec) => this.specToConfig(spec));

    return withDefaults({
      validators,
      basePort: this.config.basePort,
      auth: { keycloak: this.config.auth },
    });
  }

  private specToConfig(spec: ValidatorSpec): ValidatorConfig {
    const config: ValidatorConfig = { name: spec.name };
    if (spec.parties) {
      config.parties = spec.parties.map(
        (hint): PartyConfig => ({ hint }),
      );
    }
    if (spec.users) {
      config.users = spec.users.map((u) => this.userSpecToConfig(u));
    }
    return config;
  }

  private userSpecToConfig(spec: UserSpec): UserConfig {
    const config: UserConfig = { id: spec.id };
    if (spec.primaryParty) {
      config.primaryParty = spec.primaryParty;
    }
    if (spec.rights) {
      config.rights = spec.rights as UserRight[];
    }
    return config;
  }
}
