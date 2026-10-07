---
title: Port allocation
description: How LocalNet assigns host ports from basePort, and how to run several instances side by side.
---

Ports derive from `basePort` with `+100` increments per validator. The Super Validator takes the first
block:

| Service             | SV   | Validator 1 | Validator 2 |
| ------------------- | ---- | ----------- | ----------- |
| HTTP health         | 5000 | 5100        | 5200        |
| Ledger API          | 5001 | 5101        | 5201        |
| Admin API           | 5002 | 5102        | 5202        |
| Validator Admin API | 5003 | 5103        | 5203        |
| gRPC                | 5061 | 5161        | 5261        |
| JSON API            | 5075 | 5175        | 5275        |
| Web UI              | 5080 | 5180        | 5280        |
| Keycloak            | 5082 | —           | —           |

With `basePort: 6000`, the same layout starts at `6000`, `6100`, `6200`, and so on.

Two SV ports are published to the host in addition to the block above, and they are also
`basePort`-relative:

| Service    | Offset        | Default |
| ---------- | ------------- | ------- |
| Scan Admin | `basePort+12` | 5012    |
| SV Admin   | `basePort+14` | 5014    |

The sequencer and mediator ports are container-internal only, so they stay fixed regardless of
`basePort` — instances never collide on them because each gets its own Docker network. See
[Architecture](/denex-network-manager/how-it-works/architecture/) for the full breakdown.

## Running several instances

Leave room between instances. A three-validator network occupies roughly `basePort` through
`basePort + 400`, so spacing instances 500 apart is comfortable:

```typescript
const appCfg = LocalNetBuilder.create()
  .addValidator('app', {/* ... */}).withBasePort(8100).build();
const app = await LocalNet.fromConfig(appCfg, { instanceId: 'app-stack' });

const opsCfg = LocalNetBuilder.create()
  .addValidator('ops', {/* ... */}).withBasePort(8600).build();
const ops = await LocalNet.fromConfig(opsCfg, { instanceId: 'ops-stack' });
```

:::caution
Both the `instanceId` **and** the `basePort` have to differ. Varying only `basePort` leaves both
configs on `instanceId: 'default'`; identical configs then attach to the first instance and return
successfully, giving you one network where you expected two. See
[Running more than one instance](/denex-network-manager/guides/dev-stack/#running-more-than-one-instance).
:::

`dnm instances` lists everything currently running, and `basePort` is recorded in each instance's
Docker labels so `LocalNet.fromInstanceId()` recovers it without a config file.
