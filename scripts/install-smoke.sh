#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright Cumberland Applications LLC 2026
#
# Installs dnm with install.sh from a directory of release archives (dnm-<os>-<arch>.tar.gz plus
# SHA256SUMS) in a clean ubuntu:24.04 container, as a user would, through DNM_BASE_URL and into a
# DNM_INSTALL_DIR that is not the default. Then checks that the installed binary is the one in the
# archive (so a download from anywhere else fails), `dnm --version`, and that `dnm config -y`
# writes a config. The container has only curl and ca-certificates added.
#
#   scripts/install-smoke.sh <dist-dir> <expected-version>
#
# The container runs on the host's architecture, so <dist-dir> needs that linux archive and no
# other linux archive.

set -eu

[ $# -eq 2 ] || { echo "usage: $0 <dist-dir> <expected-version>" >&2; exit 2; }
dist="$(cd "$1" && pwd)"
expected="$2"
root="$(cd "$(dirname "$0")/.." && pwd)"

docker run --rm \
  -v "$dist:/dist:ro" \
  -v "$root/install.sh:/install.sh:ro" \
  -e EXPECTED="dnm $expected" \
  -e NO_COLOR=1 \
  ubuntu:24.04 sh -euc '
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null
    DNM_BASE_URL=file:///dist DNM_INSTALL_DIR=/opt/dnm/bin sh /install.sh
    [ ! -e "$HOME/.dnm/bin/dnm" ] || { echo "installed to the default dir, not DNM_INSTALL_DIR" >&2; exit 1; }
    mkdir /tmp/archive
    tar -xzf /dist/dnm-linux-*.tar.gz -C /tmp/archive
    cmp /tmp/archive/dnm /opt/dnm/bin/dnm || { echo "installed binary is not the one in /dist" >&2; exit 1; }
    echo "installed binary is the one in /dist"
    version="$(/opt/dnm/bin/dnm --version)"
    echo "dnm --version: $version"
    [ "$version" = "$EXPECTED" ] || { echo "expected: $EXPECTED" >&2; exit 1; }
    cd "$(mktemp -d)"
    /opt/dnm/bin/dnm config -y >/dev/null
    [ -s localnet.yaml ] || { echo "dnm config -y wrote no localnet.yaml" >&2; exit 1; }
    echo "dnm config -y wrote localnet.yaml"
  '
