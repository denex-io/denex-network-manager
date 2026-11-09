---
title: Installation
description: Install the dnm CLI or the @denex/network-manager SDK, and what each runtime requires.
---

## Requirements

- Docker running locally. A LocalNet with the SV and 2 validators uses about 3.2 GB of Docker
  memory at idle, and more as you upload DARs (measured with 7.75 GB given to Docker).
- Nothing else for the pre-compiled `dnm` binary, or Deno 2.0+ to run the CLI from source
- Deno 2.0+, Node.js 18+, or Bun for the SDK/API layer

The CLI source is Deno-only because it uses Cliffy and `Deno.*` APIs. The SDK and low-level API use
`node:` built-ins and are intended to work on Deno, Node.js, and Bun.

:::caution[Bun caveat]
Bun does not support Docker Unix sockets reliably through `node:http`. If you use the SDK from Bun,
configure Docker to listen on a TCP socket.
:::

:::note[Splice version]
This release runs Splice 0.9.4 (Canton 3.6.4) by default. To run another release, set
`spliceVersion` in the config or call `LocalNetBuilder.withSpliceVersion()`; see
[Splice version](/denex-network-manager/reference/configuration/#splice-version). From the SDK,
pass `images` in the `LocalNetOptions` given to `LocalNet.fromConfig()` to override individual
images, keyed by component (for example `splice` or `canton`).
:::

## CLI

Install the pre-compiled `dnm` binary. No Deno required:

```bash
curl -fsSL https://raw.githubusercontent.com/denex-io/denex-network-manager/main/install.sh | sh
```

This installs to `~/.dnm/bin` and verifies the download against the release checksums. Set
`DNM_INSTALL_DIR` to install elsewhere, or `DNM_VERSION` (for example `v0.1.0-beta.3`) to pin a version.

Prefer not to pipe a script to your shell? Download the archive for your platform from the
[latest release](https://github.com/denex-io/denex-network-manager/releases/latest), verify it
against `SHA256SUMS`, then extract `dnm` onto your `PATH`. Builds are provided for Linux x64/arm64,
macOS x64/arm64, and Windows x64 (`dnm-win-x64.zip`).

Or run from source (requires Deno 2.0+ and a repo checkout):

```bash
deno install --global --allow-all --config deno.json --name dnm src/cli/mod.ts
```

## SDK

The npm package contains the SDK only — use one of the CLI options above for `dnm`.

**Node.js / npm:**

```bash
npm install @denex/network-manager@beta
```

**Bun:**

```bash
bun add @denex/network-manager@beta
```

Then import:

```typescript
import { LocalNet, LocalNetBuilder } from '@denex/network-manager/sdk';
```

`@denex/network-manager/sdk` is the curated surface. The full API — including `CantonClient`,
`ValidatorAdminClient`, generators, schemas, Docker helpers, and discovery utilities — is available
from `@denex/network-manager`.

## Next

[Quick start](/denex-network-manager/start/quick-start/) brings up a network in two commands.
