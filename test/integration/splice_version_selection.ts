/**
 * Which Splice release the integration suite runs: `DNM_TEST_SPLICE_VERSION`, or the bundled
 * default when it is unset. Test-only: the product never reads this variable.
 */

import { parseLocalNetConfig } from '../../src/schemas/localnet-config.ts';
import type { LocalNetConfig } from '../../src/types/config.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';

/** A set variable goes through the config schema; a value it refuses throws its `ZodError`. */
export function readTestSpliceVersion(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return parseLocalNetConfig({ ...createMinimalConfig(1), spliceVersion: value }).spliceVersion;
}

/** `config` with `version` as its `spliceVersion`; unchanged when `version` is undefined. */
export function withTestSpliceVersion<T extends LocalNetConfig>(
  config: T,
  version: string | undefined,
): T {
  if (config.spliceVersion !== undefined) {
    throw new Error(
      `config already sets spliceVersion '${config.spliceVersion}'; ` +
        `a test that pins its own release does not go through testConfig()`,
    );
  }
  return version === undefined ? config : { ...config, spliceVersion: version };
}
