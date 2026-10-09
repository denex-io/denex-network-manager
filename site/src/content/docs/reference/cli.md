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

| Command                               | Description                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| [`start`](#start)                     | Start the Canton LocalNet                                                              |
| [`stop`](#stop)                       | Stop the Canton LocalNet                                                               |
| [`status`](#status)                   | Show LocalNet status                                                                   |
| [`destroy`](#destroy)                 | Destroy the LocalNet and remove all containers, networks, and data                     |
| [`init`](#init)                       | Initialize resources on a running LocalNet (create parties and users, upload packages) |
| [`config`](#config)                   | Generate a `localnet.yaml` configuration file                                          |
| [`parties`](#parties)                 | List parties and the validator that hosts each                                         |
| [`packages`](#packages)               | List packages known to each participant (built-ins included)                           |
| [`env`](#env)                         | Show environment info for the LocalNet                                                 |
| [`credentials`](#credentials)         | Show login credentials for web UIs                                                     |
| [`instances`](#instances)             | List LocalNet instances (running, mixed or stopped)                                    |
| [`entitlements`](#entitlements)       | List users with their rights on the LocalNet                                           |
| [`discovery serve`](#discovery-serve) | Start the discovery server                                                             |

## Instance resolution

Only `start` accepts `-c, --config <path>`. The other commands that act on an instance read the
config stored in its Docker labels rather than your config file.

State commands take `--instance <id>`. Without it they look at the instances on the Docker daemon in
tiers, running first, then mixed (partly running), then stopped, limited to the tiers the command
accepts. The first tier that has any instance decides: one instance is chosen, several are an error
that asks for `--instance <id>`. When a command falls back to a mixed or stopped instance, or passes
over other instances, it prints a notice on stderr.

| Command                                       | Auto-resolves to          |
| --------------------------------------------- | ------------------------- |
| `status`, `env`, `credentials`                | running, mixed or stopped |
| `stop`, `parties`, `packages`, `entitlements` | running or mixed          |
| `init`                                        | running only              |

`destroy` does not use tiers. Without `--instance` it picks the only instance with a supported label schema,
whatever its state, and fails if there are several.

When only stopped instances exist, `stop` without `--instance` says the instance is already stopped
and exits with code 1. With `--instance <id>` on a stopped instance, it succeeds without changing
anything. `start` differs from the other commands: its `--instance` defaults to `default` rather
than auto-resolving, and it has the short form `-i`.

:::caution[The `--timeout` unit is not consistent]
`start --timeout` is in milliseconds (default `300000`). `stop --timeout` and `destroy --timeout`
are in seconds (default `30`), the grace period Docker gives each container before it kills it.
Passing `300000` to `stop` sets that grace period to about three and a half days.
:::

## start

Start the Canton LocalNet.

| Flag                   | Default     | Description                                         |
| ---------------------- | ----------- | --------------------------------------------------- |
| `-c, --config <path>`  | discovered  | Path to config file                                 |
| `-i, --instance <id>`  | `"default"` | Instance ID                                         |
| `-t, --timeout <ms>`   | `300000`    | Startup timeout in milliseconds                     |
| `--no-parallel`        |             | Start containers sequentially                       |
| `--skip-health-checks` |             | Skip container health checks                        |
| `--skip-init`          |             | Skip post-startup initialization (party and user setup, packages upload) |

`start` resumes an existing instance with the same ID and repairs a partly running one: stopped
containers are started, missing ones are created, running containers that depend on them are
restarted, and initialization runs again. It does not start over. If every container is already
running with the same config, `start` changes nothing and does not run initialization. Use
`dnm init` to re-run it. If a start fails, it removes only
the containers, network, and volume that the attempt created, and stops again the containers it
started. A failed first start leaves nothing behind, and a failed resume leaves the stopped
containers and the data volume in place. Exception: if a container name is already taken partway
through (another process is probably starting the same instance), it removes only the containers it
created and leaves the rest running.

Before it changes anything, `start` runs these checks:

- If the instance's containers were created from a different config, it exits with code 1. Run
  `dnm destroy --instance <id>` first, or use another `--instance`.
- It refuses paused containers.
- It aborts when another process appears to be starting the same instance, that is, when a
  container has been in the `created` state for less than 60 seconds.
- It fails when another LocalNet container already publishes one of the instance's host ports.
  Instance IDs where one is a prefix of the other followed by `-`, such as `app` and `app-stack`,
  are caught only when Docker binds the port.
- On a fresh start without `--skip-init`, it fails when a `packages` DAR cannot be found.

The timeout is checked before each layer of containers starts, so health-check waits and
initialization can run past it. At the end of initialization, `start` uploads the DARs in the
config's `packages` list.

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
| `-t, --timeout <sec>` | `30`    | Stop timeout in seconds     |

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
| `-t, --timeout <sec>` | `30`    | Stop timeout in seconds     |
| `-f, --force`         |         | Skip confirmation           |

Nothing is written to the host filesystem during a run, so there is no generated directory left
behind to remove.

## init

Initialize resources on a running LocalNet: create the configured parties and users, and upload the
`packages` DARs. `start` does this automatically on a fresh start, resume or repair unless you passed `--skip-init`.

Running `init` again is safe. A configured party whose hint is already hosted on its validator is
skipped, users converge on their configured state, and the DARs are uploaded again. A missing DAR or
a failed upload is a warning, not an error. `init` fails if it cannot query the parties already
hosted on a validator that has configured parties. It also fails on an instance that is not fully
running; run `dnm start` for that instance, which repairs it and runs initialization.

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
the parties hosted on that validator, and an unknown validator name is rejected. Without `--validator`, a
validator that does not respond produces a warning on stderr and its parties are missing from the
list, so `--json` output stays clean; the command fails if no validator responds. With
`--validator`, an unreachable validator is an error.

| Flag                     | Default | Description                                                  |
| ------------------------ | ------- | ------------------------------------------------------------ |
| `--instance <id>`        | auto    | Instance ID (auto-resolves to the one running or mixed instance) |
| `-v, --validator <name>` |         | Only parties hosted on this validator                        |
| `--json`                 |         | Output as JSON                                               |

## packages

List the packages known to each participant, built-in Splice and Daml packages included. The table
has one row per package and one column per participant that shows whether that participant knows it.
`--validator` shows one participant, and an unknown validator name is rejected. Without `--validator`, a participant
that does not respond produces a warning on stderr, and its column is marked `(unreachable)` with `?` in
every row. The command fails if no participant responds. With `--validator`, an unreachable
participant is an error.

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

An unknown `--validator` name is rejected. Without `--validator`, a validator that does not
respond produces a warning on stderr and its users are missing from the list; the command fails if
no validator responds. With `--validator`, an unreachable validator is an error.

Rights are granted per participant, so a user listed under one validator has no rights on
another. See
[Parties, participants, and rights](/denex-network-manager/guides/dev-stack/#parties-participants-and-rights).

## discovery serve

Start the discovery server.

| Flag            | Default       | Description       |
| --------------- | ------------- | ----------------- |
| `--port <port>` | `3100`        | Port to listen on |
| `--host <host>` | `"127.0.0.1"` | Host to bind to   |

Routes and an example are in [Discovery server](/denex-network-manager/guides/discovery/).
