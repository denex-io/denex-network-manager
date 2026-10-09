/**
 * Fluent builder API for programmatic LocalNet configuration creation.
 *
 * Provides a type-safe, chainable interface to construct {@link ParsedLocalNetConfig}
 * objects without writing YAML or manually assembling config objects.
 *
 * The builder converts high-level {@link ValidatorSpec} objects into the lower-level
 * {@link ValidatorConfig} format, then runs schema validation and fills in schema defaults.
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

import type { PartyConfig, UserConfig, UserRight, ValidatorConfig } from '../types/config.ts';
import type { ParsedLocalNetConfig } from '../schemas/mod.ts';
import { withDefaults } from '../schemas/mod.ts';
import type { LocalNetBuilderConfig, UserSpec, ValidatorSpec } from './types.ts';

/**
 * Fluent builder for constructing LocalNet configurations programmatically.
 *
 * Create one with {@link LocalNetBuilder.create}; the constructor is private. Every setter
 * returns the builder for chaining. {@link LocalNetBuilder.build} returns a validated config,
 * not a running network: pass it to {@link LocalNet.fromConfig}.
 *
 * The Super Validator (SV) is always created; only regular validators are configured here.
 * Runtime settings such as the instance ID are {@link LocalNetOptions}, not builder methods.
 *
 * @example
 * ```typescript
 * import { LocalNet, LocalNetBuilder } from '@denex/network-manager/sdk';
 *
 * const config = LocalNetBuilder.create()
 *   .withValidators('alice', 'bob')
 *   .withBasePort(6000)
 *   .withAuth('myadmin', 'secret')
 *   .build();
 * const net = await LocalNet.fromConfig(config, { instanceId: 'demo' });
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
   * Create a new builder.
   *
   * Defaults: base port 5000 and Keycloak admin `admin`/`admin`. If no validators are added,
   * {@link LocalNetBuilder.build} creates 2 (`validator-1` and `validator-2`).
   */
  static create(): LocalNetBuilder {
    return new LocalNetBuilder();
  }

  /**
   * Set validators by count, named `validator-1`, `validator-2`, and so on.
   *
   * Replaces any previously configured validators.
   *
   * @param count - Number of validators to create: an integer of at least 1. There is no
   * upper cap here; {@link build} rejects a count whose derived ports exceed 65535 for the
   * chosen base port.
   * @returns This builder for chaining.
   * @throws {RangeError} If `count` is not an integer or is less than 1.
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
   * with no parties or users (add those with {@link LocalNetBuilder.addValidator} instead).
   *
   * @param names - One or more validator names: lowercase, at most 12 characters, starting with a
   *   letter, containing only letters, digits, and hyphens, unique, and not `sv`. Checked by
   *   {@link LocalNetBuilder.build}.
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
      if (!Number.isInteger(countOrName) || countOrName < 1) {
        throw new RangeError(
          `withValidators(count) needs an integer of at least 1, got ${countOrName}`,
        );
      }
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
   * @param name - Validator name, with the same rules as {@link LocalNetBuilder.withValidators}.
   *   Names must be unique; {@link LocalNetBuilder.build} rejects duplicates.
   * @param options - Party hints to allocate and users to create on this validator during
   *   `start()`.
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
   * Set the base port for port allocation. Defaults to 5000.
   *
   * The SV uses ports starting at basePort. Regular validators use
   * basePort + (index × 100). Must be between 1024 and 60000, and low enough that
   * the highest derived port (which grows with the validator count) stays at or below
   * 65535; {@link build} rejects the combination otherwise.
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
   * Set the Keycloak admin username and password (`auth.keycloak.admin` and
   * `auth.keycloak.password`). Defaults to `admin`/`admin`.
   */
  withAuth(admin: string, password: string): LocalNetBuilder {
    this.config.auth = { admin, password };
    return this;
  }

  /**
   * Build the validated config.
   *
   * Maps each {@link ValidatorSpec} to a {@link ValidatorConfig}, validates the result against
   * the config schema, and fills in schema defaults. If no validators were configured, the config
   * has 2. The result is a config only; pass it to {@link LocalNet.fromConfig} to get a
   * {@link LocalNet}.
   *
   * If no validators were configured, defaults to 2 validators.
   *
   * @returns A fully validated {@link ParsedLocalNetConfig}.
   * @throws {ZodError} If the resulting config fails validation: a schema error, a validator name that is
   * not lowercase, duplicate or reserved (`sv`), two names that map to the same
   * Keycloak realm, or a highest derived port above 65535 for the base port and validator
   * count.
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
    const validators: ValidatorConfig[] | number = this.config.validators.length === 0
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
