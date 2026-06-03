/**
 * Cross-runtime smoke test for the SDK.
 *
 * Verifies no Deno-specific APIs remain in SDK source and that core
 * functionality works. Uses only node:* builtins for cross-runtime compat.
 *
 * Run: deno run --allow-all test/smoke/node-compat.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

// ── Helpers ──────────────────────────────────────────────────────────────────

const results = [];

async function runCheck(name, fn) {
  try {
    const errors = await fn();
    if (errors && errors.length > 0) {
      results.push({ name, pass: false, errors });
    } else {
      results.push({ name, pass: true });
    }
  } catch (err) {
    results.push({ name, pass: false, errors: [`Exception: ${err.message}`] });
  }
}

/** Recursively collect .ts files under dir, excluding excludeDirs. */
async function collectTsFiles(dir, excludeDirs = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = relative(process.cwd(), full);
      if (excludeDirs.some((ex) => rel === ex || rel.startsWith(ex + '/'))) continue;
      files.push(...(await collectTsFiles(full, excludeDirs)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

// ── Check 1: No Deno.* APIs in SDK source ───────────────────────────────────

await runCheck('No Deno.* APIs in SDK source', async () => {
  const files = await collectTsFiles('src', ['src/cli']);
  const errors = [];
  const denoPattern = /\bDeno\./;
  // Ignore comments (// ...) and lines that are purely documentation/strings
  const commentPattern = /^\s*(\/\/|\/?\*)/;

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentPattern.test(line)) continue;
      if (denoPattern.test(line)) {
        const rel = relative(process.cwd(), file);
        errors.push(`Found Deno.* in ${rel}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  return errors;
});

// ── Check 2: No @std/* imports in SDK source ────────────────────────────────

await runCheck('No @std/* imports in SDK source', async () => {
  const files = await collectTsFiles('src', ['src/cli']);
  const errors = [];
  const stdPattern = /from\s+['"]@std\//;

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (stdPattern.test(lines[i])) {
        const rel = relative(process.cwd(), file);
        errors.push(`Found @std/* import in ${rel}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  return errors;
});

// ── Check 3: node:* imports are resolvable ──────────────────────────────────

await runCheck('node:* imports resolvable', async () => {
  const files = await collectTsFiles('src', ['src/cli']);
  const nodeImportPattern = /from\s+['"]node:([^'"]+)['"]/g;
  const moduleSet = new Set();

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    let match;
    while ((match = nodeImportPattern.exec(content)) !== null) {
      // Use the top-level module (e.g., 'fs/promises' → 'fs')
      const mod = `node:${match[1]}`;
      moduleSet.add(mod);
    }
  }

  const errors = [];
  for (const mod of moduleSet) {
    try {
      await import(mod);
    } catch {
      errors.push(`Cannot resolve import: ${mod}`);
    }
  }
  return errors;
});

// ── Check 4: Builder creates valid config ───────────────────────────────────

await runCheck('Builder creates valid config', async () => {
  const { LocalNetBuilder } = await import('../../src/sdk/mod.ts');
  const errors = [];

  const config = LocalNetBuilder.create().withValidators(2).build();

  if (config.basePort !== 5000) {
    errors.push(`Expected basePort 5000, got ${config.basePort}`);
  }

  // validators should be normalized to an array by withDefaults
  if (!Array.isArray(config.validators)) {
    errors.push(`Expected validators to be an array, got ${typeof config.validators}`);
  } else if (config.validators.length !== 2) {
    errors.push(`Expected 2 validators, got ${config.validators.length}`);
  }

  return errors;
});

// ── Check 5: Config-derived utilities work ──────────────────────────────────

await runCheck('Config-derived utilities work', async () => {
  const { LocalNetBuilder, getCredentials, buildConfigEnvironmentInfo } = await import(
    '../../src/sdk/mod.ts'
  );
  const errors = [];

  const config = LocalNetBuilder.create().withValidators(2).build();

  // getCredentials — 2 SV entries + 2 validator wallet entries = 4
  const creds = getCredentials(config.validators, config.basePort);
  if (!Array.isArray(creds)) {
    errors.push(`getCredentials() should return array, got ${typeof creds}`);
  } else if (creds.length !== 4) {
    errors.push(`Expected 4 credential entries, got ${creds.length}`);
  }

  // buildConfigEnvironmentInfo — should have validators.sv
  const env = buildConfigEnvironmentInfo(config);
  if (!env.validators || !env.validators.sv) {
    errors.push('buildConfigEnvironmentInfo() missing validators.sv');
  }

  // endpoints derived from env — should have sv, validator-1, validator-2
  const endpoints = {};
  for (const [name, info] of Object.entries(env.validators)) {
    endpoints[name] = info.endpoints;
  }
  const expectedKeys = ['sv', 'validator-1', 'validator-2'];
  for (const key of expectedKeys) {
    if (!(key in endpoints)) {
      errors.push(`endpoints missing key: ${key}`);
    }
  }

  return errors;
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('');
let passed = 0;
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const tag = r.pass ? '[PASS]' : '[FAIL]';
  console.log(`${tag} Check ${i + 1}: ${r.name}`);
  if (!r.pass && r.errors) {
    for (const err of r.errors) {
      console.log(`  ${err}`);
    }
  }
  if (r.pass) passed++;
}

console.log('');
const total = results.length;
if (passed === total) {
  console.log(`${passed}/${total} checks passed`);
} else {
  console.log(`${passed}/${total} checks passed — FAILED`);
}

process.exit(passed === total ? 0 : 1);
