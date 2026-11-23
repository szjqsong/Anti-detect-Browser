#!/bin/bash
# Downloads the fingerprint-chromium macOS kernel into vendor/kernel/ for bundling.
set -euo pipefail

VERSION="148.0.7778.215"
SHA256="b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679"
URL="https://github.com/adryfish/fingerprint-chromium/releases/download/${VERSION}/ungoogled-chromium_${VERSION}-1.1_macos.dmg"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/kernel"
TMP="$(mktemp -d)"
trap 'hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT

if [[ -f "$DEST/VERSION" && "$(cat "$DEST/VERSION")" == "$VERSION" && -d "$DEST/Chromium.app" ]]; then
  echo "Kernel $VERSION already present."
  exit 0
fi

echo "Downloading fingerprint-chromium $VERSION ..."
curl -L --fail --retry 3 -o "$TMP/kernel.dmg" "$URL"
echo "$SHA256  $TMP/kernel.dmg" | shasum -a 256 -c -

mkdir -p "$TMP/mnt"
hdiutil attach -nobrowse -readonly -mountpoint "$TMP/mnt" "$TMP/kernel.dmg" >/dev/null
rm -rf "$DEST/Chromium.app"
mkdir -p "$DEST"
ditto "$TMP/mnt/Chromium.app" "$DEST/Chromium.app"
xattr -cr "$DEST/Chromium.app"
curl -sL --fail -o "$DEST/LICENSE-fingerprint-chromium.txt" \
  https://raw.githubusercontent.com/adryfish/fingerprint-chromium/main/LICENSE
echo "$VERSION" > "$DEST/VERSION"
echo "Kernel $VERSION installed to $DEST"
