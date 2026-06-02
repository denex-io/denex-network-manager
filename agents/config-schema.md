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
- `src/schemas/localnet-config.ts`: Zod schemas, `parseLocalNetConfig()`,
  `validateLocalNetConfig()`, and `withDefaults()`.
- `src/utils/yaml.ts`: file/string/dir loading and environment variable expansion.
- `src/sdk/builder.ts`: programmatic config builder that delegates to `withDefaults()`.

## Working rules

- `version` is optional and defaults to `1.0`.
- `validators` can be a count or a detailed array; counts normalize to `validator-1`, `validator-2`,
  and so on.
- Validator count is schema-capped at 10.
- `basePort` defaults to `5000` and must be between `1024` and `60000`.
- OAuth2 with Keycloak is the only auth mode; config stores `auth.keycloak.admin` and
  `auth.keycloak.password`.
- `discovery` is deprecated and kept only for backward compatibility.

## Critical gotchas

- `packages:` is parsed and validated, but startup does not currently auto-upload those DARs. Use
  `LocalNet.uploadDar()` for runtime uploads.
- `withDefaults()` currently includes default `discovery` config for backward compatibility.
- `PartyConfig.hint` and `ValidatorConfig.name` must match `/^[a-z][a-z0-9-]*$/i`.
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
