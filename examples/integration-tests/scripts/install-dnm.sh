#!/bin/sh
# Installs the dnm CLI into ./.dnm/bin, at the release matching the @denex/network-manager version
# in package.json. That version is the one pin for both the CLI and the SDK: bump it there and this
# script, the npm scripts and CI all follow.
set -eu

cd "$(dirname "$0")/.."

version="$(node -p "require('./package.json').devDependencies['@denex/network-manager']")"
tag="v$version"
bin_dir="$PWD/.dnm/bin"

if [ -x "$bin_dir/dnm" ] && [ "$(NO_COLOR=1 "$bin_dir/dnm" --version)" = "dnm $version" ]; then
  echo "dnm $version is already installed in $bin_dir"
  exit 0
fi

# install.sh from the same tag, saved to a file first: `curl | sh` would run an empty script and
# succeed if the download failed. install.sh verifies the binary against the release's SHA256SUMS.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL -o "$tmp" "https://raw.githubusercontent.com/denex-io/denex-network-manager/$tag/install.sh"
DNM_VERSION="$tag" DNM_INSTALL_DIR="$bin_dir" sh "$tmp"
