// SPDX-License-Identifier: Apache-2.0
// Copyright Cumberland Applications LLC 2026
//
// Single source of truth for the CLI version reported by `dnm --version`.
// The release workflow rewrites this file from the pushed tag before running
// `deno compile`, so compiled binaries always report their release version.
export const VERSION = '0.1.0-beta.1';
