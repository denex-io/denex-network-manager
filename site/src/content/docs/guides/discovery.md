---
title: Discovery server
description: Query running LocalNet instances over HTTP with the multi-instance discovery server.
---

The discovery server is a separate foreground process for querying running instances over HTTP.

:::caution
It is not started from `localnet.yaml`. The `discovery` config field is deprecated and does not start
a server — run the command below explicitly.
:::

```bash
dnm discovery serve --port 3100 --host 127.0.0.1
```

`--port` defaults to `3100` and `--host` to `127.0.0.1`. Note that `dnm discovery` has no action of
its own; the `serve` subcommand is required.

## Routes

- `GET /health`
- `GET /instances`
- `GET /instances/:id/status`
- `GET /instances/:id/env`
- `GET /instances/:id/parties`
- `GET /instances/:id/packages`
- `GET /instances/:id/snapshot`

`GET /instances` lists every instance with its `status`: `running`, `mixed`, `stopped`, or
`unsupported`. An unknown instance ID returns 404, and an instance whose labels use an unsupported
schema returns 410 with a remediation hint.

`/env` is built from the stored config alone, so it has no party IDs. `/parties` lists each party
once, with `validator` set to the participant that hosts it. `/packages` lists each package once with
the validators that know it. Both answer 200 when some participants respond, with a `failures` list
(`validator` and `error`) naming the ones that did not, and answer 503 when none responds.

## Example

```bash
curl http://127.0.0.1:3100/instances
curl http://127.0.0.1:3100/instances/demo/env
```

Instances are discovered through Docker labels, so the server finds any LocalNet on the same Docker
daemon without needing its config file. `LocalNet.discover()` exposes the same capability from the
SDK. The server caches the instance list for 30 seconds.
