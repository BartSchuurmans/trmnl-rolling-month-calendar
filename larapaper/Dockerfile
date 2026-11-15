# LaraPaper (local): the official LaraPaper Home Assistant add-on
# (usetrmnl/trmnl-home-assistant, trmnl-larapaper/: LaraPaper plus /data, options and
# ingress, and the read-only Home Assistant proxy for recipes) plus device sensors.
# Screens load the TRMNL framework from trmnl.com and the calendar's FullCalendar from
# jsDelivr, as with the add-on: LaraPaper 0.47.0's renderer (spatie/browsershot 5.5)
# refuses file:// assets, which is how this app used to bundle them.
# The add-on's images are per architecture; Home Assistant's builder passes BUILD_ARCH.
# Its version is LaraPaper's: to update LaraPaper, bump this tag and the version in
# config.yaml.
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/usetrmnl/trmnl-larapaper-${BUILD_ARCH}:0.47.0-3
FROM ${BUILD_FROM}

LABEL org.opencontainers.image.title="LaraPaper (local)" \
      org.opencontainers.image.source="https://github.com/BartSchuurmans/trmnl-rolling-month-calendar"

COPY rootfs /
RUN chmod +x /usr/local/bin/larapaper-local-entrypoint /etc/s6-overlay/s6-rc.d/larapaper-local-mqtt/run

# Keeps a root-only copy of the Supervisor token for the device sensors, then runs the
# add-on's entrypoint, which takes it out of the environment. ENTRYPOINT clears CMD.
ENTRYPOINT ["/usr/local/bin/larapaper-local-entrypoint"]
CMD ["/init"]

# Publishes the TRMNL devices (battery, Wi-Fi, firmware, ...) to Home Assistant through
# MQTT discovery: see mqtt.php. Started by s6 (rootfs/etc/s6-overlay) next to LaraPaper's
# queue worker and scheduler.
COPY mqtt/mqtt.php /opt/larapaper-local/
