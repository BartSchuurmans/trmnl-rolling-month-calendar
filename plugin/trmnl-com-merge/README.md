# The recipe on TRMNL.com

TRMNL.com runs the same markup as `plugin/src`, with a different data source: the
[Plugin Merge](https://help.trmnl.com/) strategy instead of polling. Installers pick
their TRMNL calendar plugins (Google, Outlook, Apple, CalDAV, ...) in "Calendar"
dropdowns (`plugin_instance_select` without a `plugin_keyname`, so every plugin type is
listed); no plugin IDs or API key to look up.

How the data arrives: each dropdown stores the name TRMNL gives the chosen plugin's data
(for example `caldav_12345`), and the data sits at the top level under that name, in the
same shape as the Plugin Data API (`{events: [...], tz, ...}`). `merge.liquid` looks
each one up (`{{ [name] }}`) and passes them to `shared.liquid` as
`{IDX_0: ..., IDX_1: ...}`. The **Weather** dropdown (`weather_plugin`) works the same
way and comes last: TRMNL's Weather plugin (`{forecast: {today, tomorrow}}`, no dates) or
the Daily Weather recipe (Open-Meteo's `{daily: {time,
weather_code, ...}}`, which TRMNL.com wraps as `{merge_variables: ...}` like any private
plugin's or recipe's data, under `private_plugin_<id>`); `shared.liquid` reads both. It is a separate file because LaraPaper's Liquid (keepsuit)
can't parse that lookup; `render.mjs --merge` renders with it.

## Built from the repo

This folder holds only what differs from `../src`: `settings.yml` (Plugin Merge, framework
3.4.0, bleed margin removed, its form fields) and `merge.liquid`, which goes in front of
the shared markup. `scripts/build-variant.sh trmnl-com-merge` builds the plugin, and releases
upload it to TRMNL.com; see [the variants overview](../README.md). Don't edit the plugin
on TRMNL.com itself.
