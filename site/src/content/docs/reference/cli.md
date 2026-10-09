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

| Command                                                     | Description                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| [`start`](#start)                                           | Start LocalNet containers                                          |
| [`stop`](#stop)                                             | Stop all containers gracefully                                     |
| [`status`](#status)                                         | Show container state and health                                    |
| [`destroy`](#destroy)                                       | Remove containers, networks, and data                              |
| [`init`](#init)                                             | Create parties and users, upload `packages:` on a running LocalNet |
| [`config`](#config)                                         | Generate `localnet.yaml` interactively                             |
| [`parties`](#parties)                                       | List parties and the validator that hosts each                     |
| [`packages`](#packages)                                     | List packages known to each participant (built-ins too)            |
| [`env`](#env)                                               | Show API URLs, auth config, and DSO party ID                       |
| [`credentials`](#credentials)                               | Show web UI login credentials                                      |
| [`instances`](#instances)                                   | List LocalNet instances (running, mixed or stopped)                |
| [`entitlements`](#entitlements)                             | List users with their rights                                       |
| [`discovery serve`](/denex-network-manager/guides/discovery/) | Run the multi-instance discovery HTTP server                       |

## Instance resolution

Only `start` accepts `-c, --config <path>`. Every other command attaches to Docker containers
through labels rather than reading your config file.

State commands take `--instance <id>`. Without it they look at the instances on the Docker daemon in
tiers, running first, then mixed (partly running), then stopped, limited to the tiers the command
accepts. The first tier that has any instance decides: one instance is chosen, several are an error
that asks for `--instance <id>`. When a command falls back to a mixed or stopped instance, or passes
over other instances, it prints a notice on stderr.

| Command                                      | Accepts                  |
| -------------------------------------------- | ------------------------ |
| `status`, `env`, `credentials`               | running, mixed or stopped |
| `stop`, `parties`, `packages`, `entitlements` | running or mixed          |
| `init`                                       | running only              |
| `destroy`                                    | any supported instance    |

`stop` on an instance that is already stopped says so and exits with code 1. `start` differs: its
`--instance` defaults to `default` rather than auto-resolving, and it has the short form `-i`.

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
| `--skip-init`          |             | Skip post-startup initialization (party and user setup, packages upload) |

`start` resumes an existing instance with the same ID and repairs a partly running one: stopped
containers are started, missing ones are created, and running containers that depend on them are
restarted. It does not start over. If a start fails, only the containers, network, and volume that
the attempt created are removed, so a failed resume leaves the stopped containers and the data
volume in place. It refuses paused containers, and it aborts when another process appears to be
starting the same instance (a container created less than 60 seconds ago).

At the end of initialization, `start` uploads the DARs in the config's `packages:` list.

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
| `--instance <id>`     | auto    | Instance ID (auto-resolves to the one running or mixed instance) |
| `-t, --timeout <sec>` | `30`    | Stop timeout in **seconds** |

## status

Show LocalNet status.

| Flag              | Default | Description    |
| ----------------- | ------- | -------------- |
| `--instance <id>` | auto    | Instance ID (auto-resolves to the one running, mixed or stopped instance) |
| `--json`          |         | Output as JSON |

## destroy

Destroy the LocalNet, removing containers, networks, and volumes.

| Flag                  | Default | Description                 |
| --------------------- | ------- | --------------------------- |
| `--instance <id>`     | auto    | Instance ID (auto-resolves if only one instance found) |
| `-t, --timeout <sec>` | `30`    | Stop timeout in **seconds** |
| `-f, --force`         |         | Skip confirmation           |

Nothing is written to the host filesystem during a run, so there is no generated directory left
behind to remove.

## init

Initialize resources on a running LocalNet: create the configured parties and users, and upload the
`packages:` DARs. `start` does this automatically unless you passed `--skip-init`.

Running `init` again is safe. A configured party whose hint is already hosted on its validator is
skipped, users converge on their configured state, and the DARs are uploaded again. A missing DAR or
a failed upload is a warning, not an error. `init` fails if it cannot query the parties already
hosted on a validator that has configured parties.

| Flag              | Default | Description |
| ----------------- | ------- | ----------- |
| `--instance <id>` | auto    | Instance ID (auto-resolves if only one running) |

## config

Generate a `localnet.yaml` configuration file.

| Flag                  | Default           | Description                           |
| --------------------- | ----------------- | ------------------------------------- |
| `-o, --output <path>` | `"localnet.yaml"` | Output file path                      |
| `-y, --yes`           |                   | Accept all defaults without prompting; overwrites an existing file after saving it as `<output>.bak` |

The generated file is validated before it is written, so a duplicate or colliding validator name
fails and nothing is written. An existing `<output>.bak` is replaced.

```bash
dnm config -y -o localnet.yaml
```

## parties

List parties and the validator that hosts each. Each party is listed once. `--validator` shows only
the parties hosted on that validator, and an unknown validator name is rejected. A validator that
does not respond produces a warning on stderr and its parties are missing from the list, so `--json`
output stays clean; the command fails if no validator responds.

| Flag                     | Default | Description                                                  |
| ------------------------ | ------- | ------------------------------------------------------------ |
| `--instance <id>`        | auto    | Instance ID (auto-resolves to the one running or mixed instance) |
| `-v, --validator <name>` |         | Only parties hosted on this validator                        |
| `--json`                 |         | Output as JSON                                               |

## packages

List the packages known to each participant, built-in Splice and Daml packages included. The table
has one row per package and one column per participant that shows whether that participant knows it.

| Flag                     | Default | Description                                                  |
| ------------------------ | ------- | ------------------------------------------------------------ |
| `--instance <id>`        | auto    | Instance ID (auto-resolves to the one running or mixed instance) |
| `-v, --validator <name>` |         | Only show this validator                                     |
| `--json`                 |         | Output as JSON                                               |

## env

Show environment info — endpoints, auth config, and the DSO party ID.

| Flag              | Default | Description                       |
| ----------------- | ------- | --------------------------------- |
| `--instance <id>` | auto    | Instance ID (auto-resolves to the one running, mixed or stopped instance) |
| `--json`          |         | Output as JSON                    |
| `--shell`         |         | Output as shell export statements |

```bash
dnm env --json
eval "$(dnm env --shell)"
```

## credentials

Show login credentials for the web UIs. Per validator, the wallet login is the wallet-admin user
(for example `validator_1-wallet-admin`), and a configured user without a `primaryParty` is marked
as not onboarded to the wallet. The Keycloak admin login shown is the one in your config's
`auth.keycloak` section, and `--json` includes it as an entry with realm `master`.

| Flag              | Default | Description    |
| ----------------- | ------- | -------------- |
| `--instance <id>` | auto    | Instance ID (auto-resolves to the one running, mixed or stopped instance) |
| `--json`          |         | Output as JSON |

## instances

List LocalNet instances, running, mixed or stopped, discovered through Docker labels.

| Flag         | Description                          |
| ------------ | ------------------------------------ |
| `--json`     | Output as JSON                       |
| `--ids-only` | Show only instance IDs (one per line) |

## entitlements

List users with their rights.

| Flag                     | Default | Description                                                  |
| ------------------------ | ------- | ------------------------------------------------------------ |
| `--instance <id>`        | auto    | Instance ID (auto-resolves to the one running or mixed instance) |
| `-v, --validator <name>` |         | Filter by validator                                          |
| `--json`                 |         | Output as JSON                                               |

Rights are granted **per participant**, so a user listed under one validator has no rights on
another. See
[Parties, participants, and rights](/denex-network-manager/guides/dev-stack/#parties-participants-and-rights).

## discovery serve

Covered in [Discovery server](/denex-network-manager/guides/discovery/).
