import { assertEquals, assertExists } from '@std/assert';
import {
  createTestDockerClient,
  generateTestInstanceId,
  cleanupTestResources,
  isDockerAvailable,
} from './helpers.ts';
import { LocalNet } from '../../src/localnet.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

const TEST_CONFIG: LocalNetConfig = {
  validators: [
    {
      name: 'validator-1',
      users: [
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
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

Deno.test({
  name: 'E2E: LocalNet initializes parties and users for multiple validators',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const localnet = new LocalNet(TEST_CONFIG, { instanceId });

    try {
      const messages: string[] = [];
      await localnet.start({
        timeout: 600000,
        onProgress: (msg) => messages.push(msg),
      });

      assertEquals(localnet.currentState, 'running');

      const initMessages = messages.filter((m) => m.includes('Initializing') || m.includes('party') || m.includes('user'));
      console.log('Initialization messages:', initMessages);

      const v1State = await localnet.getValidatorState('validator-1');
      assertExists(v1State.validatorParty, 'validator-1 should have a party');
      console.log('Validator-1 party:', v1State.validatorParty);

      const v2State = await localnet.getValidatorState('validator-2');
      assertExists(v2State.validatorParty, 'validator-2 should have a party');
      console.log('Validator-2 party:', v2State.validatorParty);

      const parties = await localnet.getParties();
      console.log('All parties:', parties.map((p) => ({ hint: p.hint, validator: p.validator })));

    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});

Deno.test({
  name: 'E2E: getDsoPartyId returns the DSO party after LocalNet starts',
  ignore: !(await isDockerAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createTestDockerClient();
    const instanceId = generateTestInstanceId();
    const simpleConfig: LocalNetConfig = {
      validators: 1,
     auth: {
       keycloak: {
         admin: 'admin',
         password: 'admin',
       },
     },
    };
    const localnet = new LocalNet(simpleConfig, { instanceId });

    try {
      await localnet.start({ timeout: 600000 });

      const dsoPartyId = await localnet.getDsoPartyId();

      assertExists(dsoPartyId, 'DSO party ID should exist');
      console.log('DSO Party ID:', dsoPartyId);

    } finally {
      await localnet.destroy({ removeVolumes: true });
      await cleanupTestResources(client, instanceId);
    }
  },
});
