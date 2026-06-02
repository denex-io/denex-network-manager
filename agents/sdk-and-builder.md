# SDK and Builder

## Scope

- Covers: public exports, SDK entry point, full API entry point, `LocalNetBuilder`, and SDK-specific
  types.
- Read when: changing `src/sdk/`, `src/mod.ts`, package exports, or builder behavior.
- Excludes: CLI command behavior and low-level API implementation details.
- Supporting docs: `test/unit/sdk_test.ts` and `test/smoke/node-compat.mjs`.

## What this subsystem is

The package has a full low-level entry point and a curated SDK entry point. The SDK is intended for
normal consumers who want to create/start a LocalNet and query high-level state without importing
every low-level generator or Docker helper.

## Main modules

- `src/mod.ts`: full public export surface for advanced use.
- `src/sdk/mod.ts`: curated SDK surface.
- `src/sdk/builder.ts`: fluent programmatic config builder.
- `src/sdk/types.ts`: simplified builder input types.
- `deno.json`: package export map.

## Working rules

- `.` exports `src/mod.ts` and includes full types, schemas, generators, Docker, API, utilities, and
  `LocalNet`.
- `./sdk` exports `LocalNet`, `createLocalNet`, `LocalNetBuilder`, selected config loaders, and
  helper utilities.
- `./cli` is Deno-only.
- `./types` is type-focused.
- `LocalNetBuilder.build()` converts high-level specs to `ValidatorConfig` and delegates to
  `withDefaults()`.
- If the builder has no validators, it defaults to 2.

## Critical gotchas

- Keep Deno-only CLI imports out of `src/mod.ts` and `src/sdk/mod.ts`.
- Builder `withValidators()` has overloads for count and names; `addValidator()` appends detailed
  validator specs.
- `LocalNetBuilderConfig` is internal builder state, not a public config contract.
- Builder user specs currently cover `id`, `primaryParty`, and `rights`; preserve schema conversion
  explicitly when expanding it.

## Editing guidance

- When changing exports, update `deno.json`, `src/mod.ts`, `src/sdk/mod.ts`, smoke tests, and
  README.
- When changing builder behavior, update SDK unit tests and at least one consumer-style example.
- Run the Node compatibility smoke test after changes that affect cross-runtime entry points.

## Canonical implementation surfaces

- `src/mod.ts`
- `src/sdk/mod.ts`
- `src/sdk/builder.ts`
- `src/sdk/types.ts`
- `deno.json`
- `test/unit/sdk_test.ts`
- `test/smoke/node-compat.mjs`
