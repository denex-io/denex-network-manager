import { assertEquals, assertThrows } from '@std/assert';
import { ZodError } from 'zod';
import {
  readTestSpliceVersion,
  withTestSpliceVersion,
} from '../integration/splice_version_selection.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';

const CONFIG: LocalNetConfig = {
  validators: 1,
  auth: { keycloak: { admin: 'admin', password: 'admin' } },
};

Deno.test('DNM_TEST_SPLICE_VERSION - unset selects the bundled default', () => {
  assertEquals(readTestSpliceVersion(undefined), undefined);
  assertEquals('spliceVersion' in withTestSpliceVersion(CONFIG, undefined), false);
});

Deno.test('DNM_TEST_SPLICE_VERSION - a set value becomes every config spliceVersion', () => {
  assertEquals(readTestSpliceVersion('0.10.2'), '0.10.2');
  assertEquals(withTestSpliceVersion(CONFIG, '0.10.2').spliceVersion, '0.10.2');
});

Deno.test('DNM_TEST_SPLICE_VERSION - a value the schema refuses throws', () => {
  for (const bad of ['', '0.9.0 beta']) {
    assertThrows(() => readTestSpliceVersion(bad), ZodError);
  }
});

Deno.test('DNM_TEST_SPLICE_VERSION - a config that sets spliceVersion itself is refused', () => {
  assertThrows(
    () => withTestSpliceVersion({ ...CONFIG, spliceVersion: '0.9.4' }, '0.10.2'),
    Error,
    'already sets spliceVersion',
  );
});
