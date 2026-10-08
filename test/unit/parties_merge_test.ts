import { assertEquals } from '@std/assert';
import type { PartyDetails } from '../../src/api/canton.ts';
import { type HostedParties, mergeHostedParties } from '../../src/api/parties.ts';

function party(id: string, displayName?: string): PartyDetails {
  return {
    party: id,
    isLocal: true,
    localMetadata: displayName ? { annotations: { displayName } } : undefined,
  };
}

function ok(
  participantId: string,
  ...parties: PartyDetails[]
): PromiseFulfilledResult<HostedParties> {
  return { status: 'fulfilled', value: { participantId, parties } };
}

function failed(message: string): PromiseRejectedResult {
  return { status: 'rejected', reason: new Error(message) };
}

const NAMES = ['sv', 'validator-1', 'validator-2'];

Deno.test('mergeHostedParties - disjoint hosts give the union in canonical order', () => {
  const { parties, failures } = mergeHostedParties(NAMES, [
    ok('PAR::sv::1', party('DSO::1')),
    ok('PAR::v1::2', party('alice::2'), party('bob::2')),
    ok('PAR::v2::3', party('carol::3')),
  ]);
  assertEquals(failures, []);
  assertEquals(parties.map((p) => [p.party.party, p.validator, p.participantId]), [
    ['DSO::1', 'sv', 'PAR::sv::1'],
    ['alice::2', 'validator-1', 'PAR::v1::2'],
    ['bob::2', 'validator-1', 'PAR::v1::2'],
    ['carol::3', 'validator-2', 'PAR::v2::3'],
  ]);
});

Deno.test('mergeHostedParties - a multi-hosted party appears once, under the first host', () => {
  const { parties } = mergeHostedParties(NAMES, [
    ok('PAR::sv::1', party('shared::9')),
    ok('PAR::v1::2'),
    ok('PAR::v2::3', party('shared::9', 'Shared')),
  ]);
  assertEquals(parties.length, 1);
  assertEquals(parties[0].validator, 'sv');
  assertEquals(parties[0].participantId, 'PAR::sv::1');
  assertEquals(parties[0].hosts, ['sv', 'validator-2']);
  assertEquals(parties[0].party.localMetadata?.annotations?.displayName, 'Shared');
});

Deno.test('mergeHostedParties - the first host real annotation wins', () => {
  const { parties } = mergeHostedParties(NAMES, [
    ok('PAR::sv::1', party('shared::9', 'First')),
    ok('PAR::v1::2', party('shared::9', 'Second')),
    ok('PAR::v2::3'),
  ]);
  assertEquals(parties[0].party.localMetadata?.annotations?.displayName, 'First');
});

Deno.test('mergeHostedParties - a rejected host is omitted and listed in failures', () => {
  const { parties, failures } = mergeHostedParties(NAMES, [
    ok('PAR::sv::1', party('DSO::1')),
    failed('connection refused'),
    ok('PAR::v2::3', party('carol::3')),
  ]);
  assertEquals(parties.map((p) => p.party.party), ['DSO::1', 'carol::3']);
  assertEquals(failures, [{ validator: 'validator-1', error: 'connection refused' }]);
});

Deno.test('mergeHostedParties - all rejected gives no parties and a failure per host', () => {
  const { parties, failures } = mergeHostedParties(NAMES, [
    failed('a'),
    failed('b'),
    { status: 'rejected', reason: 'plain string' },
  ]);
  assertEquals(parties, []);
  assertEquals(failures, [
    { validator: 'sv', error: 'a' },
    { validator: 'validator-1', error: 'b' },
    { validator: 'validator-2', error: 'plain string' },
  ]);
});

Deno.test('mergeHostedParties - party ids keep the full text; hint is the part before ::', () => {
  const { parties } = mergeHostedParties(['sv'], [ok('PAR::sv::1', party('app-operator::1220ff'))]);
  assertEquals(parties[0].party.party.split('::')[0], 'app-operator');
});
