#!/bin/sh
# Download the files listed in assets.txt, check their SHA-256 and install them.
#   fetch-assets.sh <assets.txt> <destination>
# A source URL of the form <tarball>!<member> installs that member of the tarball.
set -eu

manifest="$1"
dest="$2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --retry 3 -o "$2" "$1"
    else
        wget -q -O "$2" "$1"
    fi
}

grep -v '^#' "$manifest" | while read -r sum path url; do
    [ -n "$sum" ] || continue
    src="${url%%!*}"
    member=""
    case "$url" in *'!'*) member="${url#*!}" ;; esac

    file="$tmp/$(printf '%s' "$src" | sha256sum | cut -c1-16)"
    [ -f "$file" ] || fetch "$src" "$file"
    actual="$(sha256sum "$file" | cut -d' ' -f1)"
    if [ "$actual" != "$sum" ]; then
        echo "checksum mismatch for $src: expected $sum, got $actual" >&2
        exit 1
    fi

    mkdir -p "$dest/$(dirname "$path")"
    if [ -n "$member" ]; then
        tar -xzOf "$file" "$member" > "$dest/$path"
    else
        cp "$file" "$dest/$path"
    fi
    echo "installed $path"
done
