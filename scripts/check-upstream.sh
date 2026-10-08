#!/usr/bin/env sh
# Compare the upstream versions Dependabot doesn't bump (see .github/dependabot.yml) with
# their latest releases. Each of these moves several files at once, so they are bumped by
# hand (CLAUDE.md, "Bumping LaraPaper ...").
#
#   sh scripts/check-upstream.sh            print what is behind
#   sh scripts/check-upstream.sh --issues   also open an issue per dependency that is
#                                           behind, or retitle its open one; a closed issue
#                                           for the same version skips it (needs gh and
#                                           GH_TOKEN; .github/workflows/upstream.yml)
#
# Only stable releases (X.Y.Z, optionally with a leading v) count.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
issues=false
[ "${1:-}" = --issues ] && issues=true

# Highest stable tag of a GitHub repository, without its leading v.
latest_tag() {
    git ls-remote --tags --refs "https://github.com/$1.git" \
        | sed 's#.*refs/tags/##' | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' \
        | sort -V | tail -n 1
}

# Versions a LaraPaper release ships that the repo mirrors (preview/php, settings.yml).
larapaper_notes() {
    lock=$(curl -fsSL "https://raw.githubusercontent.com/usetrmnl/larapaper/$1/composer.lock" 2>/dev/null) || return 0
    printf '%s' "$lock" | jq -r '.packages[]
        | select(.name == "keepsuit/liquid" or .name == "bnussbau/laravel-trmnl-blade")
        | if .name == "keepsuit/liquid"
          then "- It ships `keepsuit/liquid` \(.version); `preview/php/composer.json` pins the same version."
          else "- It ships `bnussbau/laravel-trmnl-blade` \(.version), which sets its default TRMNL framework version."
          end'
}

behind=0

# check <name> <pinned> <latest> <release URL> <what to change> [extra notes]
check() {
    name=$1 pinned=$2 latest=$3 url=$4 files=$5 notes=${6:-}
    if [ -z "$latest" ]; then
        echo "$name: pinned $pinned, couldn't read the latest release" >&2
        return
    fi
    if [ "$pinned" = "$latest" ] || [ "$(printf '%s\n%s\n' "$pinned" "$latest" | sort -V | tail -n 1)" = "$pinned" ]; then
        echo "$name: $pinned (latest)"
        return
    fi
    behind=$((behind + 1))
    echo "$name: $pinned, latest $latest"
    $issues || return 0

    title="Upstream: $name $latest is out (pinned: $pinned)"
    body=$(printf '%s\n\n%s\n\n%s%s\n' \
        "[$name $latest]($url) is out; this repo pins $pinned." \
        "To bump it, change: $files" \
        "${notes:+$notes

}" \
        "Opened by \`scripts/check-upstream.sh\` (.github/workflows/upstream.yml). It retitles this issue when a newer release comes out. Close it once the bump is merged, or to skip this version.")
    # An issue with this exact title, open or closed, already covers this release
    # (closing one dismisses that version).
    found=$(gh issue list --state all --search "in:title \"$title\"" --json number,title,state \
        --jq "map(select(.title == \"$title\")) | .[0].number // empty")
    [ -z "$found" ] || return 0
    open=$(gh issue list --state open --search "in:title \"Upstream: $name \"" --json number,title \
        --jq "map(select(.title | startswith(\"Upstream: $name \"))) | .[0].number // empty")
    if [ -z "$open" ]; then
        gh issue create --title "$title" --body "$body" >/dev/null
        echo "  opened an issue"
    else
        gh issue edit "$open" --title "$title" --body "$body" >/dev/null
        echo "  updated #$open"
    fi
}

pinned=$(sed -n 's/^ARG BUILD_FROM=.*://p' "$root/larapaper/Dockerfile")
latest=$(latest_tag usetrmnl/larapaper)
check LaraPaper "$pinned" "$latest" "https://github.com/usetrmnl/larapaper/releases/tag/$latest" \
    '`BUILD_FROM` in `larapaper/Dockerfile`, `version` in `larapaper/config.yaml` (`<version>-1`) and `larapaper/CHANGELOG.md` (LaraPaper'"'"'s notes from `sh scripts/larapaper-release-notes.sh <version>`, then `### Home Assistant app`).' \
    "$( [ -n "$latest" ] && larapaper_notes "$latest" )"

pinned=$(sed -n 's/^framework_version: *//p' "$root/plugin/src/settings.yml")
latest=$(latest_tag usetrmnl/trmnl-framework)
check "TRMNL framework" "$pinned" "$latest" "https://github.com/usetrmnl/trmnl-framework/releases/tag/v$latest" \
    '`larapaper/assets.txt` (paths and hashes), `larapaper/Dockerfile`, `.github/workflows/app.yml`, `framework_version` in every `plugin/*/settings.yml`, `e2e/run.mjs`, `preview/render.mjs`; then regenerate the README screenshots. Best done when LaraPaper moves its default framework version.'

pinned=$(jq -r '.dependencies.fullcalendar' "$root/preview/package.json")
latest=$(npm view fullcalendar version 2>/dev/null || true)
check FullCalendar "$pinned" "$latest" "https://github.com/fullcalendar/fullcalendar/releases" \
    '`larapaper/assets.txt` (paths and hashes), `plugin/src/shared.liquid`, `.github/workflows/app.yml`, `preview/package.json` (both packages); then regenerate the README screenshots.'

pinned=$(sed -n "s#^const IMAGE = 'trmnl/trmnlp:v\(.*\)';#\1#p" "$root/preview/trmnlp.mjs")
latest=$(latest_tag usetrmnl/trmnlp)
check trmnlp "$pinned" "$latest" "https://github.com/usetrmnl/trmnlp/releases/tag/v$latest" \
    '`IMAGE` in `preview/trmnlp.mjs` and `TRMNLP_IMAGE` in `.github/workflows/trmnl-com.yml`.'

echo "$behind behind"
