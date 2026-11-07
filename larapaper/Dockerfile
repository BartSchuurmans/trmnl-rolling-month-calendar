# LaraPaper (local): the official LaraPaper Home Assistant add-on
# (usetrmnl/trmnl-home-assistant, trmnl-larapaper/: LaraPaper plus /data, options and
# ingress) plus everything a screen render would otherwise fetch from the internet, a
# Home Assistant proxy for recipes, pre-rendering and device sensors.
# The add-on's images are per architecture; Home Assistant's builder passes BUILD_ARCH.
# Its version is LaraPaper's: to update LaraPaper, bump this tag and the version in
# config.yaml.
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/usetrmnl/trmnl-larapaper-${BUILD_ARCH}:0.46.0
FROM ${BUILD_FROM}

LABEL org.opencontainers.image.title="LaraPaper (local)" \
      org.opencontainers.image.source="https://github.com/BartSchuurmans/trmnl-rolling-month-calendar"

# TRMNL framework 3.4.0 (LaraPaper's default version) with its fonts, and FullCalendar.
# Each file is pinned by SHA-256 in assets.txt.
COPY assets.txt fetch-assets.sh /tmp/rolling-month-calendar/
RUN sh /tmp/rolling-month-calendar/fetch-assets.sh /tmp/rolling-month-calendar/assets.txt /opt/rolling-month-calendar-assets \
    && rm -rf /tmp/rolling-month-calendar

# Serve them at root-relative paths. Screens render from a temporary file:// page, so
# "/fonts/x" resolves to the filesystem there, and to nginx (public/) in the browser
# preview. The framework CSS refers to its fonts as "/fonts/...".
RUN for dir in trmnl-framework fonts rolling-month-calendar; do \
        ln -sfn "/opt/rolling-month-calendar-assets/$dir" "/$dir"; \
        ln -sfn "/opt/rolling-month-calendar-assets/$dir" "/var/www/html/public/$dir"; \
    done

# Point LaraPaper at the bundled framework instead of trmnl.com (the explicit URLs win
# over TRMNL_BLADE_FRAMEWORK_BASE_URL and the recipe's framework_version).
ENV TRMNL_BLADE_FRAMEWORK_CSS_URL=/trmnl-framework/3.4.0/plugins.min.css \
    TRMNL_BLADE_FRAMEWORK_JS_URL=/trmnl-framework/3.4.0/plugins.min.js

COPY rootfs /
RUN chmod +x /etc/entrypoint.d/20-larapaper-local.sh /etc/s6-overlay/s6-rc.d/larapaper-local-prerender/run \
    /etc/s6-overlay/s6-rc.d/larapaper-local-mqtt/run

# Renders recipe screens ahead of time, so the TRMNL doesn't wait on a render: see
# prerender.php. Started by s6 (rootfs/etc/s6-overlay) next to LaraPaper's scheduler.
COPY prerender/prerender.php /opt/larapaper-local/

# Publishes the TRMNL devices (battery, Wi-Fi, firmware, ...) to Home Assistant through
# MQTT discovery: see mqtt.php. Started by s6 like the pre-render.
COPY mqtt/mqtt.php /opt/larapaper-local/

# Home Assistant ingress: the recipe preview's bundled assets (see 20-larapaper-local.sh)
COPY --chown=www-data:www-data ingress/ingress.js /var/www/html/public/larapaper-local/
