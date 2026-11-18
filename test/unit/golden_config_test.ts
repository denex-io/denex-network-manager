// Golden check: the Canton and Splice configs generated for Splice 0.9.4 must stay byte-identical
// to the fixtures, so any change to the 0.9.4 output fails here first. After a deliberate change,
// regenerate with `DNM_UPDATE_GOLDEN=1 deno test --allow-all test/unit/golden_config_test.ts` and
// review the fixture diff.
import { assertEquals } from '@std/assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { generateFullCantonConfig, generateFullSpliceConfig } from '../../src/generator/mod.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'generated-0.9.4');
const UPDATE = Deno.env.get('DNM_UPDATE_GOLDEN') === '1';
const auth = { keycloak: { admin: 'admin', password: 'admin' } };

const CASES: Array<{ name: string; fixture: string; config: LocalNetConfig }> = [
  { name: 'default, 2 validators', fixture: 'default-2', config: { validators: 2, auth } },
  {
    name: 'explicit 0.9.4, 2 validators',
    fixture: 'default-2',
    config: { validators: 2, auth, spliceVersion: '0.9.4' },
  },
  {
    name: 'named validators, basePort 10000',
    fixture: 'named-3-base10000',
    config: {
      validators: [
        {
          name: 'alice',
          parties: [{ hint: 'alice-party' }],
          users: [{ id: 'ops', primaryParty: 'alice-party' }],
        },
        { name: 'bob' },
        { name: 'carol-x', parties: [{ hint: 'c1' }, { hint: 'c2' }] },
      ],
      auth,
      basePort: 10000,
    },
  },
];

for (const { name, fixture, config } of CASES) {
  for (
    const [kind, generate] of [
      ['canton', generateFullCantonConfig],
      ['splice', generateFullSpliceConfig],
    ] as const
  ) {
    Deno.test(`golden 0.9.4 ${kind} config - ${name}`, async () => {
      const path = join(FIXTURES, `${fixture}.${kind}.conf`);
      const actual = generate(config);
      if (UPDATE) await Deno.writeTextFile(path, actual);
      assertEquals(actual, await Deno.readTextFile(path));
    });
  }
}
