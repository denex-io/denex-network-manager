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

| Field        | Type                 | Default   | Description                                     |
| ------------ | -------------------- | --------- | ----------------------------------------------- |
| `version`    | string               | `'1.0'`   | Config schema version                           |
| `validators` | number or array      | required  | Validator count (at least 1) or explicit definitions |
| `auth`       | object               | required  | Keycloak bootstrap admin credentials            |
| `basePort`   | number (1024–60000)  | `5000`    | Base of the port block                          |
| `packages`   | array                | —         | DARs uploaded to participants at the end of initialization |
| `discovery`  | object               | —         | **Deprecated.** Does not start a server.        |

`validators: 2` is shorthand for two validators named `validator-1` and `validator-2`. The field is
required in YAML; only the SDK builder defaults to two validators.

There is no cap on the validator count. Instead, the highest port the config derives must be at most
`65535`, so for example 55 validators at `basePort: 60000` are rejected. See
[Port limit](/denex-network-manager/reference/ports/#port-limit).

Unknown keys are ignored with a warning. A typo such as `basport: 7000` loads, prints
`Unrecognized key 'basport' at root (ignored)` on stderr, and the network uses the default
`basePort`. The SDK delivers the same warning to `LocalNetOptions.onWarning`. YAML merge keys
(`<<`) are not supported.

## Validators

| Field      | Type   | Description                                    |
| ---------- | ------ | ---------------------------------------------- |
| `name`     | string | Required. Lowercase, starts with a letter, max **12** characters, letters/numbers/hyphens |
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
initialization runs again. Hints are normalized for Canton when needed, and validator operator party
hints are generated separately from validator names.

## Users and rights

| Field          | Type   | Description                                    |
| -------------- | ------ | ---------------------------------------------- |
| `id`           | string | Required. Lowercase and unique within the validator. Also the default password |
| `primaryParty` | string | Grants `CanActAs` on that party and onboards the user to the wallet |
| `rights`       | array  | Participant-wide rights                        |
| `parties`      | array  | Per-party rights, as `{ hint, rights }`        |

Rights split into two kinds:

- **Participant-wide:** `ParticipantAdmin`, `CanReadAsAnyParty`, `CanExecuteAsAnyParty`,
  `IdentityProviderAdmin`
- **Per-party:** `CanActAs`, `CanReadAs`, `CanExecuteAs`

Entries in `users[].parties` default to `CanActAs` when `rights` is omitted. `CanActAs`,
`CanReadAs`, and `CanExecuteAs` listed in `users[].rights` apply to `primaryParty` and are ignored
when the user has none.

A user is onboarded to the wallet only when it has a `primaryParty`. Without one the user still
exists on the ledger and in Keycloak, but cannot use the wallet.

Party hints resolve against the parties hosted on the user's own validator. A hint that is not
hosted there is allocated on that validator, even if another validator hosts a party with the same
hint. The result is a different party ID, because the namespace belongs to the participant.

:::note
Rights are granted **per participant**. A user holding `CanActAs` on one validator has nothing on
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

These configure the persistent Keycloak master realm admin — **not** validator wallet credentials.
See [Web UIs and credentials](/denex-network-manager/start/web-uis/).

## Packages

```yaml
packages:
  - name: my-app
    dar: ./my-app.dar
    uploadTo: [app, users-val]
```

At the end of initialization, each DAR is uploaded to its `uploadTo` participants. That happens in
`dnm start` and again in `dnm init`, and re-uploading a DAR a participant already has succeeds.

| Field      | Type   | Description                                                                 |
| ---------- | ------ | --------------------------------------------------------------------------- |
| `name`     | string | Required. Identifies the package in messages                                |
| `dar`      | string | Required. Path to the DAR file                                              |
| `uploadTo` | array  | `sv` and/or validator names. Defaults to `sv` and every validator. Must not be empty and may name only `sv` or a configured validator |

A relative `dar` resolves against the directory of the config file, then the current directory.
That holds for a path passed to `dnm start --config` or `LocalNet.fromConfig()`. For an object config
in the SDK, pass `configDir` in the options. Instances started by an earlier version have no stored
config directory, so their relative paths resolve against the current directory.

A missing DAR on a fresh start fails before anything is created. On a resume, or on `dnm init`, a
missing DAR or a failed upload is a warning and the rest of startup continues. `--skip-init` skips
the upload.

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

`${VAR}` requires the variable to be set — loading fails with
`Environment variable not found: VAR` if it is not. `${VAR:default}` falls back to `default` when the
variable is unset. Expansion is textual and applies to the whole file, keys and comments included. The default is
everything after the first colon, so `${VAR:-x}` falls back to `-x`, not `x`.

## Port allocation

See [Port allocation](/denex-network-manager/reference/ports/).
