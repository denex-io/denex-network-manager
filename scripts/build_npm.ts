// SPDX-License-Identifier: Apache-2.0
// Copyright Cumberland Applications LLC 2026
//
// Builds the npm package using dnt (Deno to Node Transform).
// Usage: deno run --allow-all scripts/build_npm.ts <version>
// Example: deno run --allow-all scripts/build_npm.ts 0.1.0-beta.1
//
// This package ships the SDK only. The `dnm` CLI is distributed as a
// pre-compiled binary via GitHub releases (see install.sh), not through npm.

import { build, emptyDir } from 'jsr:@deno/dnt@^0.42.3';

const version = Deno.args[0];
if (!version) {
  console.error('Usage: deno run --allow-all scripts/build_npm.ts <version>');
  Deno.exit(1);
}

await emptyDir('./npm');

await build({
  entryPoints: [
    { name: '.', path: './src/mod.ts' },
    { name: './sdk', path: './src/sdk/mod.ts' },
    { name: './types', path: './src/types/mod.ts' },
  ],
  outDir: './npm',
  shims: { deno: false },
  test: false,
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
  },
  package: {
    name: '@denex/network-manager',
    version,
    description: 'SDK for running Canton Network LocalNets from a single YAML file',
    license: 'Apache-2.0',
    engines: { node: '>=18' },
    keywords: [
      'canton',
      'daml',
      'digital-asset',
      'testcontainers',
      'docker',
      'distributed-ledger',
      'localnet',
      'splice',
    ],
    repository: {
      type: 'git',
      url: 'git+https://github.com/denex-io/denex-network-manager.git',
    },
    bugs: { url: 'https://github.com/denex-io/denex-network-manager/issues' },
    homepage: 'https://github.com/denex-io/denex-network-manager#readme',
  },
  postBuild() {
    Deno.copyFileSync('LICENSE', 'npm/LICENSE');
    Deno.copyFileSync('README.md', 'npm/README.md');
  },
});

console.log(`\nBuilt @denex/network-manager@${version} → ./npm/`);
