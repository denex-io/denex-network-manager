#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright Cumberland Applications LLC 2026
#
# Installer for the `dnm` CLI (denex-network-manager).
#
#   curl -fsSL https://raw.githubusercontent.com/denex-io/denex-network-manager/main/install.sh | sh
#
# Environment variables:
#   DNM_VERSION      Tag to install (e.g. v0.1.0-beta.1). Default: latest release.
#   DNM_INSTALL_DIR  Install directory. Default: $HOME/.dnm/bin
#
# This installs a pre-compiled binary. The SDK is a separate npm package:
#   npm install @denex/network-manager@beta

set -eu

REPO="denex-io/denex-network-manager"
INSTALL_DIR="${DNM_INSTALL_DIR:-$HOME/.dnm/bin}"

err() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

info() {
  printf '%s\n' "$1"
}

# ── Detect platform ──────────────────────────────────────────────────────────

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux) os_name='linux' ;;
  Darwin) os_name='darwin' ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT)
    err "Windows is not supported by this script.
Download dnm-win-x64.zip from https://github.com/$REPO/releases/latest instead."
    ;;
  *) err "unsupported operating system: $os" ;;
esac

case "$arch" in
  x86_64 | amd64) arch_name='x64' ;;
  aarch64 | arm64) arch_name='arm64' ;;
  *) err "unsupported architecture: $arch" ;;
esac

target="${os_name}-${arch_name}"
archive="dnm-${target}.tar.gz"

# ── Resolve download URLs ────────────────────────────────────────────────────

if [ -n "${DNM_VERSION:-}" ]; then
  base_url="https://github.com/$REPO/releases/download/$DNM_VERSION"
else
  base_url="https://github.com/$REPO/releases/latest/download"
fi

# ── Pick a downloader ────────────────────────────────────────────────────────

if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -qO "$2" "$1"; }
else
  err 'neither curl nor wget found; install one and retry'
fi

# ── Pick a checksum tool ─────────────────────────────────────────────────────

if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  err 'neither sha256sum nor shasum found; install one and retry'
fi

# ── Download, verify, install ────────────────────────────────────────────────

tmp="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$tmp'" EXIT INT TERM

info "Downloading $archive ..."
download "$base_url/$archive" "$tmp/$archive" ||
  err "failed to download $base_url/$archive
If you are installing a prerelease, set DNM_VERSION to its tag."

info 'Verifying checksum ...'
download "$base_url/SHA256SUMS" "$tmp/SHA256SUMS" ||
  err "failed to download $base_url/SHA256SUMS"

expected="$(grep " \{1,2\}\*\{0,1\}${archive}\$" "$tmp/SHA256SUMS" | cut -d' ' -f1 || true)"
[ -n "$expected" ] || err "no checksum for $archive in SHA256SUMS"

actual="$(sha256_of "$tmp/$archive")"
if [ "$expected" != "$actual" ]; then
  err "checksum mismatch for $archive
  expected: $expected
  actual:   $actual
Refusing to install. Please report this at https://github.com/$REPO/issues"
fi

info 'Extracting ...'
tar -xzf "$tmp/$archive" -C "$tmp" || err "failed to extract $archive"
[ -f "$tmp/dnm" ] || err "archive did not contain the expected 'dnm' binary"

mkdir -p "$INSTALL_DIR" || err "could not create $INSTALL_DIR"
# Remove any existing binary first: overwriting in place fails with ETXTBSY on
# some systems if the old dnm is still running.
rm -f "$INSTALL_DIR/dnm"
mv "$tmp/dnm" "$INSTALL_DIR/dnm" || err "could not install to $INSTALL_DIR"
chmod +x "$INSTALL_DIR/dnm"

installed_version="$("$INSTALL_DIR/dnm" --version 2>/dev/null | head -n1 || echo 'unknown')"

info ""
info "Installed dnm ($installed_version) to $INSTALL_DIR/dnm"

# ── PATH hint ────────────────────────────────────────────────────────────────

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    info "Run 'dnm --help' to get started."
    ;;
  *)
    info ""
    info "$INSTALL_DIR is not on your PATH. Add it by running:"
    info ""
    info "  export PATH=\"$INSTALL_DIR:\$PATH\""
    info ""
    info 'To make it permanent, add that line to your shell profile'
    info '(~/.zshrc, ~/.bashrc, or equivalent).'
    ;;
esac
