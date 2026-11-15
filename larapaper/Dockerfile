# LaraPaper (local): the official LaraPaper Home Assistant add-on
# (usetrmnl/trmnl-home-assistant, trmnl-larapaper/: LaraPaper plus /data, options and
# ingress) plus a Home Assistant proxy for recipes, pre-rendering and device sensors.
# Screens load the TRMNL framework from trmnl.com and the calendar's FullCalendar from
# jsDelivr, as with the add-on: LaraPaper 0.47.0's renderer (spatie/browsershot 5.5)
# refuses file:// assets, which is how this app used to bundle them.
# The add-on's images are per architecture; Home Assistant's builder passes BUILD_ARCH.
# Its version is LaraPaper's: to update LaraPaper, bump this tag and the version in
# config.yaml.
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/usetrmnl/trmnl-larapaper-${BUILD_ARCH}:0.47.0-1
FROM ${BUILD_FROM}

LABEL org.opencontainers.image.title="LaraPaper (local)" \
      org.opencontainers.image.source="https://github.com/BartSchuurmans/trmnl-rolling-month-calendar"

COPY rootfs /
RUN chmod +x /etc/entrypoint.d/20-larapaper-local.sh /etc/s6-overlay/s6-rc.d/larapaper-local-prerender/run \
    /etc/s6-overlay/s6-rc.d/larapaper-local-mqtt/run

# Renders recipe screens ahead of time, so the TRMNL doesn't wait on a render: see
# prerender.php. Started by s6 (rootfs/etc/s6-overlay) next to LaraPaper's scheduler.
COPY prerender/prerender.php /opt/larapaper-local/

# Publishes the TRMNL devices (battery, Wi-Fi, firmware, ...) to Home Assistant through
# MQTT discovery: see mqtt.php. Started by s6 like the pre-render.
COPY mqtt/mqtt.php /opt/larapaper-local/
