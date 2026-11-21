# Splice version support

What this version of denex-network-manager runs, what it is tested on, and what has to happen before
the default moves. Upstream references are to `github.com/canton-network/splice` at the named tag,
`github.com/digital-asset/canton` at the named tag, and the Canton release notes in
`github.com/canton-network/cf-docs` (`docs-main/global-synchronizer/release-notes/canton-releases/`,
read at main `2faa314f9e78`, 2026-11-18).

## Tested releases

| Splice | Canton (`nix/canton-sources.json` at the tag) | Protocol versions | PostgreSQL tested | Role    |
| ------ | --------------------------------------------- | ----------------- | ----------------- | ------- |
| 0.9.4  | 3.6.4                                         | 34, 35, 36        | 14–18             | default |
| 0.10.2 | 3.7.3                                         | 36, 37            | 14–18             | opt-in  |

Protocol versions and PostgreSQL majors are from the Canton release notes (`3-6-4.mdx:26,33`,
`3-7-3.mdx:173,180`); 17 is the recommended major for both. dnm runs `postgres:18`
(`src/docker/containers.ts`). The integration suite runs on both releases before every release
(`.github/workflows/integration.yml`, called from `publish.yml`).

`TESTED_SPLICE_VERSIONS` and `DEFAULT_SPLICE_VERSION` in `src/utils/splice-version.ts` are the
source of truth. Any other `spliceVersion` that is a valid Docker tag starts, with a warning that it
is untested.

## Why the default stays 0.9.4

Splice 0.10 is configured for protocol version 37 (Canton 3.7 adds PV 37, per the Splice 0.10.0
release notes; `initialProtocolVersion` defaults to `ProtocolVersion.v37`,
`apps/sv/src/main/scala/org/lfdecentralizedtrust/splice/sv/config/SvAppConfig.scala:139` at 0.10.2,
and the running SV app's config shows `initial-protocol-version` 37 on 0.10.2 and 36 on 0.9.4,
2026-11-19). On PV 37, `GenerateExternalPartyTopology` returns v31 topology transactions unless the
request pins protocol version 36, which changes external-party onboarding for denex-sdk-dev users.
Moving the default would break them without a change on their side.

## Selecting a release

- `spliceVersion` in the config (or `LocalNetBuilder.withSpliceVersion()`) pulls the six
  Splice-family images (`canton`, `splice-app`, `wallet-web-ui`, `ans-web-ui`, `sv-web-ui`,
  `scan-web-ui` from `ghcr.io/digital-asset/decentralized-canton-sync/docker`) at that tag.
- The generated config follows it: 0.10 and later, and any tag that is not a release number, get the
  Splice 0.10 shape, in which each Splice app's participant Admin API client is a `client-config`
  plus an `auth-config` (`usesSplice010Config()`). Splice 0.10.2 also removed CometBFT, so dnm no
  longer writes `comet-bft-config` for any release.
- `LocalNetOptions.images` overrides individual images and wins over `spliceVersion`, but an
  override that puts canton or splice-app on a release of the other config shape throws
  `SpliceVersionConflictError` when the handle is created.
- Only a value that cannot be a Docker tag is refused.

## Upgrade policy: recreate

An instance keeps the release it was created with, and dnm never mixes releases in one instance.
`start()` enforces this: a repair that would create containers next to existing ones on another
image throws `InstanceMismatchError` before changing anything, and a complete instance resumes as it
was created, with an `'instance'` warning naming the difference. To switch release, destroy the
instance and start it again; its ledger state is lost.

## What changes for app builders on 0.10.2

- Transfers and allocations through `ExternalPartyAmuletRules` require `requestedAt` within the past
  24 hours (`assertInPast24Hours`, `daml/splice-amulet/daml/Splice/GovernanceLock.daml:580-583`,
  used at `ExternalPartyAmuletRules.daml:386,582` at 0.10.2). At 0.9.4 it only had to be in the past
  (`ExternalPartyAmuletRules.daml:368`). dnm sets no `requestedAt`; app tests that fix one in the
  past may need a current time.
