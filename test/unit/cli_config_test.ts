import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { parse } from '@std/yaml';
import { CONFIG_DEFAULTS } from '../../src/types/config.ts';
import { writeConfig } from '../../src/cli/commands/config.ts';

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

Deno.test('writeConfig - duplicate validator names fail and leave no file or .bak', async () => {
  const dir = await Deno.makeTempDir();
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => errors.push(args.join(' '));
  try {
    const target = `${dir}/localnet.yaml`;
    const config = {
      version: CONFIG_DEFAULTS.version,
      validators: [{ name: 'alice' }, { name: 'Alice' }],
      auth: { keycloak: { admin: 'admin', password: 'admin' } },
    };

    assertEquals(await writeConfig(config, target, { overwrite: true }), false);
    assertEquals(await exists(target), false);
    assertEquals(await exists(`${target}.bak`), false);
    assertStringIncludes(errors.join('\n'), 'Duplicate validator name');

    await Deno.writeTextFile(target, 'sentinel: true\n');
    assertEquals(await writeConfig(config, target, { overwrite: true }), false);
    assertEquals(await Deno.readTextFile(target), 'sentinel: true\n');
    assertEquals(await exists(`${target}.bak`), false);
  } finally {
    console.error = originalError;
    await Deno.remove(dir, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test('CLI config loading - a misspelt key prints a warning on stderr and the load succeeds', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/localnet.yaml`;
    await Deno.writeTextFile(
      path,
      'validators: 1\nbasport: 7000\nauth:\n  keycloak:\n    admin: a\n    password: b\n',
    );
    // `dnm start` needs Docker after loading, so drive the loader with the CLI's handler.
    const script = `
      import { loadConfigFile } from ${
      JSON.stringify(new URL('../../src/utils/yaml.ts', import.meta.url).href)
    };
      import { warnToStderr } from ${
      JSON.stringify(new URL('../../src/cli/utils.ts', import.meta.url).href)
    };
      const c = await loadConfigFile(${JSON.stringify(path)}, { onWarning: warnToStderr });
      console.log(JSON.stringify({ basePort: c.basePort }));
    `;
    const out = await new Deno.Command(Deno.execPath(), {
      args: ['eval', '--config', REPO_DEPS, script],
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      signal: AbortSignal.timeout(60_000),
    }).output();
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    assertStringIncludes(new TextDecoder().decode(out.stderr), "Unrecognized key 'basport'");
    assertStringIncludes(new TextDecoder().decode(out.stdout), '"basePort":5000');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
