#!/usr/bin/env sh
# Render checks run by .github/workflows/render.yml (and locally, same prerequisites as
# render.mjs plus PHP with composer's vendor/ in preview/php). Screenshots land in
# preview/out/ci. Any render that errors or doesn't finish fails the run.
#
# Renders run in parallel, JOBS at a time (default: one per CPU); each one's output is
# printed when it finishes, and the run fails at the end if any of them failed.
set -eu
cd "$(dirname "$0")"
out=out/ci
rm -rf "$out"
mkdir -p "$out"
jobs="${JOBS:-$(nproc 2> /dev/null || echo 2)}"

# A pipe holding one token per free slot: a job takes one to start and puts it back
# when it's done
slots="$(mktemp -u)"
mkfifo "$slots"
exec 3<> "$slots"
rm "$slots"
i=0
while [ "$i" -lt "$jobs" ]; do echo >&3; i=$((i + 1)); done

# spawn <name> <command...>: runs the command in the background once a slot is free
spawn() {
    name="$1"
    shift
    read -r _ <&3
    (
        if "$@" > "$out/$name.log" 2>&1; then status=ok; else status=FAILED; echo "$name" >> "$out/failed"; fi
        { echo "== $name ($status)"; cat "$out/$name.log"; }
        echo >&3
    ) &
    last=$!
}

render_now() {
    name="$1"
    shift
    timeout 90 node render.mjs --strict --tz Europe/Amsterdam --out "$out/$name.png" "$@"
}

render() {
    spawn "$1" render_now "$@"
}

# Same input through LaraPaper's Liquid engine (keepsuit/liquid, PHP)
php_render() {
    php php/render.php "$2" > "$3"
    render_now "$1" --body "$3"
}

# Same input through trmnlp (Ruby Liquid, as on TRMNL), which passes several calendars as
# IDX_0, IDX_1, ... without `data`; needs Docker, which CI has
trmnlp_render() {
    node trmnlp.mjs "$2" "$3" ${4:+"$4"}
    render_now "$1" --body "$3" --expect-events
}
trmnlp_lint_test() {
    lint=0
    node trmnlp.mjs --lint || lint=1
    node trmnlp.mjs --test "$out/context-merge-weather.json" "$out/trmnlp-test" && [ $lint = 0 ]
}
trmnlp=
if command -v docker > /dev/null || [ -n "${CI:-}" ]; then
    trmnlp=yes
    # fetch the image while the other renders run
    node trmnlp.mjs --pull > "$out/trmnlp-pull.log" 2>&1 &
    pull=$!
fi

# The variants' settings (plugin/trmnl-com-merge, ...) in step with plugin/src's (no rendering)
spawn variants node variants.mjs check

# docs/sample-ics (TRMNL.com's marketplace preview) in step with the sample calendars
spawn sample-ics node sample-data.mjs check

# The stand-in Home Assistant (sample-server/worker.mjs) with TRMNL.com's serverless function
spawn stand-in node transforms.mjs

# The contexts for the PHP and trmnlp renders, first so those can start early
render liquidjs-x --set calendar_colors=black,-,gray-65 --dump-context "$out/context.json"
context=$last
render liquidjs-ics-x --ics --dump-context "$out/context-ics.json"
context_ics=$last

# Sample calendars with different settings, on the TRMNL X and a 1-bit OG
render sample-x
render sample-og --device og
render sample-og-2bit --device og2
render colors-x --set calendar_colors=black,-,gray-65 --set calendar_labels=-,M:,S: --set month_header=true
# Dark mode (the plugin's dark_mode setting), with coloured calendars and a forecast
render dark-x --dark --set calendar_colors=gray-35,white,gray-60 --set calendar_labels=-,M:,S: --set weather_entity=weather.forecast_home
render dark-og --device og --dark --set calendar_colors=gray-35,white,gray-60 --set calendar_labels=-,M:,S:
render dark-og-2bit --device og2 --dark --set calendar_colors=black,-,gray-50 --set highlight_today=true
# The settings that are on by default turned off, and events hidden by title
render off-x --set highlight_today=false --set shade_weekends=false --set include_event_time=false \
    --set fade_past_events=false --set ignored_phrases=Gym --set ignored_phrases_exact_match=Standup
# (yes/no: the on/off settings as installs from before the boolean fields saved them)
render options-x --set locale=nl --set first_day=0 --set show_week_numbers=yes --set time_format=am/pm \
    --set display_event_end=no --set rolling_advancement=day --set include_past_events=no

