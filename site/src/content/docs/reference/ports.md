---
title: Port allocation
description: How LocalNet assigns host ports from basePort, and how to run several instances side by side.
---

Ports derive from `basePort` with `+100` increments per validator. The Super Validator takes the first
block. These ports are published to the host:

| Service             | Offset | SV   | Validator 1 | Validator 2 |
| ------------------- | ------ | ---- | ----------- | ----------- |
| Ledger API (gRPC)   | +1     | 5001 | 5101        | 5201        |
| Admin API           | +2     | 5002 | 5102        | 5202        |
| Validator Admin API | +3     | 5003 | 5103        | 5203        |
| JSON API (HTTP)     | +75    | 5075 | 5175        | 5275        |
| Web UI              | +80    | 5080 | 5180        | 5280        |
| Keycloak            | +82    | 5082 | —           | —           |

The Ledger API row is gRPC. Use the JSON API row when you need an HTTP endpoint for the ledger.

With `basePort: 6000`, the same layout starts at `6000`, `6100`, `6200`, and so on. Each validator
also has an HTTP health port at `+0` and a gRPC health port at `+61`. They exist inside the
containers for health checks and are not published to the host.

## SV-only ports

The SV also uses a set of ports below `basePort + 100`. They follow `basePort` as well, and none
collides with a validator port. Only Scan Admin and SV Admin are published to the host, on the same
number as inside the container. The rest are container-internal.

| Service                   | Offset | Default | Published |
| ------------------------- | ------ | ------- | --------- |
| Mediator admin            | +7     | 5007    | No        |
| Sequencer public          | +8     | 5008    | No        |
| Sequencer admin           | +9     | 5009    | No        |
| Scan Admin                | +12    | 5012    | Yes       |
| Splice Prometheus metrics | +13    | 5013    | No        |
| SV Admin                  | +14    | 5014    | Yes       |
| Sequencer gRPC health     | +62    | 5062    | No        |
| Mediator gRPC health      | +63    | 5063    | No        |
| Canton Prometheus metrics | +64    | 5064    | No        |

Nothing else listens on the host by default. PostgreSQL is reachable only on the Docker network,
and Nginx listens on the Web UI ports from the first table.

## Port limit

The highest port a network uses is `basePort + 100 × validators + 80`, the Web UI of the last
validator. It must be at most `65535`, so a config that exceeds it is rejected before anything
starts. For example, 55 validators at `basePort: 60000` are rejected. `basePort` itself must be
between `1024` and `60000`.

## Running several instances

Leave room between instances. A three-validator network occupies `basePort` through
`basePort + 380`, so spacing instances 500 apart is comfortable:

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

`dnm instances` lists every instance, whether running, mixed (partly running) or stopped, and `basePort` is recorded in each instance's
Docker labels so `LocalNet.fromInstanceId()` recovers it without a config file.
