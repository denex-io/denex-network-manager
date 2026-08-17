# Building a Dev Stack on LocalNet

How to wrap a LocalNet instance in a one-command development stack for your own application.

The README covers the SDK surface. This covers what to do with it: the lifecycle a `dev:up` script
needs, how to connect when you have more than one validator, and the handful of behaviours that
cause real trouble if you assume otherwise.

A working version of everything here:

```sh
deno run -A examples/dev-stack/main.ts          # start (or reuse) and report
deno run -A examples/dev-stack/main.ts --down   # destroy
```

## Contents

1. [Instance lifecycle](#instance-lifecycle)
2. [Take one environment snapshot](#take-one-environment-snapshot)
3. [Parties, participants, and rights](#parties-participants-and-rights)
4. [Waiting for readiness](#waiting-for-readiness)
5. [Serving multiple UIs](#serving-multiple-uis)
6. [Running more than one instance](#running-more-than-one-instance)

---

## Instance lifecycle

The `instanceId` prefixes every container name and is the handle for everything afterwards. Pick one
per project and keep it stable:

```typescript
const net = await LocalNet.fromConfig(config, { instanceId: 'my-app' });
await net.start();
```

Containers outlive the process that started them. Nothing reaps them when your script exits, so
teardown is explicit:

```typescript
await net.destroy(); // remove containers, network, and volumes
await net.stop(); // stop containers, keep ledger state
```

A **failed** `start()` is the exception — it cleans up after itself. Worth knowing while debugging:
a crashed bring-up leaves nothing behind, so an empty `docker ps` after a failure is expected, not a
second problem.

### Always try to reuse

A cold start takes minutes; attaching to a running instance takes under a second. Check before you
build.

The check to write is not the obvious one. `fromInstanceId` is an **existence** check, not a
liveness check: it throws only when no container carries the instance label at all. A cleanly
stopped instance still has its containers, so it attaches successfully — and the object it returns
reports itself as running. Gate on `isRunning()`:

```typescript
async function attachIfLive(id: string): Promise<LocalNet | null> {
  try {
    const net = await LocalNet.fromInstanceId(id);
    return (await net.isRunning()) ? net : null;
  } catch (err) {
    // Only "nothing there yet" is ordinary. A schema mismatch, a missing config
    // label, and an unreachable Docker socket all arrive here too, each with an
    // actionable message that a bare `catch {}` would discard.
    if (!String(err).includes('No running LocalNet found')) throw err;
    return null;
  }
}

async function up(id: string): Promise<LocalNet> {
  const live = await attachIfLive(id);
  if (live) return live;

  // Build a FRESH LocalNet. Do not call start() on an object from fromInstanceId.
  const net = await LocalNet.fromConfig(config, { instanceId: id });
  await net.start();
  return net;
}
```

Skipping the liveness gate leaves you with no way forward. Every state method on that object
proceeds against dead ports without raising, and `start()` rejects it as already running. With the
gate, the fall-through path is also the cheap one: `start()` against a stopped instance restarts the
containers that already exist and keeps the Postgres volume, so resuming takes seconds and is
non-destructive rather than a rebuild.

Do not branch on `state() === 'stopped'` to detect this. An instance whose containers have all
exited derives to `'error'`, not `'stopped'`.

Matching on message text is fragile, and deliberately so here — the SDK currently throws plain
`Error`s, so there is nothing else to match on. Typed error subclasses are tracked in
[issue #7](https://github.com/denex-io/denex-network-manager/issues/7); prefer `instanceof` once
they land.

If your stack runs containers of its own, apply the same reuse rule to them: recreating a healthy
one throws away whatever it had cached.

## Take one environment snapshot

`getEnvironment()` returns endpoints, realms, credentials, and party ids together. Call it once and
thread that object through everything downstream:

```typescript
const env = await net.getEnvironment();
await configureApp(env);
await bootstrapUsers(env);
await writeEnvFiles(env);
```

Re-querying per step lets two halves of a bring-up disagree. Party ids change with every fresh
localnet, so a value captured in one step and re-derived in another is a live bug.

## Parties, participants, and rights

The most common source of trouble, and it appears as soon as you add a second validator.

### There are always at least two participants

The Super Validator is created automatically, so a config declaring one validator gives you two
participants:

```
Participants: sv, app
```

### Party ids are network-wide

`env.parties` lists each party once per validator that can see it, with the same `partyId` every
time. Resolving a hint needs no notion of "which validator" — take any entry:

```typescript
const partyIds = new Map<string, string>();
for (const p of env.parties ?? []) {
  if (p.partyId) partyIds.set(p.hint, p.partyId);
}
```

`partyId` is typed `string | null`, so skip empty ones rather than storing a null. Note what absence
means here: `env.parties` is built from a live query, so a party declared in YAML but never
successfully allocated does not appear in the list at all — and the list is empty outright if that
query fails. Absence, not a null id, is the signal to check for.

### Visibility is not permission

Because a party appears under several validators, it is tempting to read `env.parties` as "any of
these validators can act as this party." They cannot. Rights are granted **per participant**, and
each validator has its own service account:

```
sv     can act as : sv, DSO
app    can act as : localnet-app-1, alice, bob
ops    can act as : localnet-ops-2, operator
```

`alice` is listed under all three participants. Only `app` can submit as her.

### One connection per party, against its own participant

Canton accepts a submission only on the participant hosting the submitting party. A script that
opens one ledger connection and submits as everyone through it works with a single validator and
fails as soon as a second exists:

```
NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT
```

If you see that error, the cause is almost always a shared connection rather than a topology
problem. Retrying will not help — resolve each party to its host validator and connect there:

```typescript
// One connection per (party, validator) pair.
const endpointFor = (hint: string, validator: string) => {
  const v = env.validators[validator];
  return {
    party: partyIds.get(hint)!,
    ledgerApiUrl: v.endpoints.ledgerApi,
    auth: v.auth, // realm, client id/secret, and audience are all per validator
  };
};
```

Grants are per participant too: `CanActAs` on one does nothing for another. Setup code that grants
rights has to do so on each participant separately, and is worth making idempotent — read existing
rights first, then grant only what is missing.

## Waiting for readiness

A TCP connect is not a readiness signal for anything behind Docker. The userland proxy accepts
connections on a published port before the process inside binds it, so a port probe reports ready
against a container that is not yet listening — and the next phase then talks to nothing.

Poll a real request instead:

```typescript
async function waitForApi(jsonApi: string, token: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${jsonApi}/v2/version`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await res.body?.cancel();
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${jsonApi} did not become ready`);
}
```

`start()` already waits for its own containers. This matters for containers **you** add, and for the
gap between `start()` returning and your application being able to talk to it.

## Serving multiple UIs

If your stack serves a browser UI per validator so several users can be signed in at once, give each
its own **hostname**, not its own port.

Cookies are scoped by host but not by port ([RFC 6265 §8.5][rfc6265]). Servers on `127.0.0.1:3003`
and `127.0.0.1:3103` share one cookie jar, so signing in as a second user silently replaces the
first session — with no error, just a session that quietly became someone else's.

Distinct hostnames fix it, and `*.localhost` names need no setup on macOS or Linux with
systemd-resolved, since [RFC 6761 §6.3][rfc6761] reserves the TLD for loopback:

```
http://app.localhost:3003    -> its own cookie jar
http://ops.localhost:3103    -> its own cookie jar
```

No `/etc/hosts` entry is required on those platforms. LocalNet relies on this itself — validator web
UIs are published at `wallet.localhost:<port>`.

Resolution is not universal, which is worth a preflight check if your stack might run in CI:

| Platform                                | `*.localhost`          |
| --------------------------------------- | ---------------------- |
| macOS                                   | resolves automatically |
| Linux + systemd-resolved                | resolves automatically |
| Linux, plain glibc (`hosts: files dns`) | does **not** resolve   |
| musl (Alpine)                           | does **not** resolve   |

Neither glibc nor musl implements the RFC 6761 special case, so on those platforms resolution rests
entirely on `/etc/hosts` — which cannot express a wildcard — and on whatever the configured DNS
server does with the name. Plain Alpine typically fails with `EAI_NONAME`. Browsers resolve
`.localhost` themselves, which is the trap: a hostname that works in Chrome can still fail from Node
or Deno running in the same container.

Fail early with the `/etc/hosts` line to add, and offer an env var that falls back to ports for
environments where names are not available — accepting that concurrent sessions stop working there.

The same reasoning covers browser storage: `localStorage` is origin-scoped, so if your app keeps
per-user state there, sharing one origin across users undoes the isolation regardless of cookies.

## Running more than one instance

Instances are independent when both the `instanceId` and the `basePort` differ. Note that `build()`
returns a _config_, not a running instance, and `instanceId` is an option to `LocalNet.fromConfig` —
there is no builder method for it:

```typescript
const appCfg = LocalNetBuilder.create()
  .addValidator('app', {/* ... */}).withBasePort(8100).build();
const app = await LocalNet.fromConfig(appCfg, { instanceId: 'app-stack' });
await app.start();

// and, concurrently:
const opsCfg = LocalNetBuilder.create()
  .addValidator('other', {/* ... */}).withBasePort(8500).build();
const ops = await LocalNet.fromConfig(opsCfg, { instanceId: 'ops-stack' });
await ops.start();
```

Varying `basePort` alone is not enough, and the way it fails is quiet. Omit `instanceId` and both
configs default to `'default'`: if the two configs differ, the second `start()` throws a
config-mismatch error, and if they are identical it **attaches to the first instance and returns
successfully** — leaving one stack where you expected two, with no error to explain the missing one.

Ports advance in `+100` steps per validator, so leave room — a three-validator instance occupies
roughly `basePort` through `basePort + 400`.

Expect a concurrent start to take several minutes and a good number of readiness polls before
`start()` returns. That is normal, not a hang.

---

Behaviour above was observed against `@denex/network-manager@0.1.0-beta.1` on macOS, with one- and
two-validator instances, and re-checked against the SDK source in this repository. Linux behaviour
is per the platform table; confirm it for your own environment if you depend on it.

[rfc6265]: https://datatracker.ietf.org/doc/html/rfc6265#section-8.5
[rfc6761]: https://datatracker.ietf.org/doc/html/rfc6761#section-6.3
