import { SpliceVersionConflictError } from '../errors.ts';

/**
 * The Splice release a LocalNet runs when its config sets no `spliceVersion`. It stays 0.9.4 while
 * 0.10.x founds the synchronizer on protocol version 37, which changes the topology transactions
 * external-party onboarding returns.
 */
export const DEFAULT_SPLICE_VERSION = '0.9.4';

/**
 * Splice releases this version of denex-network-manager is tested against, oldest first. The
 * default is one of them. Other releases may work; config input warns for them.
 */
export const TESTED_SPLICE_VERSIONS = ['0.9.4', '0.10.2'] as const;

/** The release a config runs: its `spliceVersion`, or the default. */
export function resolveSpliceVersion(config: { spliceVersion?: string }): string {
  return config.spliceVersion ?? DEFAULT_SPLICE_VERSION;
}

/** A Splice release tag: `MAJOR.MINOR.PATCH`, optionally followed by `-suffix` (snapshots). */
const RELEASE_TAG = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** Major and minor of a Splice release tag, or `undefined` for a tag that is not one. */
export function parseSpliceRelease(tag: string): { major: number; minor: number } | undefined {
  const m = RELEASE_TAG.exec(tag);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : undefined;
}

/**
 * Whether a Splice release tag names a release before `major.minor`. A tag that is not a release
 * tag is never treated as older.
 */
export function isSpliceReleaseBefore(version: string, major: number, minor: number): boolean {
  const release = parseSpliceRelease(version);
  if (!release) return false;
  return release.major < major || (release.major === major && release.minor < minor);
}

/**
 * Whether a release uses the Splice 0.10 config shape: each app's participant Admin API client is
 * `admin-api { client-config {...}, auth-config {...} }` instead of `admin-api { address, port }`.
 */
export function usesSplice010Config(version: string): boolean {
  return !isSpliceReleaseBefore(version, 0, 10);
}

/** The tag of an image reference (`[registry/]repo:tag[@digest]`), or `undefined` if it has none. */
export function imageTag(image: string): string | undefined {
  const ref = image.split('@')[0];
  const colon = ref.lastIndexOf(':');
  return colon > ref.lastIndexOf('/') ? ref.slice(colon + 1) : undefined;
}

/**
 * Throws if an explicit canton or splice image carries a Splice release tag whose config shape
 * differs from `spliceVersion`'s: dnm generates the config for `spliceVersion`, and the image
 * would not load it. Images without a release tag (custom builds) are not checked.
 */
export function assertImagesMatchSpliceVersion(
  spliceVersion: string,
  images: { canton?: string; splice?: string } | undefined,
  versionSource: string,
): void {
  for (const key of ['canton', 'splice'] as const) {
    const image = images?.[key];
    const tag = image === undefined ? undefined : imageTag(image);
    if (image === undefined || tag === undefined || !parseSpliceRelease(tag)) continue;
    if (usesSplice010Config(tag) === usesSplice010Config(spliceVersion)) continue;
    throw new SpliceVersionConflictError(
      spliceVersion,
      image,
      `images.${key} is ${image} (Splice ${tag}), but the generated config is for Splice ` +
        `${spliceVersion} (${versionSource}), and Splice 0.10 changed the config shape. ` +
        `Set spliceVersion: '${tag}' to run that release.`,
    );
  }
}
