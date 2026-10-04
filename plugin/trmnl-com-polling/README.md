# The Home Assistant recipe on TRMNL.com

**Rolling Month Calendar (Home Assistant)**: the markup of `plugin/src`, polling Home
Assistant's calendar API (`/api/calendars/<entity>`) as `plugin/src` does, but from
TRMNL's servers. So Home Assistant has to be reachable from the internet (Home Assistant
Cloud's remote URL, or an own domain), and every request carries a long-lived access
token (`Authorization: Bearer`).

What it leaves out of `plugin/src` (see `VARIANTS` in `preview/variants.mjs`):

- **ICS feeds**: TRMNL.com only polls JSON (an `.ics` URL fails as "Malformed JSON").

**Weather** comes from `transform.js`, TRMNL.com's serverless function for this plugin.
Home Assistant gives forecasts only to `weather.get_forecasts`, a POST, while its
calendars answer only GET, and TRMNL.com polls every URL with the same verb and body. So
after the calendars are polled, the function makes that call itself (to **Home Assistant
URL**, with the token) and adds the response last, in the shape the LaraPaper (local)
app's proxy gives (`{service_response: ...}`). A failed call shows as "Could not load
<entity>" and the calendars still show. Its tests (`tests/`, run by `trmnlp test` in
`ci.sh`) run it against a fake Home Assistant and draw the result.

The data arrives as on TRMNL for any polling recipe: one calendar's list under `data`,
several as `IDX_0`, `IDX_1`, ... at the top level, which `shared.liquid` already reads.
The tests poll and draw it through trmnlp, as TRMNL does.

## Built from the repo

This folder holds `settings.yml` (polling URL and header, framework 3.3.1, bleed margin
removed, its form fields) and `transform.js`.
`scripts/build-variant.sh trmnl-com-polling` builds the plugin, and releases upload it to
TRMNL.com once the `TRMNL_PLUGIN_ID_POLLING` variable names its plugin; see [the variants
overview](../README.md). Don't edit the plugin on TRMNL.com itself.

## Trying it without your own Home Assistant

[`preview/sample-server/`](../../preview/sample-server/README.md) is a stand-in Home Assistant on
Cloudflare Workers with the sample calendars (the six-week cycle of
`preview/sample-data.mjs`) and a forecast for `weather.forecast_home`: set **Home
Assistant URL** to its workers.dev URL, any text as the token, `calendar.family`,
`calendar.mark`, `calendar.sara` as the entities and `weather.forecast_home` as the
weather entity.

Without it, `docs/sample-ha/` serves the same calendars as static files, but no
weather. Set **Home Assistant URL** to
`https://cdn.jsdelivr.net/gh/BartSchuurmans/trmnl-rolling-month-calendar@main/docs/sample-ha`,
any text as the token, and `calendar.family`, `calendar.mark`, `calendar.sara` as the
entities. jsDelivr ignores the `?start=&end=` window and the token, so each file holds
every occurrence up to `SAMPLE_HA_END` there; move that on (and `write`) before it
passes. raw.githubusercontent.com doesn't work: it answers 404 to any request with an
`Authorization` header, and the recipe always sends one. The stand-in has no weather (a static
file can't answer the forecast's POST): leave **Home Assistant weather entity** empty, or
it shows "Could not load".
