#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if ! command -v zip >/dev/null 2>&1; then
  echo "zip command was not found. Install zip and retry." >&2
  exit 1
fi

npm run package

version="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).Version)")"
release_dir="dist/release"
zip_path="$release_dir/streamdock-obs-websocket-$version.zip"
staging_dir="$release_dir/streamdock-obs-websocket-$version"

mkdir -p "$release_dir"
rm -f "$zip_path"
rm -rf "$staging_dir"
mkdir -p "$staging_dir"

cp -R dist/stream-dock-obs-websocket.sdPlugin "$staging_dir/"
cp scripts/install-local.ps1 "$staging_dir/"

(
  cd "$staging_dir"
  zip -qr "$root/$zip_path" .
)

rm -rf "$staging_dir"
echo "Wrote $zip_path"
