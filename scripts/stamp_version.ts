// SPDX-License-Identifier: Apache-2.0
// Copyright Cumberland Applications LLC 2026
//
// Rewrites src/cli/version.ts so a compiled `dnm` binary reports the version
// being released. Run by the publish workflow before `deno compile`.
//
// Usage: deno run --allow-read --allow-write scripts/stamp_version.ts <version>
// Example: deno run --allow-read --allow-write scripts/stamp_version.ts 0.1.0-beta.1

const version = Deno.args[0];
if (!version) {
  console.error('Usage: deno run --allow-read --allow-write scripts/stamp_version.ts <version>');
  Deno.exit(1);
}

// Guard against a mangled tag silently producing a bogus binary version.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`stamp_version: '${version}' is not a valid semver version`);
  Deno.exit(1);
}

const path = 'src/cli/version.ts';
const source = await Deno.readTextFile(path);
const pattern = /export const VERSION = '[^']*';/;

if (!pattern.test(source)) {
  console.error(`stamp_version: could not find the VERSION export in ${path}`);
  Deno.exit(1);
}

await Deno.writeTextFile(path, source.replace(pattern, `export const VERSION = '${version}';`));

console.log(`Stamped ${path} with version ${version}`);
