import { assert, assertEquals } from '@std/assert';
import * as root from '../../src/mod.ts';
import {
  getHighestPort,
  getKeycloakPort,
  getSvInternalPorts,
  getSvPorts,
  getValidatorPorts,
  MAX_PORT,
  PORT_SUFFIXES,
  SV_INTERNAL_PORT_OFFSETS,
} from '../../src/utils/ports.ts';

Deno.test('getSvInternalPorts - default basePort', () => {
  assertEquals(getSvInternalPorts(5000), {
    mediatorAdmin: 5007,
    sequencerPublic: 5008,
    sequencerAdmin: 5009,
    scanAdmin: 5012,
    splicePrometheus: 5013,
    svAdmin: 5014,
    sequencerGrpcHealth: 5062,
    mediatorGrpcHealth: 5063,
  });
  assertEquals(getSvInternalPorts(), getSvInternalPorts(5000));
});

Deno.test('getSvInternalPorts - basePort 7000', () => {
  assertEquals(getSvInternalPorts(7000), {
    mediatorAdmin: 7007,
    sequencerPublic: 7008,
    sequencerAdmin: 7009,
    scanAdmin: 7012,
    splicePrometheus: 7013,
    svAdmin: 7014,
    sequencerGrpcHealth: 7062,
    mediatorGrpcHealth: 7063,
  });
});

Deno.test('port offsets are pairwise distinct and below 100', () => {
  const offsets = [
    ...Object.values(SV_INTERNAL_PORT_OFFSETS),
    ...Object.values(PORT_SUFFIXES),
  ];
  assertEquals(new Set(offsets).size, offsets.length);
  for (const o of offsets) assert(o < 100, `offset ${o} must be below 100`);
});

Deno.test('src/mod.ts does not export the internal port helpers', () => {
  for (
    const name of [
      'SV_INTERNAL_PORTS',
      'getSvInternalPorts',
      'SV_INTERNAL_PORT_OFFSETS',
      'getHighestPort',
      'MAX_PORT',
    ]
  ) {
    assert(!(name in root), `${name} must not be exported from the package root`);
  }
});

function assertUnique(label: string, ports: number[]): void {
  assertEquals(new Set(ports).size, ports.length, `${label}: duplicate port in ${ports}`);
}

function assertNoCollisions(basePort: number, validators: number): void {
  const internal = getSvInternalPorts(basePort);
  const sv = getSvPorts(basePort);
  const v = Array.from({ length: validators }, (_, i) => getValidatorPorts(i, basePort));

  const canton = [
    sv.ledgerApi,
    sv.adminApi,
    sv.jsonApi,
    sv.httpHealth,
    sv.grpcHealth,
    internal.sequencerPublic,
    internal.sequencerAdmin,
    internal.sequencerGrpcHealth,
    internal.mediatorAdmin,
    internal.mediatorGrpcHealth,
    ...v.flatMap((p) => [p.ledgerApi, p.adminApi, p.jsonApi, p.httpHealth, p.grpcHealth]),
  ];
  const splice = [
    sv.validatorAdminApi,
    internal.scanAdmin,
    internal.svAdmin,
    internal.splicePrometheus,
    ...v.map((p) => p.validatorAdminApi),
  ];
  const nginx = [sv.webUi, ...v.map((p) => p.webUi)];
  assertUnique(`canton@${basePort}/${validators}`, canton);
  assertUnique(`splice@${basePort}/${validators}`, splice);
  assertUnique(`nginx@${basePort}/${validators}`, nginx);
  assertUnique(`all@${basePort}/${validators}`, [
    ...canton,
    ...splice,
    ...nginx,
    getKeycloakPort(basePort),
  ]);
}

Deno.test('no collisions among our own ports across basePorts (N=10)', () => {
  for (let basePort = 1024; basePort <= 60000; basePort++) assertNoCollisions(basePort, 10);
});

Deno.test('no collisions at known-bad basePorts and large validator counts', () => {
  const bases = [1024, 4847, 4909, 4932, 4947, 5001, 5007, 5009, 7000, 9999, 10001, 60000];
  for (const basePort of bases) {
    for (const n of [1, 2, 54]) assertNoCollisions(basePort, n);
  }
});

Deno.test('getHighestPort', () => {
  assertEquals(getHighestPort(5000, 2), 5280);
  assertEquals(getHighestPort(5000, 0), 5082);
  assertEquals(getHighestPort(60000, 54), 65480);
  assertEquals(getHighestPort(60000, 55), 65580);
  assert(getHighestPort(1024, 644) <= MAX_PORT);
  assert(getHighestPort(1024, 645) > MAX_PORT);
});
