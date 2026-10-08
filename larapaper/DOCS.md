# LaraPaper (local)

[LaraPaper](https://github.com/usetrmnl/larapaper), the self-hosted TRMNL server, set
up so that rendering a screen needs no internet access. It is the official LaraPaper
image with these additions:

- **TRMNL framework 3.3.1** (CSS, JS and fonts) and **FullCalendar 7.1.0** (and 6.1.21 for recipe versions up to v1.9.0) are built
  into the image. LaraPaper normally loads the framework from trmnl.com, and the
  calendar recipe loads FullCalendar from jsDelivr, every time a screen renders.
- The database, generated screens and app key are kept in `/data`, so they survive
  updates and are part of Home Assistant backups.
- The calendar recipe reads Home Assistant through `http://127.0.0.1:8124`, which
  forwards calendar requests and daily weather forecasts (and nothing else) to Home
  Assistant with the app's own access. It is only reachable from inside the app.
- Recipe screens are rendered ahead of time. LaraPaper itself only renders when the
  TRMNL asks for its screen, and the TRMNL gives up after 15 seconds, which a render
  on a Home Assistant machine can take. The app renders each polling recipe in a
  device's playlists shortly before its refresh interval runs out, so the TRMNL gets a
  ready screen. Mashups are still rendered when the TRMNL asks. The **Render screens
  ahead of time** option turns this off.
- Each TRMNL shows up in Home Assistant as a device with its battery, Wi-Fi signal,
  firmware, last check-in and screen, and its sleep mode and refresh interval to change,
  through MQTT (see [Device sensors](#device-sensors)).

Installing or updating the app downloads a prebuilt image
(`ghcr.io/bartschuurmans/larapaper-local`, amd64 and aarch64), which needs internet.
The image is built by this repository's CI from the LaraPaper image and the files
listed in `assets.txt`, each checked against a pinned SHA-256.

## Setup

1. Set **App URL** to the address your TRMNL uses to reach this app, e.g.
   `http://192.168.1.10:4567`. The device downloads its screen image from there, so use
   an IP address or a name the device can resolve (`.local` names usually don't work).
2. Start the app and click **Open Web UI**. Register your account, then turn off
   **Allow registration**.
3. Point the TRMNL at the server. A new device starts in Wi-Fi pairing mode; to get
   back to it, hold the left and right ends of the touch bar until the screen flashes
   (TRMNL X) or hold the button on the back for 6 to 8 seconds (TRMNL OG). Connect to
   the **TRMNL** Wi-Fi network, tap **Advanced** → **Custom Server** → **Yes** and enter
   the App URL without a trailing slash, then go **Back to Wi-Fi**, pick your network
   and **Connect**. With the **Auto-Join** toggle in LaraPaper's header switched on, the
   device appears by itself. The "Please visit trmnl.com/start" screen it then shows
   comes from the firmware and can be ignored; the device picks up its playlist at the
   next refresh. A TRMNL OG on firmware older than 1.4.6 has no
   **Custom Server** option and needs a firmware update first.
4. Install the calendar recipe: **Plugins** → add menu → **Import from OSS Catalog** →
   **Install** on **Rolling Month Calendar** (see the repository README). Fill in your
   calendar entities and leave **Home Assistant URL** at `http://127.0.0.1:8124` and the access token empty: the app
   reads your calendars with its own Home Assistant access, so you don't need to create
   a token. A recipe you set up before keeps its URL and token when you update; change
   the URL to `http://127.0.0.1:8124` and clear the token to switch. For the weather
   forecast next to each day, also fill in **Home Assistant weather entity**, e.g.
   `weather.forecast_home`. Prefer an entity from Home Assistant's Open-Meteo
   integration (named after its zone, e.g. `weather.home`) over Met.no
   (`weather.forecast_home`): Met.no's forecast for today leaves out the hours already
   past, so today's high drops through the day.

## Device sensors

With the **Mosquitto broker** app installed (and the MQTT integration set up, which
Home Assistant offers once the broker runs), every TRMNL in LaraPaper appears under
**Settings** → **Devices & services** → **MQTT** as its own device, named as in
LaraPaper. Each one has:

| Entity | What it shows |
| --- | --- |
| Battery | Charge in % (from the battery voltage the TRMNL reports) |
| Charging, USB connected | On or off (newer firmware only) |
| Firmware | The installed version, and an update when LaraPaper knows a newer one; **Install** has the TRMNL install it when it next wakes |
| Wi-Fi signal | In dBm |
| Last seen | When the TRMNL last asked for its screen |
| Online | Off once it hasn't asked for twice its refresh interval plus 5 minutes (not while it sleeps) |
| Screen | The screen the TRMNL was last given, as an image |
| Sleep mode, Sleep from, Sleep until | Turn sleep mode on or off and set its times |
| Refresh interval | How often the TRMNL wakes, in seconds |
| Refresh screen | Fetches its recipes' data and renders them again now, for the TRMNL's next wake |
| Battery voltage | Off by default |
| Temperature, humidity, CO2, pressure | Only for a TRMNL with such a sensor attached |

The values update within seconds of each check-in. Changes you make in Home Assistant
reach the TRMNL the next time it wakes, as changes in LaraPaper do. A device you delete in LaraPaper is
removed from Home Assistant too. The app finds the broker by itself; without one it
checks again every few minutes. **Device sensors in Home Assistant** turns this off.

## The web UI

**Open Web UI** (and **Show in sidebar** on the app's page) shows LaraPaper inside Home
Assistant, which passes it on through its own connection (ingress). It works wherever
Home Assistant does, for example through Home Assistant Cloud or your own remote
access, so LaraPaper itself never has to be reachable from the internet. You still log
in to LaraPaper there; passkeys you created at `http://<ha-ip>:4567` don't work under
Home Assistant's address, a password does.

At home, the web UI is also at the App URL (port 4567), next to the TRMNL's device API.

## What still goes online

Rendering screens doesn't. LaraPaper's own background jobs still try to reach the
internet: a daily firmware check, a weekly device-model list update and an update
check in the web UI. They fail harmlessly when there's no connection. Recipes that load
their own scripts or images from the internet still need it too.

## Updating

LaraPaper updates come through updates of this app, which pin an exact LaraPaper
version (`FROM` in the `Dockerfile`).
