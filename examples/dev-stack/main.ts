/**
 * A minimal one-command dev stack over a LocalNet instance.
 *
 * Demonstrates the lifecycle an application's own `dev:up` script needs:
 *
 *   1. reuse a live instance instead of rebuilding it — gating on liveness,
 *      not on whether its containers merely exist
 *   2. take ONE environment snapshot and thread it through every later step
 *   3. discover which participant hosts each party, and connect per participant
 *   4. wait on a real API response rather than a TCP connect
 *
 * Run it:
 *
 *   deno run -A examples/dev-stack/main.ts          # start (or reuse) and report
 *   deno run -A examples/dev-stack/main.ts --down   # destroy the instance
 *
 * See docs/dev-stack-guide.md for why each step is shaped this way.
 */
import { LocalNet, LocalNetBuilder } from '../../src/sdk/mod.ts';

/** Instance id namespaces every container, so it is what makes instances independent. */
const INSTANCE_ID = 'devstack-example';

/**
 * Two validators, so the multi-participant behaviour is visible. `alice` and
 * `bob` are hosted by `app`; `ops` hosts its own operator party.
 *
 * basePort is deliberately away from the 5000 default so this can run beside
 * another instance.
 */
const config = LocalNetBuilder.create()
  .addValidator('app', {
    parties: ['alice', 'bob'],
    users: [
      { id: 'alice', primaryParty: 'alice' },
      { id: 'bob', primaryParty: 'bob' },
    ],
  })
  .addValidator('ops', {
    parties: ['operator'],
    users: [{ id: 'operator', primaryParty: 'operator' }],
  })
  .withBasePort(8100)
  .withAuth('admin', 'admin')
  .build();

/**
 * Attach to a LIVE instance, or return null.
 *
 * `fromInstanceId` is an existence check, not a liveness check: it throws only
 * when no container carries the instance label at all. A cleanly stopped
 * instance still has its containers, so it attaches — and then reports itself
 * as running. Hence the explicit `isRunning()` gate.
 *
 * Only "nothing there yet" is an ordinary first-run outcome. A schema mismatch,
 * a missing config label, and an unreachable Docker socket all surface as
 * throws here too, each with a message worth showing the user, so they are
 * re-thrown rather than swallowed.
 */
async function attachIfLive(): Promise<LocalNet | null> {
  try {
    const net = await LocalNet.fromInstanceId(INSTANCE_ID);
    return (await net.isRunning()) ? net : null;
  } catch (err) {
    if (!String(err).includes('No running LocalNet found')) throw err;
    return null;
  }
}

/**
 * Attach to an instance whose containers exist in any state.
 *
 * `destroy()` works on stopped containers, so teardown wants existence rather
 * than liveness — the stricter gate above would skip a stopped instance and
 * leave it on disk.
 */
async function attachIfPresent(): Promise<LocalNet | null> {
  try {
    return await LocalNet.fromInstanceId(INSTANCE_ID);
  } catch (err) {
    if (!String(err).includes('No running LocalNet found')) throw err;
    return null;
  }
}

/** A client-credentials token for one validator's service account. */
async function serviceToken(auth: {
  keycloakTokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
}): Promise<string> {
  const res = await fetch(auth.keycloakTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      audience: auth.audience,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

/** The `sub` claim, which Canton maps to the ledger user id. */
function subjectOf(token: string): string {
  const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4);
  return JSON.parse(atob(padded)).sub;
}

/**
 * Poll until a validator's ledger API answers a real request.
 *
 * A TCP connect is not a readiness signal for anything behind Docker: the
 * userland proxy accepts connections on a published port before the process
 * inside binds it, so `Deno.connect` succeeds against a container that is not
 * yet listening. Only a real response proves the API is up.
 */
async function waitForLedgerApi(jsonApi: string, token: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${jsonApi}/v2/version`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await res.body?.cancel();
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
      await res.body?.cancel();
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${jsonApi} not ready after ${timeoutMs / 1000}s: ${lastError}`);
}

