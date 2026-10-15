#!/usr/bin/env sh
# Regenerates the README screenshots in docs/ from the sample calendars. Run it after
# any change that alters how the calendar looks, and commit the images with it. Same
# prerequisites as render.mjs (see ci.sh). The date is fixed, so "today" and the sample
# events (sample-data.mjs) stay put and only real changes show up in the images.
# frame.mjs then puts each screen in TRMNL's device frame (TRMNL X or OG).
set -eu
cd "$(dirname "$0")"
docs=../docs
raw=out/docs
mkdir -p "$raw"
common="--strict --tz Europe/Amsterdam --now 2026-09-30 --set weather_entity=weather.forecast_home --set weather_temperatures=high_low \
    --set calendar_colors=gray-35,white,gray-60 --set calendar_labels=-,M:,S:"

# shellcheck disable=SC2086 # $common is a list of arguments
node render.mjs $common --out "$raw/preview.png"
# shellcheck disable=SC2086
node render.mjs $common --device og --out "$raw/preview-1bit.png"
# shellcheck disable=SC2086
node render.mjs $common --device og2 --out "$raw/preview-2bit.png"
# "Usual week" with a work calendar (render.mjs --work)
# shellcheck disable=SC2086
node render.mjs $common --work --set calendar_labels=-,M:,S:,M: --set calendar_colors=gray-35,white,gray-60,white \
    --set "calendar_usual_week=-,-,-,Mon-Thu 08:30-17:00" --out "$raw/usual-week.png"
rm -f "$raw"/preview*.html "$raw"/usual-week*.html

node frame.mjs --model x "$raw/preview.png" "$docs/preview.png"
node frame.mjs --model og "$raw/preview-1bit.png" "$docs/preview-1bit.png"
node frame.mjs --model og "$raw/preview-2bit.png" "$docs/preview-2bit.png"
node frame.mjs --model x "$raw/usual-week.png" "$docs/usual-week.png"
