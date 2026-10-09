---
title: Using the SDK
description: Drive a LocalNet from TypeScript — lifecycle, config in code, attaching to a running instance, and runtime user and DAR provisioning.
---

`@denex/network-manager/sdk` is the curated surface, usable from Deno 2.0+, Node.js 18+, and Bun.
From Bun, configure Docker to listen on a TCP socket; see
[Installation](/denex-network-manager/start/installation/).

## Smallest working example

```typescript
import { LocalNet, LocalNetBuilder } from '@denex/network-manager/sdk';

const config = LocalNetBuilder.create()
  .withValidators(1)
  .build();

const net = await LocalNet.fromConfig(config);

await net.start({ onProgress: console.log });

const env = await net.getEnvironment();
console.log(env.validators.sv.endpoints);

await net.destroy();
```

Two things are easy to get wrong:

- `LocalNetBuilder` has a private constructor. Use `LocalNetBuilder.create()`, not `new`.
- `build()` returns a config, not a running instance. Pass it to `LocalNet.fromConfig()`.

## Lifecycle from a config file

```typescript
import { LocalNet } from '@denex/network-manager/sdk';

const net = await LocalNet.fromConfig('./localnet.yaml', {
  instanceId: 'demo',
});

await net.start();

const env = await net.getEnvironment();
const credentials = await net.getCredentials();
const parties = await net.getParties();

await net.stop();
```

`instanceId` prefixes every container name and is the handle for everything afterwards. It defaults
to `'default'`. Containers outlive the process that started them, so `stop()` or `destroy()` is
always explicit — nothing reaps them when your script exits.

`stop()` keeps the PostgreSQL volume, so a later `start()` resumes. `destroy()` removes containers,
the network, and volumes.

A failed `start()` removes only what that call created and stops again the containers it had
started, so a failed resume keeps the containers, the network, and the volume. The exception is an
abort because another process appears to be starting the instance: then it removes only the
containers it created and leaves the rest for that process. On a partially
running instance, `start()` on a new handle repairs it; see
[Always try to reuse](/denex-network-manager/guides/dev-stack/#always-try-to-reuse).

The config is validated when the handle is created, so an invalid config throws a `ZodError` before
Docker is touched, and unknown keys are reported as warnings. Pass `onWarning` in the options to
receive them, along with the non-fatal problems that queries report, for example a validator that did
not respond. The default prints to `console.warn`, and the construction-time ones are also kept in
`net.warnings`.

When you give `fromConfig()` a path, relative `packages[].dar` paths resolve against that file's
directory. When you give it a config object, pass `configDir` in the options for the same effect.

## Build config in code

```typescript
const config = LocalNetBuilder.create()
  .addValidator('app', {
    parties: ['app-operator'],
    users: [{ id: 'app-operator', primaryParty: 'app-operator' }],
  })
  .addValidator('users-val', { parties: ['alice', 'bob'] })
  .withBasePort(6000)
  .withAuth('admin', 'admin')
  .build();

const net = await LocalNet.fromConfig(config);
await net.start();
```

## Attach to a running instance

```typescript
const net = await LocalNet.fromInstanceId('demo');
const status = await net.status();
const snapshot = await net.getSnapshot();
```

:::caution
`LocalNet.fromInstanceId()` is an existence check, not a liveness check. It throws when no container
carries the instance label, when the stored config uses an unsupported schema or does not parse, or
when Docker is unreachable. A cleanly stopped instance attaches successfully and then reports itself
as running. Gate on `isRunning()` when you mean "is this usable" — see
[Building a dev stack](/denex-network-manager/guides/dev-stack/#always-try-to-reuse) for the recipe.
:::

`LocalNet.discover()` lists every instance on the Docker daemon, running or not, without needing a
config file, reconstructing each one from its Docker labels. Each entry has a `status` of `running`,
`mixed` (some containers running and some not), `stopped`, or `unsupported`, so filter on `status`
when you want only the running ones.

## Query parties and packages

Query a running instance for its parties and packages:

```typescript
const parties = await net.getParties(); // every party, once, under its host
const onUsersVal = await net.getParties('users-val'); // only parties hosted there

const packages = await net.getPackages();
// [{ packageId: '…', validators: ['sv', 'app', 'users-val'] }, …]
```

`getParties()` lists each party once, with `validator` set to the participant that hosts it. Pass a
validator name to list only the parties hosted there; an unknown or unreachable name throws.

`getPackages()` returns one row per package, `{ packageId, validators }`, where `validators` names
the participants that know it. Built-in Splice and Daml packages are included.

Unnamed, both methods return what the reachable participants report. Each participant that does not
respond produces a warning through `onWarning` and its results are left out. If no participant
responds, they throw.

## Create users and upload DARs after startup

```typescript
await net.createUser('alice', 'users-val', {
  primaryParty: 'alice',
  parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
});

await net.uploadDar('./my-app.dar');
await net.uploadDar('./my-app.dar', ['app', 'users-val']);
```

`createUser` provisions the ledger user, the Keycloak user, and, when `primaryParty` is set, wallet
onboarding. It is idempotent per side, so retries converge after partial failures. Party hints
resolve against the parties hosted on the user's own validator. A hint that is not hosted there is
allocated on that validator, which gives a different party ID than the same hint on another one.
User IDs must be lowercase.

`net.uploadDar()` uploads to `sv` and every validator unless you name the targets, and returns
nothing. It throws for an unknown validator name or an empty target list before it uploads anything.
Canton rejects a file that is not a valid DAR, and the error includes Canton's message. If the
upload fails on some participants, it still tries the rest, then throws one error naming the failed
ones.

:::note
DAR packages listed in the `packages` config field are uploaded for you at the end of
initialization, to each package's `uploadTo` validators, by `start()` and again by `dnm init`. A
failed upload is a warning (`source: 'packages'`) and does not stop `start()`. A DAR file that is
missing fails a fresh start before anything is created, and is only a warning on resume, repair or `dnm init`. Call
`net.uploadDar()` for DARs you add after start.
:::

## Read logs and run commands

`net.logs()` and `net.exec()` take the full runtime container name, prefixed with the instance ID,
and work on any handle of a running instance. This reads the last 50 lines of the Splice log and
runs a query in the PostgreSQL container:

```typescript
const stream = await net.logs('demo-splice', { tail: 50 });
console.log(await new Response(stream).text());

const result = await net.exec('demo-postgres', [
  'psql', '-U', 'cnadmin', '-d', 'postgres', '-tAc', 'select 1',
]);
console.log(result.exitCode, result.stdout);
```

Log output has stdout and stderr merged, without Docker's stream framing. Pass `follow: true` to
keep the stream open until the container stops or you cancel it. `exec()` resolves to `exitCode`,
`output` (stdout and stderr merged in arrival order), and separate `stdout` and `stderr`. An unknown
container name throws, and the message lists the instance's container names.

## Beyond the curated surface

Advanced users can import the full API from `@denex/network-manager`, including `CantonClient`,
`ValidatorAdminClient`, generators, schemas, Docker helpers, and discovery utilities.

## Next

Wrapping an instance in a one-command dev stack for your own application — reusing a live instance,
connecting per participant, waiting for readiness, and serving a UI per validator — is covered in
[Building a dev stack](/denex-network-manager/guides/dev-stack/).

Every exported class, method, and type is listed in the
[API reference](/denex-network-manager/reference/api/readme/).
