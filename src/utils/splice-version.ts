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
