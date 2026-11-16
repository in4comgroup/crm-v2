#!/bin/sh
# Regenerates cards/*.png from cards/*.svg. macOS only (uses qlmanage). Idempotent.
set -e
cd "$(dirname "$0")/cards"
tmp=$(mktemp -d)
for f in *.svg; do
  n=${f%.svg}
  qlmanage -t -s 1000 -o "$tmp" "$f" >/dev/null 2>&1
  mv -f "$tmp/$f.png" "$n.png"
done
rmdir "$tmp"