- External parties: PV 37 topology, above.
- Operator APIs. Canton 3.7 turns off the participant repair service and key download by default
  (`CantonFeatures.enableRepairCommands`, `CantonParameters.enableKeyDownload`,
  `community/app-base/src/main/scala/com/digitalasset/canton/config/CantonConfig.scala` at canton
  v3.7.3), so on a plain 0.10.2 LocalNet Scan's `/v0/acs/{party}` answers HTTP 400
  (`Method not
  found: …ParticipantRepairService/ExportAcs`) and the validator's
  `/v0/admin/participant/identities` fails with "key downloads are disabled" (both measured live
  2026-11-19; both work on 0.9.4). Upstream's own 0.10.2 LocalNet (`cluster/compose/localnet/`) sets
  neither. dnm goes past upstream on purpose: its 0.10 config enables both, and
  `test/integration/operator_apis_test.ts` checks both endpoints on every tested release. This is
  Canton's participant repair service, unrelated to `dnm start` repairing a partly running
  instance's containers.

## Downstream checks

- sec-lending2 overrides canton and splice-app to 0.7.0 without `spliceVersion`
  (`sec-lending2/tools/net.ts`). 0.7.0 has the pre-0.10 config shape, the same as the 0.9.4 default,
  so the override is allowed: started live on 2026-11-19 with canton and splice-app 0.7.0 (Canton
  3.5.11) and the 0.9.4 web UIs, every container healthy. With `spliceVersion: '0.10.2'` the same
  override is refused up front with `SpliceVersionConflictError`, because 0.7.0 cannot read the 0.10
  config (checked the same day, nothing started).
- No repository in the denex-io organization calls Scan's `/v0/acs/{party}` or Canton's `ExportAcs`
  (searched 2026-11-18).

## Before moving the default to 0.10.x

1. Either pin the synchronizer to PV 36 (`onboarding.initial-protocol-version` in the SV config), or
   handle v31 topology transactions in denex-sdk-dev's external-party onboarding.
2. Run denex-sdk-dev's external-party flow against a 0.10 LocalNet.
3. Move sec-lending2 to a 0.10 release (`spliceVersion`, no image override), or keep it on a
   pre-0.10 `spliceVersion` explicitly.
4. Say it in the CHANGELOG as breaking: every instance created on the old default has to be
   recreated (above).

## Release-bump checklist

1. Pick a published tag (`git ls-remote --tags https://github.com/canton-network/splice`); never a
   main-branch version.
2. Check that all six images exist at that tag for linux/amd64 and linux/arm64
   (`docker buildx imagetools inspect ghcr.io/digital-asset/decentralized-canton-sync/docker/<image>:<tag>`).
3. Diff the upstream LocalNet config between the tested tag and the new one
   (`cluster/compose/localnet/` in the splice repo) for keys dnm generates. Canton fails on unknown
   keys; Splice fails on a known key with another shape. Add a shape to `usesSplice010Config()`'s
   family only when the config really differs.
4. Update `TESTED_SPLICE_VERSIONS` (and `DEFAULT_SPLICE_VERSION` if the default moves), the table
   above, the CHANGELOG and the README note.
5. `deno task check`, `lint`, `fmt:check`, `test:unit`; then
   `DNM_TEST_SPLICE_VERSION=<tag> deno task test:integration`, which first proves the LocalNets run
   that tag.
6. Add the tag to the `splice` matrix in `.github/workflows/integration.yml`.

## Backlog

- The top-level `parties[].hint` rule (letter first; letters, digits, hyphens) is stricter than what
  Canton accepts, which users' party references now follow.
- The Keycloak bootstrap-admin cleanup after start turns a failure into a progress warning.
- Keycloak's other default username validators are not checked when the config is read.
- Suite time: 97.3 minutes for 72 integration tests on 0.9.4 (2026-11-18), nearly all of it one cold
  LocalNet start per test (about 2.5 to 3 minutes each): `runtime_user_test.ts` 20.6 minutes,
  `initialization_test.ts` 17.9, `wallet_ui_test.ts` 12.6, `localnet_test.ts` 10.4. Sharing one
  instance across a file's read-only tests, or sharding files across matrix jobs, would cut it.
