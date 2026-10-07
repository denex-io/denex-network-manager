---
title: Configuration reference
description: Every field in localnet.yaml — validators, parties, users, rights, auth, packages, basePort, and environment variable interpolation.
---

The Super Validator is always created automatically. You configure only regular validators.

## Where the config comes from

When `--config` is not given, the CLI and `loadConfigFile` look for these names in order:

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
| `validators` | number or array      | `2`       | Validator count (1–10) or explicit definitions   |
| `auth`       | object               | required  | Keycloak bootstrap admin credentials            |
| `basePort`   | number (1024–60000)  | `5000`    | Base of the port block                          |
| `packages`   | array                | —         | DAR packages (validated, not auto-uploaded)     |
| `discovery`  | object               | —         | **Deprecated.** Does not start a server.        |

`validators: 2` is shorthand for two validators named `validator-1` and `validator-2`.

## Validators

| Field      | Type   | Description                                    |
| ---------- | ------ | ---------------------------------------------- |
| `name`     | string | Required. Max **12** characters, letters/numbers/hyphens |
| `parties`  | array  | Parties to allocate on this validator          |
| `users`    | array  | Users to provision on this validator           |

:::caution[The 12-character name limit is not arbitrary]
Splice caps generated node names at 30 characters and the validator backend appends
`-validator_backend` (18 characters), so a name longer than 12 crashes Splice. The schema rejects it
up front rather than letting you discover it at startup.
:::

## Parties

| Field         | Type   | Description                                            |
| ------------- | ------ | ------------------------------------------------------ |
| `hint`        | string | Required. Must start with a letter; letters, numbers, hyphens |
| `displayName` | string | Optional human-readable name                           |
| `validator`   | string | Optional explicit host validator                       |

Party hints referenced by users are auto-allocated even if not listed under the validator's
top-level `parties`. Hints are normalized for Canton when needed, and validator operator party hints
are generated separately from validator names.

## Users and rights

| Field          | Type   | Description                                    |
| -------------- | ------ | ---------------------------------------------- |
| `id`           | string | Required. Also the default password            |
| `primaryParty` | string | Grants `CanActAs` on that party                |
| `rights`       | array  | Participant-wide rights                        |
| `parties`      | array  | Per-party rights, as `{ hint, rights }`        |

Rights split into two kinds:

- **Participant-wide:** `ParticipantAdmin`, `CanReadAsAnyParty`, `CanExecuteAsAnyParty`,
  `IdentityProviderAdmin`
- **Per-party:** `CanActAs`, `CanReadAs`, `CanExecuteAs`

Entries in `users[].parties` default to `CanActAs` when `rights` is omitted.

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

:::caution
`packages` is parsed and validated, but DARs are **not** uploaded automatically at startup. Call
`LocalNet.uploadDar(path)` after the network is running.
:::

## Environment variable interpolation

Config files are expanded before YAML parsing, so any value can come from the environment:

```yaml
version: '1.0'
basePort: ${LOCALNET_BASE_PORT:5000}
auth:
  keycloak:
    admin: ${KEYCLOAK_ADMIN}
    password: ${KEYCLOAK_PASSWORD:admin}
```

`${VAR}` requires the variable to be set — loading fails with
`Environment variable not found: VAR` if it is not. `${VAR:default}` falls back to `default` when the
variable is unset. Expansion is textual and applies to the whole file, keys included.

## Port allocation

See [Port allocation](/denex-network-manager/reference/ports/).
