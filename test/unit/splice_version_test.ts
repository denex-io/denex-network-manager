// Version selection: which Splice release a config resolves to, which images that pulls, and which
// config shape is generated for it. Every tested release is checked the same way.
import { assertEquals, assertFalse } from '@std/assert';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { generateFullCantonConfig, generateFullSpliceConfig } from '../../src/generator/mod.ts';
import { DEFAULT_SPLICE_VERSION } from '../../src/docker/containers.ts';
import { LocalNet } from '../../src/localnet.ts';
import { TESTED_SPLICE_VERSIONS } from '../../src/utils/splice-version.ts';
import { flattenHocon } from './hocon_flatten.ts';

const SPLICE_REPO = 'ghcr.io/digital-asset/decentralized-canton-sync/docker';

const config = (spliceVersion?: string, validators = 3): LocalNetConfig => ({
  validators,
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
  ...(spliceVersion === undefined ? {} : { spliceVersion }),
});

/** Each Splice app's participant client, with the Admin API port it must point at (basePort 5000). */
const PARTICIPANT_CLIENTS: Array<[string, string]> = [
  ['_validator_backend.participant-client', '5002'],
  ['_sv_participant_client', '5002'],
  ['_validator_1_participant_client', '5102'],
  ['_validator_2_participant_client', '5202'],
  ['_validator_3_participant_client', '5302'],
];

/** The SV app's synchronizer-node clients keep `{ address, port }` at 0.10 too. */
const SYNCHRONIZER_NODE_CLIENTS: Array<[string, string]> = [
  ['canton.sv-apps.sv.local-synchronizer-nodes.current.sequencer.admin-api', '5009'],
  ['canton.sv-apps.sv.local-synchronizer-nodes.current.mediator.admin-api', '5007'],
];

const keysUnder = (flat: Map<string, string>, prefix: string) =>
  [...flat.keys()].filter((k) => k.startsWith(`${prefix}.`));

Deno.test('splice version - the default is 0.9.4 and it is a tested release', () => {
  assertEquals(DEFAULT_SPLICE_VERSION, '0.9.4');
  assertEquals([...TESTED_SPLICE_VERSIONS], ['0.9.4', '0.10.2']);
});

for (const version of TESTED_SPLICE_VERSIONS) {
  Deno.test(`splice version ${version} - every Splice-family image uses the tag`, () => {
    const images = new LocalNet(config(version))['options'].images;
    assertEquals(images.canton, `${SPLICE_REPO}/canton:${version}`);
    assertEquals(images.splice, `${SPLICE_REPO}/splice-app:${version}`);
    assertEquals(images.walletWebUi, `${SPLICE_REPO}/wallet-web-ui:${version}`);
    assertEquals(images.ansWebUi, `${SPLICE_REPO}/ans-web-ui:${version}`);
    assertEquals(images.svWebUi, `${SPLICE_REPO}/sv-web-ui:${version}`);
    assertEquals(images.scanWebUi, `${SPLICE_REPO}/scan-web-ui:${version}`);
  });

  Deno.test(`splice version ${version} - no CometBFT config (removed in Splice 0.10.2)`, () => {
    const flat = flattenHocon(generateFullSpliceConfig(config(version)));
    assertEquals([...flat.keys()].filter((k) => k.includes('comet')), []);
  });

  Deno.test(`splice version ${version} - no traffic projection keys (removed in Canton 3.7.3)`, () => {
    const canton = generateFullCantonConfig(config(version));
    for (const key of ['projection', 'top-up-paymasters', 'initial-top-up-offset']) {
      assertFalse(canton.includes(key), key);
    }
  });

  Deno.test(`splice version ${version} - synchronizer-node clients stay address and port`, () => {
    const flat = flattenHocon(generateFullSpliceConfig(config(version)));
    for (const [client, port] of SYNCHRONIZER_NODE_CLIENTS) {
      assertEquals(keysUnder(flat, client).sort(), [`${client}.address`, `${client}.port`]);
      assertEquals(flat.get(`${client}.address`), 'canton');
      assertEquals(flat.get(`${client}.port`), port);
    }
  });
}

Deno.test('splice version 0.10.2 - participant Admin API clients are client-config + auth-config none', () => {
  const flat = flattenHocon(generateFullSpliceConfig(config('0.10.2')));
  for (const [client, port] of PARTICIPANT_CLIENTS) {
    const api = `${client}.admin-api`;
    assertEquals(keysUnder(flat, api).sort(), [
      `${api}.auth-config.type`,
      `${api}.client-config.address`,
      `${api}.client-config.port`,
    ]);
    assertEquals(flat.get(`${api}.client-config.address`), 'canton');
    assertEquals(flat.get(`${api}.client-config.port`), port);
    assertEquals(flat.get(`${api}.auth-config.type`), '"none"');
  }
});

for (const version of [undefined, '0.9.4']) {
  Deno.test(`splice version ${version ?? 'default'} - participant Admin API clients are address + port`, () => {
    const flat = flattenHocon(generateFullSpliceConfig(config(version)));
    for (const [client, port] of PARTICIPANT_CLIENTS) {
      const api = `${client}.admin-api`;
      assertEquals(keysUnder(flat, api).sort(), [`${api}.address`, `${api}.port`]);
      assertEquals(flat.get(`${api}.address`), 'canton');
      assertEquals(flat.get(`${api}.port`), port);
    }
  });
}
