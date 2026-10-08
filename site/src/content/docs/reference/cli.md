---
title: CLI reference
description: Every dnm command and flag — start, stop, status, destroy, init, config, parties, packages, env, credentials, instances, entitlements, and discovery.
---

```bash
dnm --help
dnm <command> --help
```

Global options are `-h, --help` and `-V, --version`.

## Commands at a glance

| Command                                                     | Description                                        |
| ----------------------------------------------------------- | -------------------------------------------------- |
| [`start`](#start)                                           | Start LocalNet containers                          |
| [`stop`](#stop)                                             | Stop all containers gracefully                     |
| [`status`](#status)                                         | Show container state and health                    |
| [`destroy`](#destroy)                                       | Remove containers, networks, and volumes           |
| [`init`](#init)                                             | Initialize users and parties on a running LocalNet |
| [`config`](#config)                                         | Generate `localnet.yaml` interactively             |
| [`parties`](#parties)                                       | List parties across validators                     |
| [`packages`](#packages)                                     | List uploaded DAR packages                         |
| [`env`](#env)                                               | Show API URLs, auth config, and DSO party ID       |
| [`credentials`](#credentials)                               | Show web UI login credentials                      |
| [`instances`](#instances)                                   | List running LocalNet instances                    |
| [`entitlements`](#entitlements)                             | List users with their rights                       |
| [`discovery serve`](/denex-network-manager/guides/discovery/) | Run the multi-instance discovery HTTP server       |

## Instance resolution

Only `start` accepts `-c, --config <path>`. Every other command attaches to running Docker containers
through labels rather than reading your config file.

State commands take `--instance <id>` and auto-resolve when exactly one instance is running, so you
only need the flag when several are up. `start` differs: its `--instance` defaults to `default`
rather than auto-resolving, and it has the short form `-i`.

:::caution[The `--timeout` unit is not consistent]
`start --timeout` is in **milliseconds** (default `300000`). `stop --timeout` and
`destroy --timeout` are in **seconds** (default `30`). Passing `300000` to `stop` asks it to wait
just over three days.
:::

## start

Start the Canton LocalNet.

| Flag                   | Default     | Description                                         |
| ---------------------- | ----------- | --------------------------------------------------- |
| `-c, --config <path>`  | discovered  | Path to config file                                 |
| `-i, --instance <id>`  | `"default"` | Instance ID                                         |
| `-t, --timeout <ms>`   | `300000`    | Startup timeout in **milliseconds**                 |
| `--no-parallel`        |             | Start containers sequentially                       |
| `--skip-health-checks` |             | Skip container health checks                        |
| `--skip-init`          |             | Skip post-startup initialization (user/party setup) |

When `--config` is omitted, the CLI looks for `localnet.yaml`, `localnet.yml`, `.localnet.yaml`, then
`.localnet.yml`.

```bash
dnm start
dnm start --instance demo --timeout 300000
dnm start --skip-init
dnm start --skip-health-checks
```

## stop

Stop the Canton LocalNet, keeping containers and the PostgreSQL volume so a later `start` resumes.

| Flag                  | Default | Description                 |
| --------------------- | ------- | --------------------------- |
| `--instance <id>`     | auto    | Instance ID                 |
| `-t, --timeout <sec>` | `30`    | Stop timeout in **seconds** |

## status

Show LocalNet status.

| Flag              | Default | Description    |
| ----------------- | ------- | -------------- |
| `--instance <id>` | auto    | Instance ID    |
| `--json`          |         | Output as JSON |

## destroy

Destroy the LocalNet, removing containers, networks, and volumes.

| Flag                  | Default | Description                 |
| --------------------- | ------- | --------------------------- |
| `--instance <id>`     | auto    | Instance ID                 |
| `-t, --timeout <sec>` | `30`    | Stop timeout in **seconds** |
| `-f, --force`         |         | Skip confirmation           |

Nothing is written to the host filesystem during a run, so there is no generated directory left
behind to remove.

## init

Initialize resources on a running LocalNet — create users and link parties. `start` does this
automatically unless you passed `--skip-init`.

| Flag              | Default | Description |
| ----------------- | ------- | ----------- |
| `--instance <id>` | auto    | Instance ID |

## config

Generate a `localnet.yaml` configuration file.

| Flag                  | Default           | Description                           |
| --------------------- | ----------------- | ------------------------------------- |
| `-o, --output <path>` | `"localnet.yaml"` | Output file path                      |
| `-y, --yes`           |                   | Accept all defaults without prompting |

```bash
dnm config -y -o localnet.yaml
```

## parties

List parties on the LocalNet.

| Flag                     | Default | Description                |
| ------------------------ | ------- | -------------------------- |
| `--instance <id>`        | auto    | Instance ID                |
| `-v, --validator <name>` |         | Filter by validator        |
| `--verbose`              |         | Show verbose error logging |
| `--json`                 |         | Output as JSON             |

## packages

List packages on the LocalNet. Same flags as [`parties`](#parties).

## env

Show environment info — endpoints, auth config, and the DSO party ID.

| Flag              | Default | Description                       |
| ----------------- | ------- | --------------------------------- |
| `--instance <id>` | auto    | Instance ID                       |
| `--json`          |         | Output as JSON                    |
| `--shell`         |         | Output as shell export statements |

```bash
dnm env --json
eval "$(dnm env --shell)"
```

## credentials

Show login credentials for the web UIs.

| Flag              | Default | Description    |
| ----------------- | ------- | -------------- |
| `--instance <id>` | auto    | Instance ID    |
| `--json`          |         | Output as JSON |

## instances

List running LocalNet instances, discovered through Docker labels.

| Flag         | Description                          |
| ------------ | ------------------------------------ |
| `--json`     | Output as JSON                       |
| `--ids-only` | Show only instance IDs, one per line |

## entitlements

List users with their rights. Same flags as [`parties`](#parties).

Rights are granted **per participant**, so a user listed under one validator has no rights on
another. See
[Parties, participants, and rights](/denex-network-manager/guides/dev-stack/#parties-participants-and-rights).

## discovery serve

Covered in [Discovery server](/denex-network-manager/guides/discovery/).
