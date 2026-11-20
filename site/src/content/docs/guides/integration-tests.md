---
title: Integration tests and CI
description: Run your app's integration tests against a LocalNet with one command, on a developer's machine first and unchanged in CI — version pinning, lifecycle, DAR upload, container logs, and the gotchas.
---

[Building a dev stack](/denex-network-manager/guides/dev-stack/) covers keeping a LocalNet up while
you develop. This covers the next step: an integration-test command for your app that starts what it
needs, runs the tests and cleans up, and that CI runs unchanged.

A working version lives in
[`examples/integration-tests`](https://github.com/denex-io/denex-network-manager/tree/main/examples/integration-tests):
a small TypeScript app with a Daml model, an off-chain service, and vitest tests across two
validators. It consumes dnm as your project would, the released CLI and the npm package, and imports
nothing from this repository.

```bash
npm ci
npm run test:integration
```

## Local first, then the same command in CI

Write the command for a developer's machine, and make CI call exactly that. Anything that only works
in GitHub Actions is something nobody can debug locally. In the example, `npm run test:integration`:

1. installs the pinned `dnm` into the project (`.dnm/bin`)
2. builds the DAR with `dpm build`
3. starts the LocalNet, or reuses one that is already running
4. uploads the DAR and checks that it arrived
5. runs the tests
6. destroys the LocalNet, if this run created it

Step 6 is what makes the command safe to run on a laptop: a LocalNet the developer already had up is
left alone. For the inner loop, the same steps are split into `npm run localnet:up`, `npm test`
(seconds, as often as you like) and `npm run localnet:down`.

## Pin dnm once

The example pins one version, `@denex/network-manager` in `package.json`, and derives the CLI from
it: `scripts/install-dnm.sh` runs [`install.sh`](/denex-network-manager/start/installation/) from
the same release tag with `DNM_VERSION` set to that version and `DNM_INSTALL_DIR` set to the
project's `.dnm/bin`. `install.sh` verifies the binary against the release's `SHA256SUMS`.

Installing into the project rather than relying on a `dnm` on `PATH` keeps every machine and every
CI run on the same version, which a global install does not. Bumping dnm is then one line in
`package.json`, plus the lockfile `npm install` rewrites.

## Who owns the LocalNet

The example shows two ways to put the lifecycle around the tests. Pick one; both stay green in this
repository's CI.

**A script around the test run, driving the CLI** (`scripts/localnet.ts`, behind
`npm run test:integration`). `dnm start` already does most of the work: it creates the instance,
resumes a stopped one, repairs a partly running one, and leaves a running one with the same config
alone. The script records whether the instance existed before it ran, and destroys it afterwards
only if it did not. Test runners and languages do not matter to this pattern, so it carries over to
any project.

**The test runner's global setup, driving the SDK** (`test/global-setup.sdk.ts`, behind
`npm run test:integration:sdk`). No binary is needed. Reuse-or-start follows
[Always try to reuse](/denex-network-manager/guides/dev-stack/#always-try-to-reuse): attach with
`LocalNet.fromInstanceId()`, gate on `isRunning()`, otherwise build a fresh handle with
`LocalNet.fromConfig()` and `start()` it.

Either way, the tests receive one environment snapshot (`dnm env --json`, or `getEnvironment()`)
from the global setup and derive everything from it: endpoints, Keycloak realms and clients, and
party ids. Party ids change with every fresh LocalNet, so nothing about them can be hardcoded. Each
party connects to the validator that hosts it, as
[One connection per party](/denex-network-manager/guides/dev-stack/#one-connection-per-party-against-its-own-participant)
explains, and logs in as its own configured user: dnm creates each user in its validator's realm,
with its id as its password, and the `userClientId` client accepts the password grant.
`TokenManager` from `@denex/network-manager` fetches those tokens and replaces them before they
expire, which matters because LocalNet tokens last five minutes.

## Upload the DAR, and check it arrived

`packages:` in `localnet.yaml` uploads the DAR at the end of initialization. Two things about it
matter in a test command:

- **A failed upload is only a warning in dnm 0.1.0-beta.3, and `start` still succeeds.** The tests
  then fail later, on a template that does not exist. The example's CLI script therefore checks the
  result itself: it reads the DAR's main package id with `dpm inspect-dar --json` and fails unless
  `dnm packages --json` shows it on each validator that needs it. That check covers current dnm
  behavior; it is not a pattern to keep once dnm fails the start itself. The SDK setup does not need
  it, because `LocalNet.uploadDar()` throws when any participant rejects the DAR.
- **A running instance is left alone, initialization included.** When `start` finds the instance
  already running, it uploads nothing, so a rebuilt DAR would never arrive. The script runs
  `dnm init` on a reused instance, which uploads the `packages` again.

Canton refuses a second package with the same name and version (`KNOWN_PACKAGE_VERSION`). When you
change the Daml model while reusing a LocalNet, bump `version` in `daml.yaml`, or destroy the
LocalNet and start clean.

## Keep tests independent of leftovers

A reused LocalNet keeps its ledger between runs, so a test cannot assume it starts from an empty
one. The example gives every test its own event name and only looks at contracts carrying it. The
same goes for anything else a test creates: make it unique per run, or look it up rather than
counting.

## The CI job

The example's workflow is
[`.github/workflows/example-integration-tests.yml`](https://github.com/denex-io/denex-network-manager/blob/main/.github/workflows/example-integration-tests.yml).
In your own repository it is the same job, without the `working-directory` and with your own paths:

- `runs-on: ubuntu-24.04`. Pin the image: `ubuntu-latest` moves between Ubuntu releases.
- Node with npm caching, then dpm. The Daml SDK version is read from `daml.yaml` and dpm is cached
  under exactly that key. No fallback keys: the install step skips when dpm is present, so a cache
  from another SDK version would quietly leave the wrong one in place. The cache is saved right
  after the install, so a failed test run does not throw it away.
- `npm ci`, a type check, and the integration command itself, which is the only step that starts
  a LocalNet.
- On failure, `logs/` is uploaded as an artifact (see below).
- An `if: always()` step destroys the instance if a cancelled or timed-out job left it behind. On a
  hosted runner the VM is discarded anyway; on a self-hosted one it is what keeps containers from
  piling up.
- `timeout-minutes` on the job and on every step, because nothing inside the run bounds it (see
  `--timeout` below).

### Image pulls are not the slow part

Measured on a hosted `ubuntu-24.04` runner on 2026-11-20, with dnm 0.1.0-beta.3 (Splice 0.9.4) and
this example's SV and two validators: a cold `dnm start`, pulling every image, took 4 min 9 s. With
the images already present it took 3 min 38 s. The pulls cost about half a minute; the rest is
initialization. Restoring the images from `actions/cache` took 17 s and `docker load` another 33 s,
more than the pulls they replace, so the example does not cache images and plain pulls are the
default. Budget about four minutes for the LocalNet, every run.

### Other CI systems

Nothing in the command depends on GitHub Actions. Any CI system works that gives the job a Linux
machine with a Docker daemon it can reach (a VM, or a container with the host's Docker socket),
plus Node, dpm and `curl`. Run the same `npm ci` and `npm run test:integration`, keep `logs/` as an
artifact when the job fails, run the leftover teardown in whatever the system has for always-run or
post steps, and set a job timeout.

## Gotchas

- **Linux runners only.** GitHub's hosted macOS runners have no Docker, and Windows is not
  supported by `install.sh`.
- **Memory.** Right after `start`, on the same hosted runner, the containers of the SV and two
  validators used about 4.9 GiB, 2.9 GiB of it Canton. Once idle the same topology settles at about
  3.2 GiB (measured on Docker Desktop for 0.1.0-beta.3; see the
  [changelog](/denex-network-manager/help/changelog/)). Hosted runners have 16 GB; size a
  self-hosted runner or a Docker VM for the higher figure. One validator fewer uses less.
- **`--timeout` is not a wall-clock limit in 0.1.0-beta.3.** `start --timeout` is in milliseconds
  (default `300000`) and is checked only before each layer of containers starts, so image pulls
  within a layer, health-check waits and initialization can all run past it. `stop` and `destroy`
  take `--timeout` in seconds, as the grace period before Docker kills a container. The example
  passes `--timeout 900000` so a slow cold pull does not trip the check, and relies on the CI job's
  timeout as the real bound. Check the [CLI reference](/denex-network-manager/reference/cli/#start)
  for the version you pin.
- **A failed first start leaves no containers, and so no logs.** `start` removes what a failed
  attempt created, and in 0.1.0-beta.3 its error does not include container logs. The example
  covers that with `scripts/container-logs.ts`, which copies each container's log into `logs/` while
  the run is going and prints the end of each one when it fails. It is a workaround for current dnm
  behavior, not something your project should need for good.
- **More than one instance on one Docker daemon.** On a shared self-hosted runner, or beside a
  developer's own LocalNet, give each run its own instance id and its own `basePort`. The example
  reads both from the environment (`LOCALNET_INSTANCE`, and `${LOCALNET_BASE_PORT:6600}` in
  `localnet.yaml`). An identical config under the same id attaches to the running instance instead
  of failing; see
  [Running more than one instance](/denex-network-manager/guides/dev-stack/#running-more-than-one-instance).
- **`*.localhost` may not resolve on CI images.** The API endpoints in the environment use
  `localhost`, so tests that stay on the APIs are unaffected. Browser tests against the web UIs need
  the names to resolve; see
  [Serving multiple UIs](/denex-network-manager/guides/dev-stack/#serving-multiple-uis).
