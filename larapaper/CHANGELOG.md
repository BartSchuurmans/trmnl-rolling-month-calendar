# Changelog

## 0.46.0-2

### Home Assistant app

- Bundles TRMNL framework 3.4.6 (LaraPaper 0.46.0's default) instead of 3.4.0, for the calendar recipe from the next release on.

## 0.46.0-1

### LaraPaper 0.46.0

From the [LaraPaper 0.46.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.46.0):

#### SECURITY RELEASE (2) 🚨

This release fixes two security vulnerabilities, one of them Critical, see advisories [GHSA-f3rp-5j6r-j7cp](https://github.com/usetrmnl/larapaper/security/advisories/GHSA-f3rp-5j6r-j7cp) and [GHSA-8242-j995-x55j](https://github.com/usetrmnl/larapaper/security/advisories/GHSA-8242-j995-x55j). All users should upgrade. Some changes are breaking, so read the upgrade notes below before you update.
Bare-metal deployments should also update node to v24.22.1.

##### Other changes

* feat: add playlist list and update API endpoints by [@lollo03](https://github.com/lollo03) in [#312](https://github.com/usetrmnl/larapaper/pull/312)
* feat: selectable plugins for pause and sleep mode, added toggle for mirroring separate device like a physical device by [@Sammyjo20](https://github.com/Sammyjo20) in [#321](https://github.com/usetrmnl/larapaper/pull/321)
* feat: bump `TRMNL_BLADE_FRAMEWORK_VERSION` to 3.4.6
* feat: limit Auto-Join to 15 minutes
* fix: harden device resolution and screen update endpoints; add rate limiting
* fix: harden recipe owner check
* fix(#320): bump to node v24.22.1

#### Upgrade notes
- Blade is disabled automatically once a second user account exists. Single-user instances keep Blade.
- `INSECURE_BLADE_ALLOW_PHP_EXECUTION=true` forces Blade on in multi-user mode, and false forces it off everywhere. Only set it to true if you trust every user, for example in a family or homelab setup.
-  `REGISTRATION_ENABLED` is replaced by `MULTIUSER_REGISTRATION_ENABLED` (default false). The first account can always register, but further signups are closed unless you set `MULTIUSER_REGISTRATION_ENABLED=true`. Remove `REGISTRATION_ENABLED` from your environment.
    - This also applies to new accounts created through OIDC.
- POST /api/screens with the access-token header now returns 401. Send Authorization: Bearer <token> with a token that has the update-screen ability
- Auto-Join is turned off during the upgrade. Turn it on again when you want to add a device. It now switches off by itself after 15 minutes.
- Re-pairing a device that has connected before (for example after a factory reset or WiFi reset) now requires Auto-Join to be on for its owner while the device runs setup. On multi-user instances, delete the device and add it again.

#### New Contributors
* [@lollo03](https://github.com/lollo03) made their first contribution in [#312](https://github.com/usetrmnl/larapaper/pull/312)
* [@Sammyjo20](https://github.com/Sammyjo20) made their first contribution in [#321](https://github.com/usetrmnl/larapaper/pull/321)

**Full Changelog**: [0.45.1...0.46.0](https://github.com/usetrmnl/larapaper/compare/0.45.1...0.46.0)

### Home Assistant app

- The app is now built on the official
  [LaraPaper (BYOS) add-on](https://github.com/usetrmnl/trmnl-home-assistant/tree/main/trmnl-larapaper)
  instead of LaraPaper's own image, and adds only what the add-on doesn't have: the
  bundled framework and FullCalendar, the Home Assistant proxy for recipes, rendering
  screens ahead of time and the device sensors. Your data stays where it is.
- It also brings the add-on's AppArmor profile, which keeps the app away from Home
  Assistant's own files (configuration, backups, media, share).
- Opening the web UI through Home Assistant now shows LaraPaper's start page instead of
  going straight to the dashboard.
- LaraPaper 0.46.0 turns Auto-Join off during the update; switch it on again when you
  add a device.

## 0.45.1-1

### LaraPaper 0.45.1

From the [LaraPaper 0.45.1 release](https://github.com/usetrmnl/larapaper/releases/tag/0.45.1):

#### SECURITY RELEASE 🚨

* Critical PHP security release 2026-10-21 (CVE-2026-109618, CVE-2026-109619)
* Bumps the Docker base image to PHP 8.4.27

Updating is strongly recommended for Docker Image deployments. Bare-metal deployments should upgrade to PHP 8.4.27.

**Full Changelog**: [0.45.0...0.45.1](https://github.com/usetrmnl/larapaper/compare/0.45.0...0.45.1)

### LaraPaper 0.45.0

From the [LaraPaper 0.45.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.45.0):

#### What's Changed
* feat: enhance plugin context with additional device and settings information
* fix(#285): use default stderr stream logger
* fix(#285): increase default http client timeout to 15 sec
* fix: access to lab settings for the first user only

### Home Assistant app

- LaraPaper 0.45.1, on PHP 8.4.27, which fixes two critical remote code execution
  flaws in PHP (CVE-2026-109618, CVE-2026-109619). Update soon: any device or browser
  that can reach LaraPaper's web port could exploit them, without logging in.

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
