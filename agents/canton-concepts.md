# Canton Concepts

## Scope

- Covers: Canton/Splice domain concepts that affect code decisions.
- Read when: touching party hints, validator naming, user rights, auth audiences, realm naming, or
  SV-vs-validator behavior.
- Excludes: generated config syntax, Docker container details, and API client implementation.
- Supporting docs: `docs/research/canton-localnet-deep-analysis.md` for historical background.

## What this subsystem is

This project hides the upstream Canton/Splice LocalNet complexity behind one YAML config. The domain
model still matters: Super Validator infrastructure is implicit, regular validators are user-facing,
parties are ledger identities, users are authentication identities, and rights connect users to
parties on participant nodes.

## Main concepts

- Super Validator (SV): always exactly one, created automatically. It runs the global synchronizer,
  SV app, Scan app, and an SV validator app.
- Regular validators: configured through `validators`; each has a participant, validator backend,
  realm, default user, and wallet UI.
- Validator party: operator party created by Splice onboarding. Its hint is derived from validator
  name, not from YAML user party config.
- User parties: application parties from `validators[].parties[]`, `users[].primaryParty`, or
  `users[].parties[]`.
- Audience: OAuth2 tokens use `DEFAULT_AUDIENCE = 'https://canton.network.global'`.

## Working rules

- Treat `validators` in YAML as regular validators only; do not expose SV as a configurable entry.
- Keep Keycloak realm naming consistent between Keycloak generation and Splice JWKS URLs.
- Use `resolveRealmName()` when code may receive `sv`; use `getRealmName()` only when the SV special
  case is impossible.
- Keep validator operator party hints separate from user party hints.

## Critical gotchas

- Canton party hints must match `<organization>-<function>-<enumerator>` after normalization for
  Splice allocation paths.
- `normalizePartyHint()` in `src/generator/splice.ts` is module-private, not public API.
- User-visible party and validator names are schema-constrained to start with a letter and contain
  only letters, numbers, and hyphens.
- Splice node names have a 30-character max. The validator backend name appends
  `-validator_backend`, so long validator names can crash Splice.
- `getRealmName('validator-1')` returns `Validator1`; the SV realm is `SV`, not `Sv`.

## User rights

- Per-party rights: `CanActAs`, `CanReadAs`, `CanExecuteAs`.
- Participant-wide rights: `ParticipantAdmin`, `CanReadAsAnyParty`, `CanExecuteAsAnyParty`,
  `IdentityProviderAdmin`.
- `primaryParty` grants `CanActAs` on that party.
- `users[].parties[].rights` defaults to `['CanActAs']` when omitted.
- Backward compatibility allows per-party rights in `users[].rights`, but prefer `users[].parties[]`
  for party-specific grants.

## Editing guidance

- When changing rights, update config types, Zod schemas, Canton wire helpers, initialization, CLI
  entitlement formatting, and tests together.
- When changing realm naming, inspect both `src/generator/keycloak.ts` and
  `src/generator/splice.ts`.
- When changing party hint behavior, test both config generation and runtime resource
  initialization.

## Canonical implementation surfaces

- `src/types/config.ts`
- `src/schemas/localnet-config.ts`
- `src/generator/splice.ts`
- `src/generator/keycloak.ts`
- `src/localnet.ts`
- `src/api/canton.ts`
