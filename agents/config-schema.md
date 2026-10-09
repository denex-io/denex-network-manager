# Config Schema

## Scope

- Covers: config types, Zod validation, defaults, YAML loading, and env expansion.
- Read when: adding config fields, changing validation constraints, changing defaults, or debugging
  config load failures.
- Excludes: generated HOCON/Splice/Keycloak/Nginx output.
- Supporting docs: `README.md` configuration section.

## What this subsystem is

The config layer turns YAML or config objects into a validated `LocalNetConfig`. It accepts a small
user-facing schema, fills defaults, and feeds the generator and lifecycle layers.

## Main modules

- `src/types/config.ts`: TypeScript config types and naming helpers.
- `src/schemas/localnet-config.ts`: Zod schemas (built by `makeSchemas('strip' | 'strict')`),
  `parseLocalNetConfig()`, `validateLocalNetConfig()`, `parseLocalNetConfigWithWarnings()`,
  `parseStoredLocalNetConfig()`, and `withDefaults()`.
- `src/utils/yaml.ts`: file/string/dir loading and environment variable expansion.
- `src/sdk/builder.ts`: programmatic config builder that delegates to `withDefaults()`.

## Working rules

- `version` is optional and defaults to `1.0`.
- `validators` can be a count or a detailed array; counts normalize to `validator-1`, `validator-2`,
  and so on.
- There is no cap on the validator count; the input rule is that the highest derived port
  (`getHighestPort(basePort, n)`) is at most `MAX_PORT` (65535).
- `parties[].validator` and `users[].validator` no longer exist; on input they warn and are dropped.
- `basePort` defaults to `5000` and must be between `1024` and `60000`.
- OAuth2 with Keycloak is the only auth mode; config stores `auth.keycloak.admin` and
  `auth.keycloak.password`.
- `discovery` is deprecated; kept only for backward compatibility. The field is accepted and
  preserved if provided, but `withDefaults()` no longer injects a default value — `discovery` is
  `undefined` in configs that don't include it explicitly.
- `auth.mode: 'oauth2'` is accepted by the schema as an optional literal field and round-trips
  correctly. Previously it was silently stripped by Zod. OAuth2 with Keycloak remains the only
  supported auth mode.

## Input rules versus stored-label rules

- Input (YAML, objects given to `fromConfig()`/the `LocalNet` constructor, builder output) goes
  through `parseLocalNetConfig()`, `validateLocalNetConfig()` or `withDefaults()`: strip parse plus
  unknown-key warnings plus `checkConfigInvariants()` (port limit, lowercase and unique names,
  lowercase user ids, reserved `sv`, Keycloak realm collisions via `getRealmName`). These invariants
  are not in the exported Zod schema, so the schema type is unchanged.
- Stored labels (`fromInstanceId()`, `discover()`, `reconstructConfigFromLabels()`,
  `detectConfigMismatch()` on both sides) use `parseStoredLocalNetConfig()`: strip parse only, no
  warnings, no invariants. Instances created by older versions (11+ validators, case-variant names,
  `validator` keys) must stay discoverable, stoppable and destroyable.
- Unknown keys are detected by re-parsing with the strict twin of the schema tree and collecting
  `unrecognized_keys` issues (also inside union branches). They are warnings (`ConfigWarning`,
  `source: 'config'`, `path`), never errors: validator config options churn across versions.
- Warnings go to `options.onWarning` (default `console.warn`). The `LocalNet` constructor,
  `fromConfig()` and the CLI loaders (`loadConfigFile(path, { onWarning })`) pass it through.
  `LocalNet.warnings` keeps the construction-time config warnings only; runtime query warnings are
  never stored. `fromConfig()`/`fromInstanceId()` register their parsed config in a module-private
  `trustedConfigs` WeakMap so the constructor does not re-parse it.
- `dnm config` validates the generated config in `writeConfig()` before writing (no file, no `.bak`
  on failure).

## Critical gotchas

- YAML merge keys (`<<`) and `x-*` anchor keys are not exempt from unknown-key detection; they warn
  as "Unrecognized key" (decision D8).
- `packages:` is parsed and validated, but startup does not currently auto-upload those DARs. Use
  `LocalNet.uploadDar()` for runtime uploads.
- `withDefaults()` does **not** inject a default `discovery` value. If `config.discovery` is absent,
  the output has `discovery: undefined`. Old code that relied on `withDefaults()` always producing a
  `discovery` object will see `undefined` now.
- `PartyConfig.hint` and `ValidatorConfig.name` must match `/^[a-z][a-z0-9-]*$/i`; on input a
  validator name must also be lowercase (`checkConfigInvariants`), and user ids must be lowercase
  too (`validators[i].users[j].id`). Stored labels stay lenient for both.
- `UserConfig.rights` accepts all rights for backward compatibility, but per-party rights should be
  modeled with `UserConfig.parties`.

## Editing guidance

- When adding a field, update TypeScript types, Zod schema, defaults if needed, README examples, SDK
  builder if applicable, and tests.
- If a field is accepted but not acted on, document that explicitly.
- Keep config validation practical; deeper runtime validation belongs in lifecycle or generator
  code.
- Preserve env expansion behavior in YAML loaders when changing parsing.

## Canonical implementation surfaces

- `src/types/config.ts`
- `src/schemas/localnet-config.ts`
- `src/utils/yaml.ts`
- `test/unit/config_test.ts`
