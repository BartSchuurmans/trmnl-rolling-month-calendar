# Upstream

Forked from [usetrmnl/plugins](https://github.com/usetrmnl/plugins), `lib/calendars` and
`lib/google_calendar`, as of 2026-09-28. That repository has no license file; TRMNL
treats its native plugins as source-available and is fine with them being remixed. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

| Upstream | Here |
|---|---|
| `lib/calendars/_full_month.html.erb` (`event_layout == 'rolling_month'`) | the `rolling_calendar` markup and the `cfg` object in `shared.liquid`, printed by `full.liquid`, the half views and `quadrant.liquid` |
| `lib/calendars/_common.html.erb` (`trmnlInitCalendars`) | `plugin/src/shared.liquid` |
| `lib/google_calendar/google_calendar.rb` (`prepare_events`, filters, `time_min`/`time_max`) | `trmnlRollingCalendar` in `shared.liquid` (incl. `fromIcal`), `polling_url` in `settings.yml` |

## Kept as upstream

- FullCalendar `rollingMonth` view: `dayGridMonth` with a week duration,
  `fixedWeekCount: false`, `dateAlignment: 'day'` for daily advancement.
- Rendering 6 weeks, then re-rendering with only the weeks that fit on screen (see
  Changed for how many at least).
- Day cells show only the number; the 1st of a month gets a month-name label.
- The ResizeObserver reflow fix for multi-day events (usetrmnl/core#2951).
- `displayEventEnd: true`, ISO week numbers, `eventTimeFormat`, the `now` / `initialDate`
  settings, and the `highlight-today` / `no-weekend-shading` classes.
- Event handling: `Busy` for events without a summary, ignored phrases (contains and
  exact match, on title and description), de-duplication across calendars, sorting by start.

## Changed

- **Data source**: ICS feeds (parsed by LaraPaper), TRMNL's native calendar plugins'
  parsed events (on TRMNL.com, picked in Plugin Merge dropdowns, see
  `plugin/trmnl-com-merge/`) or Home Assistant's `/api/calendars/<entity>` REST
  endpoint, polled by the server, instead of the Google Calendar API. All are turned into FullCalendar events in the browser; upstream does
  that server-side in `Calendar::Helper`, which is not public. With ICS feeds the grid
  ends at the last week the feed covers (LaraPaper keeps 45 days ahead, 30 before 0.44.0).
- **Time zones**: timed events are converted to the configured zone's wall-clock time and
  given to FullCalendar with `timeZone: 'UTC'`, so the result doesn't depend on the
  renderer's system zone. Day numbers and month labels read UTC dates to match.
- **FullCalendar**: the open-source 7.1 build instead of the private build at
  trmnl.com, loaded from `/rolling-month-calendar/...` (served by the LaraPaper (local) app) with
  jsDelivr as fallback (on TRMNL.com, jsDelivr only). No `schedulerLicenseKey`, since dayGrid doesn't need one.
- **Styles**: upstream links `plugins/calendars` and `plugins/calendars_full_month`
  stylesheets that aren't published. Here the look is a FullCalendar 7 theme written from
  scratch ("Mono" in `shared.liquid`: class hooks naming the grid's parts, CSS sized with
  `--ui-scale`), on FullCalendar's skeleton.css only. Fonts, text sizes and greys come
  from TRMNL framework classes added through the same hooks.
- **Event look**: matched to upstream's month-layout preview. Timed events use
  FullCalendar's dot, restyled as a grey bar on the left, with a bold title
  and the time in grey below it. Multi-day events get a light grey fill (`bg--gray-70`)
  with a bold title; events from a coloured calendar have bold titles too. Single-day all-day events differ from upstream (which fills them
  too): they are drawn like timed events, with the bar and no time.
  Bands that go on in another week have a pointed end on that side (upstream: square),
  and a timed event over several days shows its title on one line between its start time
  (at the band's left end) and its end time (at the right end), each under its own day;
  over several weeks, the start time is in its first week and the end time in its last
  (FullCalendar shows the whole range, below the title, in every week). Narrow views keep
  the start time below the title.
  Titles differ too: every title, of any kind of event, wraps over at most two lines and
  then ends in an ellipsis, where upstream wraps timed titles in full.
- **Text size**: 16px like upstream, but on TRMNL.com it follows the device's Scale and
  Text Scale (`--text-ui-scale`). LaraPaper derives Scale from the screen width (the X is
  always xxlarge), so there it follows the device and Text Scale only, and the
  `event_text_size` setting (new here, LaraPaper only) can make event text smaller.
  Grid lines are thin grey (dotted on 1-/2-bit), headers are centred and bold with the
  weekend shaded, and day numbers are small.
- **Busy weeks**: upstream keeps at least 4 weeks, so a very busy month is cut off at
  the bottom. Here the `week_overflow` setting either shows only the weeks that fit
  (down to 1, the default) or keeps at least 3 and caps days with FullCalendar's
  `dayMaxEvents` ("+N more").
- **Day headers and today**: weekday names are small, uppercase and letter-spaced
  instead of `text--base`; month labels use the short month name ("Sep") instead of the
  long one, which got cut off. A past day's month label is muted like its number, and
  only the 1st of a month gets a bold number (FullCalendar also bolds the grid's first day). Today's weekday is also inverted in the header row,
  on top of upstream's pill around the number (now bold). Events that are over are faded
  (`fade_past_events`, greyscale screens only).
- **1-/2-bit screens**: weekend shading only in the header row, and
  event times in solid black instead of `text--muted`, since grey patterns break up
  the pixel fonts.
- **Title bar**: the framework's `title_bar` with the visible date range replaces
  FullCalendar's `headerToolbar` (`month_header`).
- **Half and quadrant views** (`half_horizontal`, `half_vertical`, `quadrant`): new here,
  the same markup as the full view (upstream's month layouts are full-screen only). Grids
  under 600 CSS px wide (`.trmnl-calendar--narrow`) show start times only, with tighter
  spacing, and titles over up to three lines that break between words where they can.
  A one-week grid has no day numbers in FullCalendar 7, so its header names the dates
  ("Mon 5").
- **Removed**: time-grid helpers (`trmnlAllDaySlotAuto`, `trmnlSlotBoundsAuto`, the
  week-view now indicator, `dayHeaders`), the Google colour options (`colorize_events`,
  `palette_colors`), replaced by per-calendar colours, and the
  RSVP filter (`ignore_based_on_acceptance?`), because HA doesn't expose attendees.
- **Colors**: upstream colours events from Google's calendar/event colours
  (`colorize_events`). HA has none, so each calendar gets a configured colour. Framework
  colour names go through `bg--*` classes; on 1-/2-bit screens the text gets
  `text-stroke`, like upstream's `adaptiveEventStroke`.
- **Added**: optional per-calendar prefixes, a line above the grid naming any
  calendar that failed to load, and an optional daily weather forecast (icon and high,
  optionally the low) next to the day numbers from today on: from a Home Assistant
  weather entity through the LaraPaper (local) app's proxy, or on TRMNL.com from TRMNL's
  Weather plugin or the Daily Weather recipe (Open-Meteo).
- **Settings**: exposed as custom fields (`settings.yml`) and read from
  `trmnl.plugin_settings.custom_fields_values`.
