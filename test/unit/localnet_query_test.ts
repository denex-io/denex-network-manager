import { assert, assertEquals, assertRejects } from '@std/assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNet } from '../../src/localnet.ts';
import type { CantonClient, PartyDetails, UserDetails } from '../../src/api/canton.ts';
import type { ApiUserRight } from '../../src/api/canton.ts';
import type { ApiValidatorState } from '../../src/api/state-types.ts';
import type { LocalNetWarning } from '../../src/types/state.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';

interface FakeClientSpec {
  participantId: string;
  parties?: PartyDetails[];
  users?: UserDetails[];
  rights?: Record<string, ApiUserRight[] | Error>;
  packages?: string[];
  /** When set, every query rejects with this error. */
  down?: string;
}

class FakeCantonClient {
  calls: string[] = [];
  allocated: string[] = [];
  constructor(private spec: FakeClientSpec) {}

  private guard(name: string): void {
    this.calls.push(name);
    if (this.spec.down) throw new Error(this.spec.down);
  }
  getParticipantId(): Promise<string> {
    this.guard('getParticipantId');
    return Promise.resolve(this.spec.participantId);
  }
  listParties(): Promise<PartyDetails[]> {
    this.guard('listParties');
    return Promise.resolve(this.spec.parties ?? []);
  }
  listUsers(): Promise<UserDetails[]> {
    this.guard('listUsers');
    return Promise.resolve(this.spec.users ?? []);
  }
  listApiUserRights(userId: string): Promise<ApiUserRight[]> {
    this.guard('listApiUserRights');
    const rights = this.spec.rights?.[userId] ?? [];
    return rights instanceof Error ? Promise.reject(rights) : Promise.resolve(rights);
  }
  listPackages(): Promise<string[]> {
    this.guard('listPackages');
    return Promise.resolve(this.spec.packages ?? []);
  }
  allocateParty(hint: string): Promise<PartyDetails> {
    this.allocated.push(hint);
    return Promise.resolve({ party: `${hint}::new`, isLocal: true });
  }
  /** Records the primary party and stops createUser right after hint resolution. */
  createdWith: Array<string | undefined> = [];
  getUser(): Promise<UserDetails> {
    return Promise.reject(new Error('not found'));
  }
  createUser(_userId: string, primaryPartyId?: string): Promise<UserDetails> {
    this.createdWith.push(primaryPartyId);
    return Promise.reject(new Error('stop after resolution'));
  }
}

interface Harness {
  net: LocalNet;
  warnings: LocalNetWarning[];
  fakes: Record<string, FakeCantonClient>;
}

/** A running-looking LocalNet (sv, validator-1, validator-2) whose Canton clients are fakes. */
function harness(specs: Record<string, FakeClientSpec>): Harness {
  const warnings: LocalNetWarning[] = [];
  const net = new LocalNet(createMinimalConfig(2), {
    instanceId: 't-query-' + crypto.randomUUID(),
    onWarning: (w) => warnings.push(w),
  });
  const internals = net as unknown as {
    attachedToRunning: boolean;
    cantonClients: Map<string, CantonClient>;
    validatorClients: Map<string, unknown>;
  };
  internals.attachedToRunning = true;
  for (const name of Object.keys(specs)) internals.validatorClients.set(name, {});
  const fakes: Record<string, FakeCantonClient> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const fake = new FakeCantonClient(spec);
    fakes[name] = fake;
    internals.cantonClients.set(name, fake as unknown as CantonClient);
  }
  return { net, warnings, fakes };
}

const hosted = (id: string, displayName?: string): PartyDetails => ({
  party: id,
  isLocal: true,
  localMetadata: displayName ? { annotations: { displayName } } : undefined,
});
const remote = (id: string): PartyDetails => ({ party: id, isLocal: false });

function threeNodes(overrides: Partial<Record<string, Partial<FakeClientSpec>>> = {}) {
  return {
    sv: {
      participantId: 'PAR::sv::aa',
      parties: [hosted('DSO::aa'), remote('alice::bb')],
      ...overrides.sv,
    },
    'validator-1': {
      participantId: 'PAR::validator-1::bb',
      parties: [remote('DSO::aa'), hosted('alice::bb', 'Alice')],
      ...overrides['validator-1'],
    },
    'validator-2': {
      participantId: 'PAR::validator-2::cc',
      parties: [remote('alice::bb'), hosted('carol::cc')],
      ...overrides['validator-2'],
    },
  };
}

