/**
 * Shared LocalNets: one start per network per integration group instead of one per test.
 *
 * `run_group.ts` starts a group's shared networks once, runs the group's test files with each
 * network's instance id in {@link sharedNetworkEnv}, and destroys the networks in `finally`. A
 * test takes a network with {@link acquireSharedLocalNet} and hands it back with
 * {@link releaseSharedLocalNet}; on a shared network the release does nothing, so a test never
 * stops or destroys it. Without the group runner (a plain `deno test <file>`), each test gets a
 * network of its own with the same config and start options, and the release destroys it.
 *
 * Rules for a test on a shared network:
 * - validator names are the test's own, as before it shared: dnm derives realm names,
 *   wallet-admin ids and hostnames from them;
 * - every name it creates (user id, party hint) is unique to the test, and every config entry it
 *   reads below is used by that test file only;
 * - it does not stop, kill, destroy, resume, initialize or break any part of the network. Tests
 *   that do keep a network of their own.
 *
 * The group's tests run one at a time (run_group.ts refuses `--parallel`): two tests compare
 * counts of a whole listing before and after one call, and they are exact only because no
 * neighbour runs in between.
 */

import { LocalNet } from '../../src/localnet.ts';
import type { StartOptions } from '../../src/docker/types.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import {
  cleanupTestResources,
  createTestDockerClient,
  generateTestInstanceId,
  testConfig,
} from './helpers.ts';

/**
 * One validator, `validator-1`, on the default base port. Config entries by test file:
 * - `auth-*`: auth_confidence_test.ts
 * - `ops*`: operator_apis_test.ts
 * splice_version_test.ts reads the topology only.
 */
