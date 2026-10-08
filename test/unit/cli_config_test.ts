import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { parse } from '@std/yaml';
import { CONFIG_DEFAULTS } from '../../src/types/config.ts';

const REPO_DEPS = new URL('../../deno.json', import.meta.url).pathname;
const CLI = new URL('../../src/cli/mod.ts', import.meta.url).pathname;

async function runConfigYes(output: string) {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', REPO_DEPS, CLI, 'config', '-y', '-o', output],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    signal: AbortSignal.timeout(60_000),
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

function assertDefaultsContent(text: string) {
  const parsed = parse(text) as Record<string, unknown>;
  assertEquals(parsed.version, CONFIG_DEFAULTS.version);
  assertEquals(parsed.validators, CONFIG_DEFAULTS.validatorCount);
}

Deno.test('dnm config -y - overwrites an existing file after saving a .bak', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const target = `${dir}/localnet.yaml`;
    await Deno.writeTextFile(target, 'sentinel: true\n');

    const r = await runConfigYes(target);

    assertEquals(r.code, 0, r.stderr);
    assert(!r.stdout.includes('Overwrite?'));
    assertEquals(await Deno.readTextFile(`${target}.bak`), 'sentinel: true\n');
    assertDefaultsContent(await Deno.readTextFile(target));
    assertStringIncludes(r.stdout, `dnm start --config ${target}`);
    assertStringIncludes(r.stdout, `${target}.bak`);
    assert(!r.stdout.includes('deno task cli'));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('dnm config -y - shell-quotes an output path with whitespace', async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/my dir`);
    const target = `${dir}/my dir/localnet.yaml`;

    const r = await runConfigYes(target);

    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, `dnm start --config '${target}'`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('dnm config -y - writes a new file without a .bak', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const target = `${dir}/localnet.yaml`;

    const r = await runConfigYes(target);

    assertEquals(r.code, 0, r.stderr);
    assertDefaultsContent(await Deno.readTextFile(target));
    let hasBak = true;
    try {
      await Deno.stat(`${target}.bak`);
    } catch {
      hasBak = false;
    }
    assertEquals(hasBak, false);
    assertStringIncludes(r.stdout, `dnm start --config ${target}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