Deno.test('getParties - lists each hosted party once under its host', async () => {
  const { net, warnings } = harness(threeNodes());
  const parties = await net.getParties();
  assertEquals(
    parties.map((p) => [p.partyId, p.validator, p.participantId, p.displayName]),
    [
      ['DSO::aa', 'sv', 'PAR::sv::aa', 'DSO'],
      ['alice::bb', 'validator-1', 'PAR::validator-1::bb', 'Alice'],
      ['carol::cc', 'validator-2', 'PAR::validator-2::cc', 'carol'],
    ],
  );
  assertEquals(warnings, []);
  assert(!('isLocal' in parties[0]));
});

Deno.test('getParties(name) - only parties hosted on that validator', async () => {
  const { net } = harness(threeNodes());
  assertEquals((await net.getParties('validator-1')).map((p) => p.hint), ['alice']);
  assertEquals((await net.getParties('sv')).map((p) => p.hint), ['DSO']);
});

Deno.test('getParties(name) - unknown or failing validator throws', async () => {
  const { net } = harness(threeNodes({ 'validator-2': { down: 'boom' } }));
  await assertRejects(() => net.getParties('nope'), Error, 'Unknown validator: nope');
  await assertRejects(() => net.getParties('validator-2'), Error, 'boom');
});

Deno.test('getParties - partial failure returns the others and warns once naming the validator', async () => {
  const { net, warnings } = harness(threeNodes({ 'validator-2': { down: 'connection refused' } }));
  const parties = await net.getParties();
  assertEquals(parties.map((p) => p.hint), ['DSO', 'alice']);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].source, 'query');
  assertEquals(warnings[0].validator, 'validator-2');
  assertEquals(
    warnings[0].message,
    'Could not list parties on validator-2: connection refused; its parties are omitted',
  );

  // The failure is not cached: it is queried and warned about again on the next call,
  // while the successes are served from cache.
  await net.getParties();
  assertEquals(warnings.length, 2);
});

Deno.test('getParties - warns again after a cache miss', async () => {
  const { net, warnings, fakes } = harness(threeNodes({ 'validator-2': { down: 'x' } }));
  await net.getParties();
  (net as unknown as { apiCache: Map<string, unknown> }).apiCache.clear();
  await net.getParties();
  assertEquals(warnings.length, 2);
  assertEquals(fakes['validator-1'].calls.filter((c) => c === 'listParties').length, 2);
});

Deno.test('getParties - throws when no participant responds', async () => {
  const { net } = harness(
    threeNodes({ sv: { down: 'a' }, 'validator-1': { down: 'b' }, 'validator-2': { down: 'c' } }),
  );
  await assertRejects(
    () => net.getParties(),
    Error,
    'Could not list parties: no participant responded (sv: a; validator-1: b; validator-2: c)',
  );
});

Deno.test('getPackages - one row per package with its validators, sorted', async () => {
  const { net } = harness({
    sv: { participantId: 'p', packages: ['bb', 'aa'] },
    'validator-1': { participantId: 'p', packages: ['cc', 'aa'] },
    'validator-2': { participantId: 'p', packages: [] },
  });
  assertEquals(await net.getPackages(), [
    { packageId: 'aa', validators: ['sv', 'validator-1'] },
    { packageId: 'bb', validators: ['sv'] },
    { packageId: 'cc', validators: ['validator-1'] },
  ]);
  assertEquals(await net.getPackages('validator-1'), [
    { packageId: 'aa', validators: ['validator-1'] },
    { packageId: 'cc', validators: ['validator-1'] },
  ]);
});

Deno.test('getPackages - partial failure warns once; named failure and unknown name throw', async () => {
  const { net, warnings } = harness({
    sv: { participantId: 'p', packages: ['aa'] },
    'validator-1': { participantId: 'p', packages: ['aa'] },
    'validator-2': { participantId: 'p', down: 'unreachable!' },
  });
  assertEquals(await net.getPackages(), [{ packageId: 'aa', validators: ['sv', 'validator-1'] }]);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].validator, 'validator-2');
  assertEquals(
    warnings[0].message,
    'Could not list packages on validator-2: unreachable!; its packages are omitted',
  );
  await assertRejects(() => net.getPackages('validator-2'), Error, 'unreachable!');
  await assertRejects(() => net.getPackages('nope'), Error, 'Unknown validator: nope');
});

