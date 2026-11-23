# Integration tests against a LocalNet

A small TypeScript app tested end to end against a dnm LocalNet, the way your own project would do
it: one command on a developer's machine, and the same command in CI.

The app is an RSVP flow across two validators. `alice`, on validator `org-a`, invites `bob`, on
validator `org-b`. An off-chain service acting for bob ([`src/rsvp-bot.ts`](src/rsvp-bot.ts))
answers each invitation from his calendar, which lives outside the ledger. The tests
([`test/rsvp.test.ts`](test/rsvp.test.ts)) check the answers reach alice, and that she cannot answer
for him.

This example is self-contained and consumes dnm as a user does: the released CLI, through
[`install.sh`](../../install.sh), and `@denex/network-manager` from npm. Nothing is imported from
this repository's source. Why each piece is shaped the way it is:
[Integration tests and CI](https://denex-io.github.io/denex-network-manager/guides/integration-tests/).

## Prerequisites

- Linux or macOS with Docker. The LocalNet (the SV and two validators) uses about 4.9 GiB of memory
  just after it starts and about 3.2 GiB once idle, so Docker needs that to spare.
- Node.js 22.18 or later, which runs the TypeScript scripts directly.
- dpm, with the Daml SDK version in [`daml/daml.yaml`](daml/daml.yaml):
  `curl -fsSL https://get.digitalasset.com/install/install.sh | sh`, then `dpm install` in `daml/`.

## Run it

```sh
npm ci
npm run test:integration
```

That installs the pinned `dnm` into `.dnm/bin`, builds the DAR, starts the LocalNet (or reuses one
that is running), runs the tests, and destroys the LocalNet if it created it. Starting the LocalNet
takes about four minutes.

While working on the app, keep the LocalNet up and rerun only the tests:

```sh
npm run localnet:up     # start or reuse, and upload the DAR
npm test                # as often as you like; takes seconds
npm run localnet:down   # destroy it
```

`npm run test:integration:sdk` does the same as `test:integration` with the lifecycle in the vitest
global setup, through the SDK, instead of around the test run through the CLI.

## Layout

| Path                                                          | What it is                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`localnet.yaml`](localnet.yaml)                              | The LocalNet: the SV, `org-a` hosting `alice`, `org-b` hosting `bob` |
| [`daml/`](daml/)                                              | The Daml model: `Invitation` and `Reply`                             |
| [`src/ledger.ts`](src/ledger.ts)                              | One party's connection to its own validator's JSON Ledger API        |
| [`src/rsvp-bot.ts`](src/rsvp-bot.ts)                          | The off-chain service acting for bob                                 |
| [`scripts/localnet.ts`](scripts/localnet.ts)                  | The CLI pattern: `up`, `down`, and `test` (what CI runs)             |
| [`test/global-setup.cli.ts`](test/global-setup.cli.ts)        | Reads `dnm env --json` once for every test file                      |
| [`test/global-setup.sdk.ts`](test/global-setup.sdk.ts)        | The SDK pattern: the test run owns the LocalNet                      |
| [`scripts/install-dnm.sh`](scripts/install-dnm.sh)            | Installs the CLI matching the `@denex/network-manager` version       |
| [`scripts/container-logs.ts`](scripts/container-logs.ts)      | Keeps the containers' logs of a failed run, which teardown removes   |
| [`.github/workflows/example-integration-tests.yml`][workflow] | The CI job, running both patterns                                    |

The `@denex/network-manager` version in [`package.json`](package.json) is the one pin for both the
CLI and the SDK.

## Running it beside another LocalNet

The instance id and the port block both have to differ:

```sh
LOCALNET_INSTANCE=rsvp-2 LOCALNET_BASE_PORT=6900 npm run test:integration
```

[workflow]: ../../.github/workflows/example-integration-tests.yml
