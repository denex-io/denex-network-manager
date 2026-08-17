---
title: Quick start
description: Bring up a Canton LocalNet from a single YAML file, inspect it, and tear it down.
---

## Write a config

Create `localnet.yaml`:

```yaml
version: '1.0'

validators: 2

auth:
  keycloak:
    admin: admin
    password: admin
```

The Super Validator is always created automatically, so this gives you three participants: the SV
plus the two validators you declared.

`dnm config` will generate this file interactively, or with `-y` to accept every default:

```bash
dnm config -y -o localnet.yaml
```

## Start it

```bash
dnm start
```

A cold first run takes several minutes — it pulls images, brings up PostgreSQL, Canton, Splice,
Keycloak, and Nginx, then allocates parties and provisions users across the ledger, Keycloak, and the
Splice wallet.

## Inspect it

```bash
dnm status       # container state and health
dnm env          # API URLs, auth config, DSO party ID
dnm credentials  # web UI login credentials
```

Add `--json` to any of these to get machine-readable output, or `--shell` on `dnm env` to get
`export`-able variables.

```bash
dnm parties       # parties across validators
dnm entitlements  # users with their rights
dnm packages      # uploaded DAR packages
```

## Stop or destroy it

```bash
dnm stop            # stop containers, keep ledger state
dnm destroy --force # remove containers, networks, and volumes
```

`stop` leaves the containers and the PostgreSQL volume in place, so a later `dnm start` resumes in
seconds rather than rebuilding. `destroy` removes containers, networks, and volumes; without
`--force` it asks for confirmation.

:::note
Nothing is written to your host filesystem — configuration reaches the containers through environment
variables, so there is no generated directory to clean up.
:::

## Next

- [Web UIs and credentials](/denex-network-manager/start/web-uis/) — where to log in
- [Using the SDK](/denex-network-manager/guides/sdk/) — drive all of this from TypeScript
- [CLI reference](/denex-network-manager/reference/cli/) — every command
