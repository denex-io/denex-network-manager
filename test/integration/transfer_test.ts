import { assertEquals, assertExists } from '@std/assert';
import { isDockerAvailable } from './helpers.ts';
import { acquireSharedLocalNet, releaseSharedLocalNet } from './shared_localnet.ts';

// Both tests run on the shared network S2 (validator-1 and validator-2). The config entries the
// first reads are test-user-1 (primary party validator-1) and test-user-2 (primary party
// validator-2) there (shared_localnet.ts).

Deno.test({
  name: 'E2E: LocalNet initializes parties and users for multiple validators',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('S2');

    try {
      assertEquals(localnet.currentState, 'running');

      const v1State = await localnet.getValidatorState('validator-1');
      assertExists(v1State.validatorParty, 'validator-1 should have a party');
      console.log('Validator-1 party:', v1State.validatorParty);

      const v2State = await localnet.getValidatorState('validator-2');
      assertExists(v2State.validatorParty, 'validator-2 should have a party');
      console.log('Validator-2 party:', v2State.validatorParty);

      const parties = await localnet.getParties();
      console.log('All parties:', parties.map((p) => ({ hint: p.hint, validator: p.validator })));
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});

Deno.test({
  name: 'E2E: getDsoPartyId returns the DSO party after LocalNet starts',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const localnet = await acquireSharedLocalNet('S2');

    try {
      const dsoPartyId = await localnet.getDsoPartyId();

      assertExists(dsoPartyId, 'DSO party ID should exist');
      console.log('DSO Party ID:', dsoPartyId);
    } finally {
      await releaseSharedLocalNet(localnet);
    }
  },
});