# The sample as ICS feeds, as LaraPaper hands them over (45 days ahead; before 0.44.0,
# 30 days ahead and no all-day flag: fewer weeks)
render ics-x --ics
render ics-og --device og --ics-0.43 --set calendar_colors=black,-,gray-50 --set calendar_labels=-,M:,S:
render ics-options-x --ics --set rolling_advancement=day --set first_day=0 --set week_overflow=more

# A weather entity's forecast next to the day numbers (sample forecast)
render weather-x --set weather_entity=weather.forecast_home --set show_week_numbers=true --set month_header=true
render weather-lows-og --device og --set weather_entity=weather.forecast_home --set weather_temperatures=high_low
render weather-ics-half-vertical-x --ics --size half_vertical --set weather_entity=weather.forecast_home --set show_week_numbers=true --expect-events

# The sample as TRMNL.com's Plugin Merge dropdowns (plugin/trmnl-com-merge/merge.liquid)
render merge-x --merge --expect-events --set calendar_colors=black,-,gray-50 --set calendar_labels=-,M:,S:
# ... at TRMNL.com's default screen scale (regular; LaraPaper's X is xxlarge)
render merge-regular-x --merge --scale regular --expect-events
# ... with a forecast from the Weather dropdown: TRMNL's Weather plugin, an Open-Meteo recipe
render merge-weather-trmnl-x --merge-weather trmnl --expect-events --set weather_temperatures=high_low \
    --dump-context "$out/context-merge-weather.json"
context_merge_weather=$last
render merge-weather-open-meteo-og --device og --merge-weather open-meteo --expect-events --set show_week_numbers=true

# The half and quadrant views, as part of a mashup
render half-horizontal-x --size half_horizontal --expect-events
render half-vertical-x --size half_vertical --expect-events
render half-vertical-og --device og --size half_vertical --expect-events
render quadrant-x --size quadrant --expect-events
render quadrant-og --device og --size quadrant --expect-events

# The contexts are written by now (their renders were the first to start)
wait "$context" "$context_ics" "$context_merge_weather" || true
spawn php-x php_render php-x "$out/context.json" "$out/php-body.html"
spawn php-ics-x php_render php-ics-x "$out/context-ics.json" "$out/php-ics-body.html"

# Random calendars (1-4, sparse to dense) catch layouts that don't settle
for seed in 1 2 3 4 5 6 7 8 9 10 11 12; do
    device=x
    [ $((seed % 3)) -eq 0 ] && device=og
    settings="$(node random-data.mjs "$seed" "$out/random-$seed.json")"
    IFS='
'
    # shellcheck disable=SC2086 # split on newlines: one --set or value per line
    render "random-$seed-$device" --device "$device" --data "$out/random-$seed.json" $settings
    # every fourth one again as ICS feeds
    [ $((seed % 4)) -eq 0 ] && render "random-$seed-$device-ics" --device "$device" --data "$out/random-$seed.json" --ics $settings
    unset IFS
done

# Busy weeks capped with "+N more" instead of showing fewer weeks
IFS='
'
# shellcheck disable=SC2086 # split on newlines, as above
render random-8-more-x --data "$out/random-8.json" $(node random-data.mjs 8 /dev/null) --set week_overflow=more
unset IFS

if [ -n "$trmnlp" ]; then
    if ! wait "$pull"; then
        cat "$out/trmnlp-pull.log"
        echo trmnlp-pull >> "$out/failed"
    fi
    spawn trmnlp-x trmnlp_render trmnlp-x "$out/context.json" "$out/trmnlp-body.html"
    spawn trmnlp-ics-x trmnlp_render trmnlp-ics-x "$out/context-ics.json" "$out/trmnlp-ics-body.html"
    spawn trmnlp-half-vertical-x trmnlp_render trmnlp-half-vertical-x "$out/context.json" "$out/trmnlp-half-vertical-body.html" half_vertical
    spawn trmnlp-quadrant-x trmnlp_render trmnlp-quadrant-x "$out/context.json" "$out/trmnlp-quadrant-body.html" quadrant
    # TRMNL's best-practice checks, as LaraPaper and TRMNL.com run the recipe, then the
    # TRMNL.com variants' own tests (trmnlp test: their polling, serverless function, Plugin
    # Merge lookups and views on TRMNL's devices; report in $out/trmnlp-test/<variant>/).
    # One after the other: both build the variants into dist/
    spawn trmnlp-lint-test trmnlp_lint_test
else
    echo "== trmnlp skipped (no Docker)"
fi

wait
if [ -s "$out/failed" ]; then
    echo "Failed:"
    cat "$out/failed"
    exit 1
fi
