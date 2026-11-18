import { assertEquals } from '@std/assert';

// Every LocalNet config the integration suite defines goes through testConfig() (helpers.ts), so
// DNM_TEST_SPLICE_VERSION reaches it. A definition that skips it runs the bundled default under
// whatever version the run claims. A spread (`{ ...BASE, ... }`) inherits BASE's version and BASE
// is checked where it is defined. No exceptions.
const DEFINITION = new RegExp(
  [
    ...[
      String.raw`LocalNetConfig\s*=\s*\(?\s*\{`,
      String.raw`\):\s*LocalNetConfig\s*\{\s*return\s*\(?\s*\{`,
      String.raw`fromConfig\(\s*\(?\s*\{`,
      String.raw`new LocalNet\(\s*\(?\s*\{`,
    ].map((p) => `${p}(?!\\s*\\.\\.\\.)`),
    String.raw`\}\s*\)?\s*(?:as|satisfies)\s+LocalNetConfig\b`,
  ].join('|'),
  'g',
);

/** Line numbers of config definitions in `source` that skip testConfig(). */
function unwrappedDefinitions(source: string): number[] {
  return [...source.matchAll(DEFINITION)].map((m) => source.slice(0, m.index).split('\n').length);
}

Deno.test('integration configs - the guard sees each definition shape', () => {
  const source = [
    'const A: LocalNetConfig = {', // 1
    'function make(): LocalNetConfig {', // 2
    '  return {', // 3
    'new LocalNet(', // 4
    '  {', // 5
    'await LocalNet.fromConfig(', // 6
    '  { validators: 1 },', // 7
    'const B: LocalNetConfig = testConfig({', // 8: wrapped
    'const C: LocalNetConfig = { ...A, basePort: 1 };', // 9: spread
    'new LocalNet(', // 10
    '  { ...A, basePort: 2 },', // 11: spread
    'const D: LocalNetConfig = ({', // 12: parenthesised
    'const E = { validators: 1 } as LocalNetConfig;', // 13
    'const F = { validators: 1 } satisfies LocalNetConfig;', // 14
  ].join('\n');
  assertEquals(unwrappedDefinitions(source), [1, 2, 4, 6, 12, 13, 14]);
});

async function* integrationSources(): AsyncGenerator<[string, string]> {
  const dir = new URL('../integration/', import.meta.url);
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith('.ts')) continue;
    yield [entry.name, await Deno.readTextFile(new URL(entry.name, dir))];
  }
}

Deno.test('integration configs - every definition goes through testConfig()', async () => {
  const skipped: string[] = [];
  for await (const [name, source] of integrationSources()) {
    for (const line of unwrappedDefinitions(source)) skipped.push(`${name}:${line}`);
  }
  assertEquals(skipped.sort(), []);
});

// Images follow the selected release too: a test that names the bundled default's images runs them
// under whatever version the run claims. helpers.ts resolves the selected release's images.
Deno.test('integration configs - no test reads the bundled default images', async () => {
  const BUNDLED = /\bDEFAULT_(?:IMAGES|SPLICE_VERSION)\b/g;
  const found: string[] = [];
  for await (const [name, source] of integrationSources()) {
    if (name === 'helpers.ts') continue;
    for (const m of source.matchAll(BUNDLED)) {
      found.push(`${name}:${source.slice(0, m.index).split('\n').length}`);
    }
  }
  assertEquals(found.sort(), []);
});
