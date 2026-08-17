---
title: Using the SDK
description: Drive a LocalNet from TypeScript — lifecycle, config in code, attaching to a running instance, and runtime user and DAR provisioning.
---

`@denex/network-manager/sdk` is the curated surface, usable from Deno 2.0+, Node.js 18+, and Bun.

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

Two things worth noting, because both are easy to get wrong:

- `LocalNetBuilder` has a private constructor. Use `LocalNetBuilder.create()`, not `new`.
- `build()` returns a **config**, not a running instance. Pass it to `LocalNet.fromConfig()`.

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
`fromInstanceId` is an **existence** check, not a liveness check. It throws only when no container
carries the instance label at all, so a cleanly stopped instance attaches successfully and then
reports itself as running. Gate on `isRunning()` when you mean "is this usable" — see
[Building a dev stack](/denex-network-manager/guides/dev-stack/#always-try-to-reuse) for the recipe.
:::

`LocalNet.discover()` lists every running instance without needing a config file, reconstructing each
one from its Docker labels.

## Create users and upload DARs after startup

```typescript
await net.createUser('alice', 'users-val', {
  primaryParty: 'alice',
  parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
});

const packageId = await net.uploadDar('./my-app.dar');
await net.uploadDar('./my-app.dar', ['app', 'users-val']);
```

`createUser` provisions the ledger user, the Keycloak user, and wallet onboarding. It is idempotent
per side, so retries converge after partial failures.

:::note
DAR packages listed in the `packages:` config field are validated on load but are **not** uploaded
automatically on startup. Call `net.uploadDar(path)` after start.
:::

## Beyond the curated surface

Advanced users can import the full API from `@denex/network-manager`, including `CantonClient`,
`ValidatorAdminClient`, generators, schemas, Docker helpers, and discovery utilities.

## Next

Wrapping an instance in a one-command dev stack for your own application — reusing a live instance,
connecting per participant, waiting for readiness, and serving a UI per validator — is covered in
[Building a dev stack](/denex-network-manager/guides/dev-stack/).
