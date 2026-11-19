---
title: Configuration reference
description: Every field in localnet.yaml — validators, parties, users, rights, auth, packages, basePort, and environment variable interpolation.
---

The Super Validator is always created automatically. You configure only regular validators.

## Where the config comes from

When `--config` is not given, `dnm start` and `loadConfigFromDir` look for these names in the current
directory, in order:

1. `localnet.yaml`
2. `localnet.yml`
3. `.localnet.yaml`
4. `.localnet.yml`

## Minimal config

```yaml
version: '1.0'
validators: 2
auth:
  keycloak:
    admin: admin
    password: admin
```

## Full config

```yaml
version: '1.0'
basePort: 6000

validators:
  - name: app
    parties:
      - hint: app-operator
        displayName: App Operator
    users:
      - id: app-operator
        primaryParty: app-operator
      - id: app-admin
        rights: [ParticipantAdmin]
  - name: users-val
    parties:
      - hint: alice
      - hint: bob
    users:
      - id: alice
        primaryParty: alice
      - id: bob
        primaryParty: bob
        parties:
          - hint: alice
            rights: [CanReadAs]

auth:
  keycloak:
    admin: admin
    password: admin
```

## Top-level fields

| Field           | Type                | Default  | Description                                                |
| --------------- | ------------------- | -------- | ---------------------------------------------------------- |
| `version`       | string              | `'1.0'`  | Config schema version                                      |
| `validators`    | number or array     | required | Validator count (at least 1) or explicit definitions       |
| `auth`          | object              | required | Keycloak master realm admin credentials                    |
| `basePort`      | number (1024–60000) | `5000`   | Base of the port block                                     |
| `spliceVersion` | string              | —        | Splice release tag for Canton, Splice and the web UIs      |
| `packages`      | array               | —        | DARs uploaded to participants at the end of initialization |
| `discovery`     | object              | —        | Deprecated. Does not start a server; use `dnm discovery serve` (CLI) or `MultiInstanceDiscoveryServer` (SDK) |

`validators: 2` is shorthand for two validators named `validator-1` and `validator-2`. The field is
required in YAML, and a file without it fails to load. In the SDK, `LocalNetBuilder` and
`createMinimalConfig()` default to two validators.