const S1: LocalNetConfig = testConfig({
  validators: [{
    name: 'validator-1',
    users: [
      { id: 'auth-admin-user', rights: ['ParticipantAdmin'] },
      { id: `ops.${'a'.repeat(100)}@corp.example`, primaryParty: 'opsparty' }, // 117 characters
      { id: 'ops-plain' },
    ],
  }],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

/**
 * Two validators, `validator-1` and `validator-2`, on the default base port (wallet_ui_test.ts
 * opens validator-1's wallet on 5180). Config entries by test file:
 * - `wal-*`: wallet_ui_test.ts
 * - `test-user-*`: transfer_test.ts
 * runtime_user_test.ts creates its own `rt-*` users and parties at run time.
 */
const S2: LocalNetConfig = testConfig({
  validators: [
    {
      name: 'validator-1',
      parties: [{ hint: 'wal-bob' }],
      users: [
        { id: 'wal-bob', primaryParty: 'wal-bob' },
        { id: 'test-user-1', primaryParty: 'validator-1', rights: ['CanActAs', 'CanReadAs'] },
      ],
    },
    {
      name: 'validator-2',
      users: [
        { id: 'test-user-2', primaryParty: 'validator-2', rights: ['CanActAs', 'CanReadAs'] },
      ],
    },
  ],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

/**
 * The validators of the tests that read what initialization did, under their own names, on the
 * default base port. `val1` is first, at port index 0, where entitlements_test.ts looks for it.
 * Config entries by test:
 * - `ent-*` (val1): entitlements_test.ts. ent-auto-party is deliberately not a top-level party
 *   anywhere: it exists only because ent-multi-user references it.
 * - `onb-*` (val1): initialization "users from config …" tests.
 * - `idem-*` (val1, val2): initialization "initializeResources is idempotent".
 * - alice and bob, with no users: initialization "parties from config are allocated" and
 *   "parties are allocated before users".
 */
const INIT: LocalNetConfig = testConfig({
  validators: [
    {
      name: 'val1',
      parties: [
        { hint: 'ent-alice', displayName: 'Alice' },
        { hint: 'ent-bob', displayName: 'Bob' },
        { hint: 'onb-alice', displayName: 'Alice' },
        { hint: 'idem-shared', displayName: 'Shared 1' },
      ],
      users: [
        {
          id: 'ent-alice-user',
          primaryParty: 'ent-alice',
          parties: [{ hint: 'ent-bob', rights: ['CanReadAs'] }],
        },
        { id: 'ent-admin-user', rights: ['ParticipantAdmin'] },
        {
          id: 'ent-multi-user',
          primaryParty: 'ent-alice',
          parties: [
            { hint: 'ent-bob' }, // defaults to CanActAs
            { hint: 'ent-auto-party' }, // not a top-level party: allocated for this user
          ],
        },
        { id: 'onb-alice-user', primaryParty: 'onb-alice', rights: ['CanActAs', 'CanReadAs'] },
        { id: 'onb-admin-user', primaryParty: 'val1', rights: ['CanActAs', 'CanReadAs'] },
        { id: 'idem-user-1', primaryParty: 'idem-shared', rights: ['CanActAs', 'CanReadAs'] },
      ],
    },
    {
      name: 'val2',
      parties: [{ hint: 'idem-shared', displayName: 'Shared 2' }],
      users: [
        { id: 'idem-user-2', primaryParty: 'idem-shared', rights: ['CanActAs', 'CanReadAs'] },
      ],
    },
    {
      name: 'alice',
      parties: [
        { hint: 'alice', displayName: 'Alice' },
        { hint: 'alice-bot', displayName: 'Alice Bot' },
      ],
    },
    {
      name: 'bob',
      parties: [{ hint: 'bob', displayName: 'Bob' }],
    },
  ],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

/**
 * Started with skipInitialization, and nothing initializes it. Base port 8000, clear of INIT,
 * which is up at the same time. Users:
 * - alice and bob, with initialization's party-allocation config: initialization
 *   "skipInitialization prevents party/user creation";
 * - validator-1, no entries: keycloak_master_realm_test.ts (the Validator1 realm, and the
 *   bootstrap admin deleted by a start that skips initialization).
 */
const SKIP: LocalNetConfig = testConfig({
  basePort: 8000,
  validators: [
    {
      name: 'alice',
      parties: [
        { hint: 'alice', displayName: 'Alice' },
        { hint: 'alice-bot', displayName: 'Alice Bot' },
      ],
    },
    {
      name: 'bob',
      parties: [{ hint: 'bob', displayName: 'Bob' }],
    },
    { name: 'validator-1' },
  ],
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
});

/** The shared networks, by name. */
export const SHARED_NETWORKS = { S1, S2, INIT, SKIP } as const;

export type SharedNetworkName = keyof typeof SHARED_NETWORKS;

/** How each shared network is started; the default is a full start with initialization. */
export const SHARED_START_OPTIONS: Partial<Record<SharedNetworkName, StartOptions>> = {
  SKIP: { skipInitialization: true },
};

/** The environment variable that carries a shared network's instance id to the test files. */
export function sharedNetworkEnv(name: SharedNetworkName): string {
  return `DNM_TEST_SHARED_${name}`;
}

/** A shared network that the group runner should have started is not there to use. */
export class SharedLocalNetUnavailableError extends Error {
  constructor(readonly network: SharedNetworkName, readonly instanceId: string, reason: string) {
    super(`shared LocalNet ${network} (${instanceId}) ${reason}`);
    this.name = 'SharedLocalNetUnavailableError';
  }
}

/** Networks a test started itself (no group runner), which its release destroys. */
const owned = new WeakSet<LocalNet>();

/**
 * The shared network `name`, attached: fully running, with this config. Without the group
 * runner, a fresh network of this test's own with the same config and start options.
 *
 * Call it before the test's `try`, and release the network in that `try`'s `finally`. A failed
 * fresh start rolls back what it created, so there is nothing to release then.
 *
 * @throws SharedLocalNetUnavailableError if the runner's network is not fully running.
 */
export async function acquireSharedLocalNet(name: SharedNetworkName): Promise<LocalNet> {
  const config = SHARED_NETWORKS[name];
  const instanceId = Deno.env.get(sharedNetworkEnv(name));

  if (instanceId === undefined) {
    const net = new LocalNet(config, { instanceId: generateTestInstanceId() });
    await net.start(SHARED_START_OPTIONS[name]);
    owned.add(net);
    return net;
  }

  const net = new LocalNet(config, { instanceId });
  const state = await net.state();
  if (state !== 'running') {
    throw new SharedLocalNetUnavailableError(name, instanceId, `is ${state}, not running`);
  }
  // Every container runs and the stored config matches (a mismatch throws), so this attaches
  // and changes nothing.
  await net.start();
  return net;
}

/** Hands a network back: destroys one this test started itself, leaves a shared one alone. */
export async function releaseSharedLocalNet(net: LocalNet): Promise<void> {
  if (!owned.has(net)) return;
  owned.delete(net);
  await net.destroy({ removeVolumes: true }).catch(() => {});
  await cleanupTestResources(createTestDockerClient(), net.instanceId);
}
