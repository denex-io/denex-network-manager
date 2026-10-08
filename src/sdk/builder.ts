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
   * @param count - Number of validators. The builder produces a list of names, so the 1-to-10
   *   limit on a numeric `validators` value in the config does not apply. A count below 1 leaves
   *   the list empty, so `build()` falls back to 2; a fractional count is rounded down.
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
   * @param names - One or more validator names: at most 12 characters, starting with a letter,
   *   and containing only letters, digits, and hyphens. Checked by {@link LocalNetBuilder.build}.
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
   * @param name - Validator name, with the same rules as {@link LocalNetBuilder.withValidators}.
   *   Give each validator a distinct name; `build()` does not check for duplicates.
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
   * The SV's ports are offsets from the base port; validator N (counting from 1) uses offsets from
   * base port + N × 100. Must be between 1024 and 60000, checked by {@link LocalNetBuilder.build}.
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
   * @throws A Zod validation error if the config fails schema validation, for example a validator
   *   name longer than 12 characters, a base port outside 1024 to 60000, or an unknown user right.
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
