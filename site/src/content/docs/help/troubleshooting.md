---
title: Troubleshooting
description: Common LocalNet failures and what actually causes them.
---

Container names are prefixed with the instance ID (default: `default`), so the Splice container is
`default-splice`, not `splice`. Use `dnm status` to list the real names.

## 502 Bad Gateway on API routes

The `splice` container is likely crash-looping. Check `docker logs default-splice` for fatal errors.

All Splice backends run in **one process**, so a bad validator config takes SV, Scan, and every
validator API offline together. A single misconfigured validator looks like a total outage.

## 401 Unauthorized from wallet APIs

Verify the Keycloak realm names. Validator realm names are title-cased from validator names:
`validator-1` becomes `Validator1`, and `alice-validator` becomes `AliceValidator`. Check
`docker logs default-keycloak` for realm import errors.

## Web UI loads but spins forever

The static UI is reachable but its backend API is unhealthy or unreachable. Check `dnm status` and the
relevant container logs.

## Splice reports "Node name is too long"

Use shorter validator names. Splice caps generated node names at 30 characters and appends
`-validator_backend` (18 characters), which is why the config schema rejects validator names longer
than **12** characters up front.

## `NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT`

You are submitting as a party on a participant that does not host it. This appears the moment a
second validator exists, and retrying will not help — Canton accepts a submission only on the
participant hosting the submitting party.

Resolve each party to its host validator and open a connection there. See
[One connection per party](/denex-network-manager/guides/dev-stack/#one-connection-per-party-against-its-own-participant).

## An empty `docker ps` after a failed start

Expected, not a second problem. A failed `start()` cleans up after itself, so a crashed bring-up
leaves nothing behind.

## Signing in as a second user replaces the first session

Cookies are scoped by host but not by port, so two UIs on different ports of `127.0.0.1` share one
cookie jar. Give each its own hostname. See
[Serving multiple UIs](/denex-network-manager/guides/dev-stack/#serving-multiple-uis).

## A stopped instance looks like a running one

`LocalNet.fromInstanceId()` succeeds for any instance whose containers merely exist, including
stopped ones, and the object it returns reports itself as running. Gate on `isRunning()`. See
[Always try to reuse](/denex-network-manager/guides/dev-stack/#always-try-to-reuse).

## `dnm stop` seems to hang

Check the unit. `start --timeout` is in milliseconds, but `stop --timeout` and `destroy --timeout` are
in **seconds** — passing `300000` to `stop` asks it to wait three and a half days.

## Still stuck?

Open an issue at
[github.com/denex-io/denex-network-manager/issues](https://github.com/denex-io/denex-network-manager/issues).
Include `dnm status --json`, `dnm env --json`, and the relevant container logs.
