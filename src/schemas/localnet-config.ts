import { z } from 'zod';
import {
  CONFIG_DEFAULTS,
  getRealmName,
  normalizeValidators,
  type ValidatorConfig,
} from '../types/config.ts';
import type { ConfigWarning } from '../types/state.ts';
import { getHighestPort, MAX_PORT } from '../utils/ports.ts';

export const UserRightSchema = z.enum([
  'ParticipantAdmin',
  'CanActAs',
  'CanReadAs',
  'CanExecuteAs',
  'CanReadAsAnyParty',
  'CanExecuteAsAnyParty',
  'IdentityProviderAdmin',
]);

export const ParticipantWideRightSchema = z.enum([
  'ParticipantAdmin',
  'CanReadAsAnyParty',
  'CanExecuteAsAnyParty',
  'IdentityProviderAdmin',
]);
export const PerPartyRightSchema = z.enum(['CanActAs', 'CanReadAs', 'CanExecuteAs']);

/**
 * Builds the config schema tree. `strip` is the tree every parse uses (unknown keys are
 * removed); `strict` is the same tree with unknown keys rejected, used only to *detect*
 * unknown keys so they can be reported as warnings.
 */
function makeSchemas<M extends 'strict' | 'strip'>(mode: M) {
  // Relies on zod v3's `_def` layout to switch `unknownKeys` on an otherwise identical shape.
  const obj = <T extends z.ZodRawShape>(shape: T): z.ZodObject<T, M> =>
    new z.ZodObject<T, M>({ ...z.object(shape)._def, unknownKeys: mode });

  const PartyConfigSchema = obj({
    hint: z.string().min(1).regex(
      /^[a-z][a-z0-9-]*$/i,
      'Party hint must start with a letter and contain only letters, numbers, and hyphens',
    ),
    displayName: z.string().optional(),
  });

  const UserPartyConfigSchema = obj({
    hint: z.string().min(1),
    rights: z.array(PerPartyRightSchema).optional(),
  });

  const UserConfigSchema = obj({
    id: z.string().min(1),
    primaryParty: z.string().min(1).optional(),
    rights: z.array(UserRightSchema).optional(),
    parties: z.array(UserPartyConfigSchema).optional(),
  });

  const ValidatorConfigSchema = obj({
    name: z.string().min(1).max(
      12,
      // Splice node names have a 30-character max. The validator backend appends
      // "-validator_backend" (18 chars), so names longer than 12 crash Splice.
      'Validator name must be at most 12 characters (Splice appends "-validator_backend", which has a 30-character node-name limit)',
    ).regex(
      /^[a-z][a-z0-9-]*$/i,
      'Validator name must start with a letter and contain only letters, numbers, and hyphens',
    ),
    parties: z.array(PartyConfigSchema).optional(),
    users: z.array(UserConfigSchema).optional(),
  }).superRefine((validator, ctx) => {
    // Reject duplicate user ids within a validator. Two entries with the same id
    // have no sensible merge and would produce a duplicate Keycloak realm user.
    // (A config user whose id matches the validator's auto-generated default user
    // is allowed — that intentionally attaches config rights to the default user.)
    if (!validator.users) return;
    const seen = new Set<string>();
    for (let i = 0; i < validator.users.length; i++) {
      const id = validator.users[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate user id '${id}' in validator '${validator.name}'`,
          path: ['users', i, 'id'],
        });
      }
      seen.add(id);
    }
  });

  const PackageConfigSchema = obj({
    name: z.string().min(1),
    dar: z.string().min(1),
    uploadTo: z.array(z.string()).optional(),
  });

  const OAuth2ConfigSchema = obj({
    mode: z.literal('oauth2').optional(),
    keycloak: obj({
      admin: z.string().min(1),
      password: z.string().min(1),
    }),
  });

  const AuthConfigSchema = OAuth2ConfigSchema;

  const DiscoveryConfigSchema = obj({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1),
  });

  const ValidatorsSchema = z.union([
    z.number().int().min(1),
    z.array(ValidatorConfigSchema).min(1),
  ]);

  const LocalNetConfigSchema = obj({
    version: z.string().optional().default(CONFIG_DEFAULTS.version),
    validators: ValidatorsSchema,
    auth: AuthConfigSchema,
    packages: z.array(PackageConfigSchema).optional(),
    // @deprecated — kept for backward compatibility. Use `dnm discovery serve` (CLI) or `MultiInstanceDiscoveryServer` (SDK) instead.
    discovery: DiscoveryConfigSchema.optional(),
    basePort: z.number().int().min(1024).max(60000).default(5000),
  });

  return {
    PartyConfigSchema,
    UserPartyConfigSchema,
    UserConfigSchema,
    ValidatorConfigSchema,
    PackageConfigSchema,
    OAuth2ConfigSchema,
    AuthConfigSchema,
    DiscoveryConfigSchema,
    ValidatorsSchema,
    LocalNetConfigSchema,
  };
}

const stripSchemas = makeSchemas('strip');
const strictSchemas = makeSchemas('strict');

export const {
  PartyConfigSchema,
  UserPartyConfigSchema,
  UserConfigSchema,
  ValidatorConfigSchema,
  PackageConfigSchema,
  OAuth2ConfigSchema,
  AuthConfigSchema,
  DiscoveryConfigSchema,
  ValidatorsSchema,
  LocalNetConfigSchema,
} = stripSchemas;

/**
 * A {@link LocalNetConfig} after schema validation, with defaults filled in: `version` is set
 * (default `'1.0'`) and `basePort` is set (default 5000). Unknown keys are removed. Returned by
 * the config loaders and {@link LocalNetBuilder.build}.
 */
export type ParsedLocalNetConfig = z.infer<typeof LocalNetConfigSchema>;

/** Options for the input parsers. */
export interface ParseConfigOptions {
  /** Receives each warning (unknown keys, ignored fields). Defaults to `console.warn`. */
  onWarning?: (warning: ConfigWarning) => void;
}

function defaultOnWarning(warning: ConfigWarning): void {
  console.warn(warning.message);
}

function pathToString(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const seg of path) {
    out += typeof seg === 'number' ? `[${seg}]` : out ? `.${seg}` : seg;
  }
  return out;
}

function getAt(input: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur = input;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/** Collects `unrecognized_keys` issues, descending into union branches. */
function collectUnrecognized(issues: readonly z.ZodIssue[], out: z.ZodIssue[]): void {
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') out.push(issue);
    else if (issue.code === 'invalid_union') {
      for (const err of issue.unionErrors) collectUnrecognized(err.issues, out);
    }
  }
}

function unknownKeyWarnings(input: unknown): ConfigWarning[] {
  const result = strictSchemas.LocalNetConfigSchema.safeParse(input);
  if (result.success) return [];
  const found: z.ZodIssue[] = [];
  collectUnrecognized(result.error.issues, found);
  const warnings: ConfigWarning[] = [];
  const seen = new Set<string>();
  for (const issue of found) {
    if (issue.code !== 'unrecognized_keys') continue;
    for (const key of issue.keys) {
      const where = pathToString(issue.path);
      const keyPath = where ? `${where}.${key}` : key;
      if (seen.has(keyPath)) continue;
      seen.add(keyPath);
      const last = issue.path[issue.path.length - 1];
      const parent = issue.path[issue.path.length - 2];
      let message = `Unrecognized key '${key}' at ${where || 'root'} (ignored)`;
      if (
        key === 'validator' && typeof last === 'number' && issue.path.length === 4 &&
        issue.path[0] === 'validators' && (parent === 'parties' || parent === 'users')
      ) {
        const owner = getAt(input, issue.path.slice(0, -2));
        const name = owner !== null && typeof owner === 'object'
          ? (owner as { name?: unknown }).name
          : undefined;
        const kind = parent === 'parties' ? 'party' : 'user';
        message = `'validator' at ${where} is no longer supported and is ignored; the ${kind} ` +
          `belongs to the enclosing validator${typeof name === 'string' ? ` '${name}'` : ''}`;
      }
      warnings.push({ source: 'config', path: keyPath, message });
    }
  }
  return warnings;
}

/**
 * Input-only rules that are not part of the schema, so stored labels keep parsing: the
 * port limit for the validator count, lowercase and unique validator names that neither
 * equal the reserved `sv` nor derive a Keycloak realm name already in use, and lowercase user
 * ids (Keycloak lowercases usernames). Also `packages[].uploadTo`: when present it must be
 * non-empty and name only `sv` or configured validators.
 */
function checkConfigInvariants(parsed: ParsedLocalNetConfig): z.ZodIssue[] {
  const issues: z.ZodIssue[] = [];
  const count = typeof parsed.validators === 'number'
    ? parsed.validators
    : parsed.validators.length;
  const highest = getHighestPort(parsed.basePort, count);
  if (highest > MAX_PORT) {
    const most = Math.floor((MAX_PORT - 80 - parsed.basePort) / 100);
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ['validators'],
      message: `${count} validators at basePort ${parsed.basePort} need ports up to ${highest} ` +
        `(> ${MAX_PORT}); use at most ${Math.max(most, 0)} validators or lower basePort`,
    });
  }
  if (typeof parsed.validators !== 'number') {
    const names = new Map<string, number>();
    const realms = new Map<string, string>([['SV', 'sv']]);
    parsed.validators.forEach((v: ValidatorConfig, i: number) => {
      const path = ['validators', i, 'name'];
      const lower = v.name.toLowerCase();
      if (lower === 'sv') {
        issues.push({
          code: z.ZodIssueCode.custom,
          path,
          message: `Validator name '${v.name}' is reserved for the Super Validator`,
        });
        return;
      }
      if (v.name !== lower) {
        // Keycloak lowercases usernames, so the service account it issues tokens
        // for is 'service-account-<lowercase>-validator' while Splice expects the
        // configured spelling; the validator backend then retries on PERMISSION_DENIED forever.
        issues.push({
          code: z.ZodIssueCode.custom,
          path,
          message: `Validator name '${v.name}' must be lowercase (Keycloak lowercases usernames, ` +
            `so the validator's service account would not match); use '${lower}'`,
        });
      }
      const previous = names.get(lower);
      if (previous !== undefined) {
        issues.push({
          code: z.ZodIssueCode.custom,
          path,
          message: `Duplicate validator name '${v.name}' (names are case-insensitive; ` +
            `same as validators[${previous}])`,
        });
        return;
      }
      names.set(lower, i);
      const realm = getRealmName(v.name);
      const clash = realms.get(realm);
      if (clash !== undefined) {
        issues.push({
          code: z.ZodIssueCode.custom,
          path,
          message: `Validator name '${v.name}' maps to Keycloak realm '${realm}', ` +
            `which is already used by '${clash}'`,
        });
        return;
      }
      realms.set(realm, v.name);
    });
    parsed.validators.forEach((v: ValidatorConfig, i: number) => {
      (v.users ?? []).forEach((u, j) => {
        const lower = u.id.toLowerCase();
        if (u.id !== lower) {
          issues.push({
            code: z.ZodIssueCode.custom,
            path: ['validators', i, 'users', j, 'id'],
            message: `User id '${u.id}' must be lowercase (Keycloak lowercases usernames); ` +
              `use '${lower}'`,
          });
        }
      });
    });
  }
  // The numeric form is never expanded into a list: a huge count must not allocate
  // (the port-limit issue above already reports it).
  const listNames = typeof parsed.validators === 'number'
    ? null
    : new Set(['sv', ...parsed.validators.map((v) => v.name)]);
  const isHostName = (target: string): boolean => {
    if (listNames) return listNames.has(target);
    if (target === 'sv') return true;
    const m = /^validator-([1-9]\d*)$/.exec(target);
    return m !== null && Number(m[1]) <= count;
  };
  const expectedHosts = (): string =>
    listNames
      ? [...listNames].join(', ')
      : count <= 20
      ? ['sv', ...normalizeValidators(count).map((v) => v.name)].join(', ')
      : `sv, validator-1 to validator-${count}`;
  (parsed.packages ?? []).forEach((pkg, i) => {
    if (pkg.uploadTo === undefined) return;
    if (pkg.uploadTo.length === 0) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ['packages', i, 'uploadTo'],
        message: `packages[${i}].uploadTo must not be empty; omit it to upload to sv and ` +
          `every validator`,
      });
      return;
    }
    pkg.uploadTo.forEach((target, j) => {
      if (isHostName(target)) return;
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ['packages', i, 'uploadTo', j],
        message: `Unknown upload target '${target}'; expected one of: ` +
          expectedHosts(),
      });
    });
  });
  return issues;
}