const userOf = (id: string): UserDetails => ({ id, isDeactivated: false });

Deno.test('getUsersWithRights - partial failure returns the others and retries the failed validator', async () => {
  const { net, warnings, fakes } = harness({
    sv: { participantId: 'p', users: [userOf('sv-admin')] },
    'validator-1': { participantId: 'p', users: [userOf('u1')] },
    'validator-2': { participantId: 'p', down: 'no route' },
  });
  const users = await net.getUsersWithRights();
  assertEquals(users.map((u) => `${u.validator}:${u.id}`), ['sv:sv-admin', 'validator-1:u1']);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].validator, 'validator-2');
  assertEquals(
    warnings[0].message,
    'Could not list users on validator-2: no route; its users are omitted',
  );

  await net.getUsersWithRights();
  assertEquals(warnings.length, 2);
  assertEquals(fakes['validator-2'].calls.filter((c) => c === 'listUsers').length, 2);
  assertEquals(fakes['validator-1'].calls.filter((c) => c === 'listUsers').length, 1);
});

Deno.test('getUsersWithRights - all rejected throws; unknown name throws', async () => {
  const { net, warnings } = harness({
    sv: { participantId: 'p', down: 'a' },
    'validator-1': { participantId: 'p', down: 'b' },
    'validator-2': { participantId: 'p', down: 'c' },
  });
  await assertRejects(
    () => net.getUsersWithRights(),
    Error,
    'Could not list users: no participant responded (sv: a; validator-1: b; validator-2: c)',
  );
  assertEquals(warnings.length, 0, 'total failure throws without warnings');
  await assertRejects(() => net.getUsersWithRights('nope'), Error, 'Unknown validator: nope');
  await assertRejects(() => net.getUsersWithRights('sv'), Error, 'a');
});

Deno.test('getUsersWithRights - a failed rights query lists the user with no rights and warns', async () => {
  const { net, warnings } = harness({
    sv: { participantId: 'p' },
    'validator-1': {
      participantId: 'p',
      users: [userOf('u1'), userOf('u2')],
      rights: { u1: new Error('rights down') },
    },
    'validator-2': { participantId: 'p' },
  });
  const users = await net.getUsersWithRights();
  assertEquals(users.map((u) => [u.id, u.rights.length]), [['u1', 0], ['u2', 0]]);
  assertEquals(warnings.length, 1);
  assertEquals(
    warnings[0].message,
    'Could not list rights for u1 on validator-1: rights down; listed with no rights',
  );
});

Deno.test('getUsers(name) - unknown validator throws', async () => {
  const { net } = harness(threeNodes());
  await assertRejects(() => net.getUsers('nope'), Error, 'Unknown validator: nope');
});

Deno.test('getSnapshot - omits a failed validator users with one warning and still returns', async () => {
  const { net, warnings } = harness({
    sv: { participantId: 'p', users: [userOf('sv-admin')], packages: ['aa'] },
    'validator-1': { participantId: 'p', users: [userOf('u1')], packages: ['aa'] },
    'validator-2': { participantId: 'p', down: 'gone' },
  });
  const state = (name: string, isHealthy: boolean): ApiValidatorState => ({
    name,
    role: name === 'sv' ? 'sv' : 'validator',
    participantId: 'p',
    isHealthy,
    ports: { ledgerApi: 0, adminApi: 0, jsonApi: 0, validatorAdminApi: 0 },
  });
  net.getAllValidatorStates = () =>
    Promise.resolve([state('sv', true), state('validator-1', true), state('validator-2', true)]);

  const snapshot = await net.getSnapshot();
  assertEquals(snapshot.users.map((u) => u.id), ['sv-admin', 'u1']);
  assertEquals(snapshot.packages, [{ packageId: 'aa', validators: ['sv', 'validator-1'] }]);
  const usersWarnings = warnings.filter((w) => w.message.startsWith('Could not list users'));
  assertEquals(usersWarnings.length, 1);
  assertEquals(usersWarnings[0].validator, 'validator-2');
});

