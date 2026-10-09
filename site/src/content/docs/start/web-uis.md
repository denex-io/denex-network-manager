---
title: Web UIs and credentials
description: Where the SV, Scan, and wallet UIs are published, and which credentials log into each.
---

Default ports use base port `5000`:

| URL                            | Service                       | Default login                                   |
| ------------------------------ | ----------------------------- | ----------------------------------------------- |
| `http://sv.localhost:5080`     | Super Validator management UI | `sv` / `sv`                                     |
| `http://scan.localhost:5080`   | Scan explorer                 | `sv` / `sv` if prompted                         |
| `http://wallet.localhost:5080` | SV wallet                     | `sv` / `sv`                                     |
| `http://wallet.localhost:5180` | Validator 1 wallet            | `validator_1-wallet-admin` (same as password)   |
| `http://wallet.localhost:5280` | Validator 2 wallet            | `validator_2-wallet-admin` (same as password)   |

For a validator, the wallet login is the validator name with each hyphen replaced by an underscore,
followed by `-wallet-admin`. The password equals the username. The user named after the validator
(`validator-1`) exists in Keycloak but is not onboarded. Signing in as it and onboarding from the wallet UI creates a
new party rather than using the validator's. Use the `-wallet-admin` login.

A YAML-defined user's password is its `id`; it cannot be configured. Only a user with a `primaryParty` is
onboarded to the wallet, with that party. `dnm credentials` marks the others as not onboarded:
signing in as one of them and onboarding from the wallet UI creates a new party for it rather than
using a configured one.

`dnm credentials` prints the current set for an instance, and `dnm credentials --json` gives the same
data for scripts.

## Keycloak admin is not a wallet login

The `auth.keycloak.admin` and `auth.keycloak.password` values configure the persistent Keycloak
master realm admin, reachable at `http://localhost:5082` (`basePort + 82`). They are not validator
wallet credentials. `dnm credentials` prints this login below the web UI table, and
`dnm credentials --json` includes it as an entry with realm `master`.

## Hostnames and ports

The SV UIs share port `5080` and Nginx tells them apart by hostname: `sv.localhost`,
`scan.localhost`, and `wallet.localhost`. Each validator's wallet is published on its own port, and
all of them use the `wallet.localhost` hostname.

Cookies are scoped by host but not by port
([RFC 6265 §8.5](https://datatracker.ietf.org/doc/html/rfc6265#section-8.5)), so the wallets share a
cookie jar. Signing in to a second wallet in the same browser profile can replace the first session.
Use a separate profile or a private window for each wallet you want signed in at once.

`*.localhost` names need no `/etc/hosts` entry on macOS or on Linux with systemd-resolved, because
[RFC 6761 §6.3](https://datatracker.ietf.org/doc/html/rfc6761#section-6.3) reserves the TLD for
loopback. Resolution is not universal — see
[Serving multiple UIs](/denex-network-manager/guides/dev-stack/#serving-multiple-uis) for the platform
table and what to do in CI.