There is no cap on the validator count. Instead, the highest port the config derives must be at most
`65535`, so for example 55 validators at `basePort: 60000` are rejected. See
[Port limit](/denex-network-manager/reference/ports/#port-limit).

Unknown keys are ignored with a warning. A typo such as `basport: 7000` loads, prints
`Unrecognized key 'basport' at root (ignored)` on stderr, and the network uses the default
`basePort`. The SDK delivers the same warning to `LocalNetOptions.onWarning`. YAML merge keys are
not supported: a `<<` key counts as an unknown key, so it warns and nothing is merged.

`discovery` is still validated so that older configs keep loading: when present it needs `port`, an
integer from 1 to 65535, and `host`, a non-empty string. After a successful start, `dnm start` warns
that the field is deprecated.

## Validators

| Field      | Type   | Description                                    |
| ---------- | ------ | ---------------------------------------------- |
| `name`     | string | Required. Lowercase, starts with a letter, max 12 characters, letters/numbers/hyphens |
| `parties`  | array  | Parties to allocate on this validator          |
| `users`    | array  | Users to provision on this validator           |

:::caution[The 12-character name limit is not arbitrary]
Splice caps generated node names at 30 characters and the validator backend appends
`-validator_backend` (18 characters), so a name longer than 12 crashes Splice. The schema rejects it
up front rather than letting you discover it at startup.
:::

Names must also be unique and must not be `sv`. Two names that map to the same Keycloak realm, such
as `ab` and `ab-`, are rejected. Names are lowercase because Keycloak lowercases usernames, so a name
such as `App` would never authenticate.

## Parties

| Field         | Type   | Description                                            |
| ------------- | ------ | ------------------------------------------------------ |
| `hint`        | string | Required. Must start with a letter; letters, numbers, hyphens |
| `displayName` | string | Optional human-readable name                           |

Party hints referenced by users are auto-allocated even if not listed under the validator's
top-level `parties`. A party whose hint is already hosted on the validator is skipped when
initialization runs again. Configured hints are passed to Canton unchanged. A party or user that
initialization cannot set up fails `dnm start` (and `dnm init`) with an error naming it, its
validator and the cause. The validator operator party is separate, and its hint is generated from
the validator name and position, for example `localnet-app-1` for the first validator, `app`.

Earlier versions accepted a `validator` key on parties and users. It has been removed: a party or
user always belongs to the validator it is listed under, and a leftover `validator` key produces a
warning and is ignored.

## Users and rights

| Field          | Type   | Description                                    |
| -------------- | ------ | ---------------------------------------------- |
| `id`           | string | Required. Lowercase, non-empty, and unique within the validator; use at least 3 characters (see below). Also the Keycloak password |
| `primaryParty` | string | Grants `CanActAs` on that party and onboards the user to the wallet |
| `rights`       | array  | Participant-wide rights                        |
| `parties`      | array  | Per-party rights, as `{ hint, rights }`        |

Config validation accepts any non-empty, lowercase `id` that is unique within its validator.
Keycloak's default user profile (26.1.0, the Keycloak image LocalNet runs) sets a 3–255 character
rule for usernames, so use at least 3. Users created at runtime with `LocalNet.createUser()` are
checked against it.

Rights split into two kinds:

- Participant-wide: `ParticipantAdmin`, `CanReadAsAnyParty`, `CanExecuteAsAnyParty`,
  `CanActAsAnyParty` (Splice 0.9.x and later; rejected when `spliceVersion` is older),
  `IdentityProviderAdmin`
- Per-party: `CanActAs`, `CanReadAs`, `CanExecuteAs`

Entries in `users[].parties` default to `CanActAs` when `rights` is omitted. `CanActAs`,
`CanReadAs`, and `CanExecuteAs` listed in `users[].rights` apply to `primaryParty` and are ignored
when the user has none.

A user is onboarded to the wallet only when it has a `primaryParty`. Without one the user still
exists on the ledger and in Keycloak but is not onboarded. If it logs in to the wallet UI, the
wallet onboards it with a new party, not one from your config.

Party hints resolve against the parties hosted on the user's own validator. A hint that is not
hosted there is allocated on that validator, even if another validator hosts a party with the same
hint. The result is a different party ID, because the namespace belongs to the participant.

:::note
Rights are granted per participant. A user holding `CanActAs` on one validator has nothing on
another, even for the same party. See
[Visibility is not permission](/denex-network-manager/guides/dev-stack/#visibility-is-not-permission).
:::

## Auth

```yaml
auth:
  keycloak:
    admin: admin
    password: admin
```

`auth.keycloak.admin` and `auth.keycloak.password` are required, non-empty strings. `auth.mode` is
optional, and the only accepted value is `oauth2`.

These configure the persistent Keycloak master realm admin, not validator wallet credentials. See
[Web UIs and credentials](/denex-network-manager/start/web-uis/).

## Packages

```yaml
packages:
  - name: my-app
    dar: ./my-app.dar
    uploadTo: [app, users-val]
```

At the end of initialization, each DAR is uploaded to its `uploadTo` participants. That happens in
`dnm start` when it creates, resumes or repairs the instance, and again in `dnm init`, and re-uploading a DAR a participant already has succeeds.

| Field      | Type   | Description                                                                 |
| ---------- | ------ | --------------------------------------------------------------------------- |
| `name`     | string | Required. Identifies the package in messages                                |
| `dar`      | string | Required. Path to the DAR file                                              |
| `uploadTo` | array  | `sv` and/or validator names. Defaults to `sv` and every validator. Must not be empty and may name only `sv` or a configured validator |

A relative `dar` resolves against the directory of the config file, then the current directory.
That holds for a path passed to `dnm start --config` or `LocalNet.fromConfig()`. For an object config
in the SDK, pass `configDir` in the options. Instances started by an earlier version have no stored
config directory, so `dnm init` and `LocalNet.fromInstanceId()` resolve their relative paths against the current
directory. `dnm start --config` still uses the config file's directory.

A missing DAR on a fresh start fails before anything is created. On a resume, a repair, or on `dnm init`, a
missing DAR or a failed upload is a warning and the rest of startup continues. `--skip-init` skips
the upload.

## Splice version

```yaml
spliceVersion: '0.9.0'
```

By default every LocalNet runs the Splice release bundled with this version of
`denex-network-manager`. `spliceVersion` runs another release instead: the `canton`, `splice-app`,
`wallet-web-ui`, `ans-web-ui`, `sv-web-ui` and `scan-web-ui` images from
`ghcr.io/digital-asset/decentralized-canton-sync/docker` are all pulled at that tag. PostgreSQL,
Keycloak and Nginx are unaffected. The value must be a valid Docker tag.

The tested releases are 0.9.4 (the default) and 0.10.2; another value starts with a warning that
it is untested. The generated Canton and Splice config follows the release: 0.10 and later get the
Splice 0.10 shape.

An instance keeps the release it was created with. A `dnm start` that would create containers next
to existing ones on another release (for example after a `denex-network-manager` upgrade changed
the default) refuses before changing anything; a complete instance resumes as it was created, with
a warning. To switch release, destroy the instance and start it again (its ledger state is lost).
In the SDK, `LocalNetOptions.images` overrides individual images and wins over `spliceVersion`, but
an override that puts canton or splice-app on a release of the other config shape is refused.

## Environment variable interpolation

Config files are expanded before YAML parsing, so any value can come from the environment:

```yaml
version: '1.0'
validators: 2
basePort: ${LOCALNET_BASE_PORT:5000}
auth:
  keycloak:
    admin: ${KEYCLOAK_ADMIN}
    password: ${KEYCLOAK_PASSWORD:admin}
```

`${VAR}` requires the variable to be set. If it is not, loading fails with
`Environment variable not found: VAR`, so this example loads only when `KEYCLOAK_ADMIN` is set.
`${VAR:default}` falls back to `default` when the variable is unset. Expansion is textual and
applies to the whole file, keys and comments included. The default is everything after the first
colon, so `${VAR:-x}` falls back to `-x`, not `x`.

## Port allocation

See [Port allocation](/denex-network-manager/reference/ports/).
