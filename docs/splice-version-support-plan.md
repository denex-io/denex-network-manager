# Splice Version Support Plan

## Current Release Baseline

The default Splice image bundle is `0.6.6`, taken from `reference/splice/LATEST_RELEASE`.
`reference/splice/VERSION` may point at an unreleased development version, so release bumps should
use `LATEST_RELEASE` or a published Git tag rather than the main-branch working version.

All Splice-owned LocalNet images use the same release tag:

- `ghcr.io/digital-asset/decentralized-canton-sync/docker/canton`
- `ghcr.io/digital-asset/decentralized-canton-sync/docker/splice-app`
- `ghcr.io/digital-asset/decentralized-canton-sync/docker/wallet-web-ui`
- `ghcr.io/digital-asset/decentralized-canton-sync/docker/ans-web-ui`
- `ghcr.io/digital-asset/decentralized-canton-sync/docker/sv-web-ui`
- `ghcr.io/digital-asset/decentralized-canton-sync/docker/scan-web-ui`

## Goal

Users should be able to choose a supported Splice release without hand-writing every image override,
while denex-network-manager keeps a safe default for new LocalNets.

## Proposed User Surface

Add a top-level YAML field:

```yaml
version: '1.0'
spliceVersion: '0.6.6'
```

Add the matching SDK option and builder method:

```typescript
await LocalNet.fromConfig('./localnet.yaml', { spliceVersion: '0.6.6' });

const config = LocalNetBuilder.create()
  .withSpliceVersion('0.6.6')
  .build();
```

Keep `LocalNetOptions.images` as the escape hatch for custom registries, patched images, and
unreleased snapshots. Explicit image overrides should win over `spliceVersion`.

## Implementation Plan

1. Introduce a `SpliceReleaseBundle` type that resolves one Splice version into the six image refs.
   Keep the current default bundle in `src/docker/containers.ts` and make it the single source of
   truth for default tags.
2. Add `spliceVersion?: string` to `LocalNetConfig`, Zod validation, YAML loading tests, and
   `LocalNetBuilder`. Validate it as a release tag, not as a general Docker image reference.
3. Resolve images in one place, using this precedence: `LocalNetOptions.images` > runtime
   `spliceVersion` option > config `spliceVersion` > default release bundle.
4. Persist the selected Splice version in generated state/labels so `fromInstanceId()`, status, and
   discovery can report which release a running instance uses.
5. Add unit tests for default resolution, YAML resolution, option override precedence, and explicit
   image override precedence.
6. Add a release-bump checklist: update `DEFAULT_SPLICE_VERSION`, verify manifests exist for all six
   images, run unit/check validation, then run one Docker-backed startup smoke before publishing.

## Compatibility Policy

- Support the current default release plus the previous minor release when practical.
- Treat each Splice release as a bundle; do not mix Canton, Splice app, and web UI tags unless the
  user explicitly overrides images.
- If upstream HOCON or environment variables change incompatibly, add a version-gated generator path
  keyed by the resolved Splice version.
- Document known unsupported releases in README rather than silently accepting versions that cannot
  start.
