---
title: Web UIs and credentials
description: Where the SV, Scan, and wallet UIs are published, and which credentials log into each.
---

Default ports use base port `5000`:

| URL                            | Service                       | Default login                 |
| ------------------------------ | ----------------------------- | ----------------------------- |
| `http://sv.localhost:5080`     | Super Validator management UI | `sv` / `sv`                   |
| `http://scan.localhost:5080`   | Scan explorer                 | `sv` / `sv` if prompted       |
| `http://wallet.localhost:5080` | SV wallet                     | `sv` / `sv`                   |
| `http://wallet.localhost:5180` | Validator 1 wallet            | `validator-1` / `validator-1` |
| `http://wallet.localhost:5280` | Validator 2 wallet            | `validator-2` / `validator-2` |

For custom validators, the default wallet user is the validator name with the same value as the
password. YAML-defined users also use `id` as the default password.

`dnm credentials` prints the current set for a running instance, and `dnm credentials --json` gives
the same data for scripts.

## Keycloak admin is not a wallet login

The `auth.keycloak.admin` and `auth.keycloak.password` values configure the persistent Keycloak
master realm admin, reachable at `http://localhost:5082`. They are **not** validator wallet
credentials.

## Hostnames, not ports

Each UI is published on a distinct hostname rather than only a distinct port. That is deliberate:
cookies are scoped by host but not by port
([RFC 6265 §8.5](https://datatracker.ietf.org/doc/html/rfc6265#section-8.5)), so serving two wallets
on two ports of `127.0.0.1` would put them in one cookie jar and signing in as the second user would
silently replace the first session.

`*.localhost` names need no `/etc/hosts` entry on macOS or on Linux with systemd-resolved, because
[RFC 6761 §6.3](https://datatracker.ietf.org/doc/html/rfc6761#section-6.3) reserves the TLD for
loopback. Resolution is not universal — see
[Serving multiple UIs](/denex-network-manager/guides/dev-stack/#serving-multiple-uis) for the platform
table and what to do in CI.