type InputResult =
  | { success: true; data: ParsedLocalNetConfig; warnings: ConfigWarning[] }
  | { success: false; errors: z.ZodError; warnings: ConfigWarning[] };

function parseInput(input: unknown): InputResult {
  const warnings = unknownKeyWarnings(input);
  const result = LocalNetConfigSchema.safeParse(input);
  if (!result.success) return { success: false, errors: result.error, warnings };
  const issues = checkConfigInvariants(result.data);
  if (issues.length > 0) return { success: false, errors: new z.ZodError(issues), warnings };
  return { success: true, data: result.data, warnings };
}

/**
 * Parses a config supplied as input (a YAML file, a builder, an object passed to the SDK).
 * Applies the schema defaults and the input-only rules, and returns the unknown-key
 * warnings instead of reporting them. Does not call `console.warn`.
 *
 * @throws {z.ZodError} If the config is invalid. Warnings are lost in that case; use
 * {@link validateLocalNetConfig} to get both.
 */
export function parseLocalNetConfigWithWarnings(
  input: unknown,
): { config: ParsedLocalNetConfig; warnings: ConfigWarning[] } {
  const result = parseInput(input);
  if (!result.success) throw result.errors;
  return { config: result.data, warnings: result.warnings };
}

/**
 * Parses a config supplied as input. Unknown keys are removed and reported through
 * `onWarning` (default `console.warn`), also when the config is then rejected.
 *
 * Besides the schema it enforces the input-only rules: unique validator names
 * (lowercase, not `sv`, no Keycloak realm collisions), lowercase user ids
 * and a highest derived port of at most 65535. Stored labels are parsed with {@link parseStoredLocalNetConfig} instead.
 *
 * @throws {z.ZodError} If the config is invalid.
 */
