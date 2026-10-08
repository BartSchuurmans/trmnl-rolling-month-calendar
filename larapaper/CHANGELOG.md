# Changelog

## 0.44.0-2

### Home Assistant app

- The bundled TRMNL framework is now 3.4.0, the version LaraPaper 0.44.0 uses by default,
  so recipes render the same here as in LaraPaper elsewhere and on trmnl.com.

## 0.44.0-1

### LaraPaper 0.44.0

From the [LaraPaper 0.44.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.44.0):

This release expands firmware OTA support for TRMNL BWRY, updates iCal parsing with expanded date ranges, adds recipe catalog sorting options and reworks key UI views with a new design. TRMNL Framework is bumped to version 3.4.0.

#### What's Changed
* feat: add Liquid support to Markup plugin
* feat: add support for TRMNL BWRY firmware OTA updates
* feat: upgrade to om/icalparser major version 5
* feat: upgrade to new IcalParser v5 API
* feat(#292): increase iCal date window from (-7, +30) days to (-7, +45) days by [@BartSchuurmans](https://github.com/BartSchuurmans) in [#301](https://github.com/usetrmnl/larapaper/pull/301)
* feat(#295): implement HTML purification for recipe settings field author bio, description, help_text
* feat: add GET and PATCH /api/devices/{id} in the shape of TRMNL's API by [@BartSchuurmans](https://github.com/BartSchuurmans) in [#306](https://github.com/usetrmnl/larapaper/pull/306)
* feat: added sorting options in TRMNL recipe catalog
* feat: enable MCP stdio server on local environments
* feat: add support for `TRMNL_BLADE_FRAMEWORK_BASE_URL`
* feat: rework dashboard with view with `flux:card`
* feat: rework device and playlist view with `flux:card`
* feat: rework plugin grid view with `flux:card`
* fix(#297): support `no_screen_padding` and `dark_mode` in recipe configuration
* fix(#267): add css model identifier warning
* fix(#291): reset image cache when render-affecting settings change
* fix(#294): links in recipe description fields open new tab
* fix: mobile optimize devices overview screens
* fix: remove fixed width and height from app logo SVG
* fix: remove unused inter font via bunny cdn
* fix: support serving under a sub-path via X-Forwarded-Prefix by [@BartSchuurmans](https://github.com/BartSchuurmans) in [#304](https://github.com/usetrmnl/larapaper/pull/304)
* chore: update TRMNL Framework to 3.4.0
* chore: add transform incompatibility warning
* chore: fix Dev Container by [@BartSchuurmans](https://github.com/BartSchuurmans) in [#300](https://github.com/usetrmnl/larapaper/pull/300)

#### New Contributors
* [@BartSchuurmans](https://github.com/BartSchuurmans) made their first contribution in [#300](https://github.com/usetrmnl/larapaper/pull/300)

#### New Supporters
Thank you for your support: Johan, 16tools.com and jfkmdd

**Full Changelog**: [0.43.1...0.44.0](https://github.com/usetrmnl/larapaper/compare/0.43.1...0.44.0)

### Home Assistant app

- Updated to LaraPaper 0.44.0. For the calendar recipe: saving a recipe's settings shows
  the new screen right away, ICS feeds reach 45 days ahead (the calendar now shows 6
  weeks of them) and mark all-day events, recipes set **Remove bleed margin?** themselves,
  and links in recipe settings open in a new tab.

## 0.43.1-8

- Each TRMNL's device in Home Assistant now also shows the **Screen** it was last given,
  as an image you can put on a dashboard.
- You can change the TRMNL from Home Assistant: **Sleep mode** with its **Sleep from**
  and **Sleep until** times, the **Refresh interval**, and **Install** on the firmware
  update. The TRMNL picks the change up the next time it wakes, as when you change it
  in LaraPaper.
- **Refresh screen** fetches the data of the TRMNL's recipes and renders them again
  right away, so the TRMNL shows fresh screens the next time it wakes (it can't be
  woken from the server).

## 0.43.1-7

- Each TRMNL shows up in Home Assistant as a device, with its battery, charging,
  Wi-Fi signal, firmware (as an update), last check-in and any attached sensors. This
  goes through MQTT, so it needs the **Mosquitto broker** app; the app finds it by
  itself. Several TRMNLs each get their own device. The new **Device sensors in Home
  Assistant** option (on by default) turns this off.

## 0.43.1-6

- Screens are rendered ahead of time. LaraPaper renders a recipe only when the TRMNL
  asks for its screen, and the TRMNL gives up after 15 seconds, so on a slower Home
  Assistant machine every refresh could fail with "read Timeout". The app now renders
  each recipe in a device's playlists shortly before it would go out of date, so the
  TRMNL gets a ready screen and refreshes (including the button) are quick. The new
  **Render screens ahead of time** option (on by default) turns this off.

## 0.43.1-5

- Opening the web UI from Home Assistant no longer shows "405 Method Not Allowed":
  it now starts at the dashboard (or the login page).

## 0.43.1-4

- The web UI opens inside Home Assistant (**Open Web UI**, or **Show in sidebar**), so
  you can reach it wherever you reach Home Assistant, without opening a port to the
  internet. You still log in to LaraPaper there. The TRMNL keeps using port 4567, and
  so can your browser at home.

## 0.43.1-3

- The app's Home Assistant access also serves daily weather forecasts, for the
  calendar recipe's new **Home Assistant weather entity** setting. It forwards only a
  daily `weather.get_forecasts` call for one `weather.*` entity, as before only from
  inside the app.

## 0.43.1-2

- FullCalendar 7.1.0 is built in next to 6.1.21. The next calendar recipe release uses
  FullCalendar 7 and renders without internet only with this app version; recipes
  up to v1.9.0 keep using 6.1.21.

## 0.43.1-1

- LaraPaper 0.43.1, with a newer ICS parser (om/icalparser 4.1.4).

## 0.43.0-6

- The project is now called Rolling Month Calendar
  (`github.com/BartSchuurmans/trmnl-rolling-month-calendar`), because the calendar
  recipe also reads ICS feeds now. The app serves FullCalendar under
  `/rolling-month-calendar/` instead of `/ha-calendar/`, and the recipe ZIP is now
  `rolling-month-calendar.zip`. Import that ZIP from the latest release: it installs as
  a new recipe, so set it up again and remove the old one.

## 0.43.0-5

- The app is now installed from a prebuilt image (`ghcr.io/bartschuurmans/larapaper-local`)
  instead of being built on your Home Assistant, so installs and updates are faster
  and no longer download the framework, fonts and FullCalendar on your system.

## 0.43.0-4

- The calendar recipe no longer needs a long-lived access token. The app reads your
  calendars with its own Home Assistant access, through `http://127.0.0.1:8124`, the
  recipe's new default Home Assistant URL. A recipe you already set up keeps its URL and
  token: change the URL to `http://127.0.0.1:8124` and clear the token to switch.

## 0.43.0-3

- Include the license texts of the bundled TRMNL framework, fonts and FullCalendar
  next to them in the image.

## 0.43.0-2

- Enable PHP OPcache, as LaraPaper's own docker-compose setup does, so pages and
  renders need less CPU.

## 0.43.0-1

- First release: LaraPaper 0.43.0 with the TRMNL framework 3.3.1, its fonts and
  FullCalendar 6.1.21 built into the image, so rendering a screen needs no internet.
- The database, generated screens and app key are kept in `/data`.