Deno.test('getSnapshot - an unhealthy validator is reported as omitted', async () => {
  const { net, warnings } = harness(threeNodes());
  net.getAllValidatorStates = () =>
    Promise.resolve([{
      name: 'validator-1',
      role: 'validator',
      participantId: 'p',
      isHealthy: false,
      ports: { ledgerApi: 0, adminApi: 0, jsonApi: 0, validatorAdminApi: 0 },
    }]);
  await net.getSnapshot();
  assertEquals(
    warnings.map((w) => w.message),
    ['Could not list users on validator-1: unhealthy; its users are omitted'],
  );
});

Deno.test('getSnapshot - parties are empty when no participant responds', async () => {
  const { net } = harness(
    threeNodes({ sv: { down: 'a' }, 'validator-1': { down: 'b' }, 'validator-2': { down: 'c' } }),
  );
  net.getAllValidatorStates = () => Promise.resolve([]);
  const snapshot = await net.getSnapshot();
  assertEquals(snapshot.parties, []);
});

Deno.test('createUser - a failing hosted-party query fails the call and allocates nothing', async () => {
  const { net, fakes } = harness(threeNodes({ 'validator-1': { down: 'party query failed' } }));
  await assertRejects(
    () => net.createUser('u1', 'validator-1', { primaryParty: 'alice' }),
    Error,
    'party query failed',
  );
  assertEquals(fakes['validator-1'].allocated, []);
});

Deno.test('uploadDar - rejects an empty or unknown target list and an invalid DAR without any request', async () => {
  const { net, fakes } = harness(threeNodes());
  const dir = await mkdtemp(join(tmpdir(), 'dar-test-'));
  const path = join(dir, 'bad.dar');
  await writeFile(path, 'not a dar');

  await assertRejects(() => net.uploadDar(path, []), Error, 'no target validators');
  await assertRejects(() => net.uploadDar(path, ['nope']), Error, 'Unknown validator: nope');
  await assertRejects(() => net.uploadDar(path, ['sv']), Error, 'Invalid DAR:');
  assertEquals(fakes['sv'].calls, []);
});

Deno.test('createUser - prefers the party in the participant own namespace', async () => {
  const { net, fakes } = harness(threeNodes({
    'validator-1': {
      parties: [hosted('shared::zz'), hosted('shared::bb')],
    },
  }));
  await assertRejects(
    () => net.createUser('u1', 'validator-1', { primaryParty: 'shared' }),
    Error,
    'stop after resolution',
  );
  assertEquals(fakes['validator-1'].createdWith, ['shared::bb']);
  assertEquals(fakes['validator-1'].allocated, []);
});

Deno.test('createUser - a hint hosted only elsewhere is allocated on the home validator', async () => {
  const { net, fakes } = harness(threeNodes());
  // carol is hosted on validator-2 only, and alice::bb is remote on validator-2.
  await assertRejects(
    () => net.createUser('u1', 'validator-1', { primaryParty: 'carol' }),
    Error,
    'stop after resolution',
  );
  assertEquals(fakes['validator-1'].allocated, ['carol']);
  assertEquals(fakes['validator-1'].createdWith, ['carol::new']);
  assertEquals(fakes['validator-2'].allocated, []);
});

Deno.test('createUser - parties hosted elsewhere (isLocal false) are never matched', async () => {
  const { net, fakes } = harness(threeNodes());
  // validator-2 lists alice::bb as remote; validator-2 must allocate its own alice.
  await assertRejects(
    () => net.createUser('u1', 'validator-2', { primaryParty: 'alice' }),
    Error,
    'stop after resolution',
  );
  assertEquals(fakes['validator-2'].allocated, ['alice']);
  assertEquals(fakes['validator-2'].createdWith, ['alice::new']);
});

Deno.test('getUsersWithRights - a partial result is not cached', async () => {
  const { net, fakes, warnings } = harness({
    'validator-1': {
      participantId: 'PAR::validator-1::bb',
      users: [{ id: 'u1' } as UserDetails],
      rights: { u1: new Error('rights down') },
    },
  });
  await net.getUsersWithRights('validator-1');
  await net.getUsersWithRights('validator-1');
  assertEquals(fakes['validator-1'].calls.filter((c) => c === 'listApiUserRights').length, 2);
  assertEquals(warnings.length, 2);
});