export function parseLocalNetConfig(
  input: unknown,
  options?: ParseConfigOptions,
): ParsedLocalNetConfig {
  const result = validateLocalNetConfig(input, options);
  if (!result.success) throw result.errors;
  return result.data;
}

/**
 * Like {@link parseLocalNetConfig} but returns the errors instead of throwing.
 * Warnings go to `onWarning` (default `console.warn`) in both outcomes.
 */
export function validateLocalNetConfig(input: unknown, options?: ParseConfigOptions): {
  success: true;
  data: ParsedLocalNetConfig;
} | {
  success: false;
  errors: z.ZodError;
} {
  const result = parseInput(input);
  const onWarning = options?.onWarning ?? defaultOnWarning;
  for (const warning of result.warnings) onWarning(warning);
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: result.errors };
}

/**
 * Parses a config that was stored earlier (an instance's Docker label). Silent: unknown
 * keys are removed without a warning, and the input-only rules of
 * {@link parseLocalNetConfig} are not applied, so instances created by older versions stay
 * discoverable, stoppable and destroyable.
 *
 * @throws {z.ZodError} If the schema rejects the value.
 */
export function parseStoredLocalNetConfig(input: unknown): ParsedLocalNetConfig {
  return LocalNetConfigSchema.parse(input);
}

/**
 * Builds a full config from partial input, applying the defaults and the same checks as
 * {@link parseLocalNetConfig} (including the input-only rules and warnings).
 *
 * @throws {z.ZodError} If the result is invalid.
 */
export function withDefaults(
  config: Partial<ParsedLocalNetConfig>,
  options?: ParseConfigOptions,
): ParsedLocalNetConfig {
  const basePort = config.basePort ?? 5000;
  const defaultAuth = config.auth ?? {
    keycloak: {
      admin: CONFIG_DEFAULTS.auth.keycloak.admin,
      password: CONFIG_DEFAULTS.auth.keycloak.password,
    },
  };

  return parseLocalNetConfig({
    version: CONFIG_DEFAULTS.version,
    validators: config.validators ?? CONFIG_DEFAULTS.validatorCount,
    auth: defaultAuth,
    packages: config.packages,
    discovery: config.discovery,
    basePort,
  }, options);
}