/** Rights the service account holds ON THIS participant. */
async function rightsOn(
  jsonApi: string,
  token: string,
  userId: string,
): Promise<{ kind: string; party: string }[]> {
  const res = await fetch(`${jsonApi}/v2/users/${encodeURIComponent(userId)}/rights`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Rights lookup failed (${res.status})`);
  const body = await res.json();
  // deno-lint-ignore no-explicit-any
  return (body.rights ?? []).map((r: any) => {
    const kind = Object.keys(r.kind ?? {})[0] ?? 'unknown';
    return { kind, party: r.kind?.[kind]?.value?.party ?? '' };
  });
}

if (import.meta.main) {
  if (Deno.args.includes('--down')) {
    const present = await attachIfPresent();
    if (!present) {
      console.log(`No instance '${INSTANCE_ID}' found.`);
      Deno.exit(0);
    }
    // Containers outlive the process that started them, so teardown is always
    // explicit. Nothing reaps them when this script exits.
    await present.destroy();
    console.log(`Destroyed '${INSTANCE_ID}'.`);
    Deno.exit(0);
  }

  // ── Reuse or start ────────────────────────────────────────────────────────
  // Rebuilding a healthy instance costs minutes and discards ledger state, so
  // an idempotent dev script should always check first. Note this branch is
  // also reached for a merely STOPPED instance, where start() restarts the
  // existing containers and keeps the Postgres volume — seconds, not minutes.
  let net = await attachIfLive();
  if (net) {
    console.log(`Reusing live instance '${INSTANCE_ID}'.`);
  } else {
    console.log(`Starting '${INSTANCE_ID}' (a cold first run takes several minutes)...`);
    net = await LocalNet.fromConfig(config, { instanceId: INSTANCE_ID });
    await net.start({ onProgress: (m: string) => console.log(`  ${m}`) });
  }

  // ── One snapshot, threaded everywhere ─────────────────────────────────────
  // Endpoints, realms, secrets and party ids all come from this single object.
  // Re-querying per step invites two halves of the script disagreeing.
  const env = await net.getEnvironment();

  // Note there are always at least two participants: the Super Validator is
  // created automatically alongside the validators you declare.
  console.log(`\nParticipants: ${Object.keys(env.validators).join(', ')}`);

  // ── Party ids are network-wide; hosting is not ────────────────────────────
  // `env.parties` lists a party once per validator that can SEE it, with the
  // same id each time. Visibility is not permission to submit as that party —
  // which participant hosts it is what decides that.
  // `partyId` is nullable: a party can be declared in config but not yet
  // allocated on the ledger, so skip those rather than recording a null id.
  const partyIds = new Map<string, string>();
  for (const p of env.parties ?? []) {
    if (p.partyId) partyIds.set(p.hint, p.partyId);
  }
  console.log(`Parties: ${[...partyIds.keys()].join(', ')}`);

  // ── Connect per participant, and show what each may act as ────────────────
  // A submission is only accepted by the participant hosting the submitting
  // party, and rights are granted per participant. So a dev script that opens
  // one connection and submits as everyone through it breaks as soon as a
  // second validator exists.
  for (const [name, v] of Object.entries(env.validators)) {
    const token = await serviceToken(v.auth);
    const userId = subjectOf(token);
    await waitForLedgerApi(v.endpoints.jsonApi, token);

    const rights = await rightsOn(v.endpoints.jsonApi, token, userId);
    const actAs = rights
      .filter((r) => r.kind === 'CanActAs')
      .map((r) => r.party.split('::')[0]);

    console.log(`\n  ${name}`);
    console.log(`    ledger API : ${v.endpoints.jsonApi}`);
    console.log(`    user       : ${userId}`);
    console.log(`    can act as : ${actAs.join(', ') || '(none)'}`);
  }

  console.log(
    `\nDone. Tear down with: deno run -A examples/dev-stack/main.ts --down`,
  );
}
