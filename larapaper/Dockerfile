# LaraPaper (local): the official LaraPaper image plus everything a screen render
# would otherwise fetch from the internet.
# The official LaraPaper image is multi-arch (linux/amd64 + linux/arm64). To update
# LaraPaper, bump this tag and the version in config.yaml.
ARG BUILD_FROM=ghcr.io/usetrmnl/larapaper:0.43.1
FROM ${BUILD_FROM}

LABEL org.opencontainers.image.title="LaraPaper (local)" \
      org.opencontainers.image.source="https://github.com/BartSchuurmans/trmnl-rolling-month-calendar"

# Root so the entrypoint hook can take ownership of the Supervisor-mounted /data;
# PHP-FPM workers still run as www-data (serversideup-php images support this).
USER root

# TRMNL framework 3.3.1 (LaraPaper's default version) with its fonts, and FullCalendar.
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

# Point LaraPaper at the bundled framework instead of trmnl.com, and drop the Inter
# stylesheet from fonts.bunny.net (the framework ships Inter itself). OPcache on, as in
# LaraPaper's own docker-compose.
ENV TRMNL_BLADE_FRAMEWORK_CSS_URL=/trmnl-framework/3.3.1/plugins.min.css \
    TRMNL_BLADE_FRAMEWORK_JS_URL=/trmnl-framework/3.3.1/plugins.min.js \
    PHP_OPCACHE_ENABLE=1
RUN view=/var/www/html/resources/views/vendor/trmnl/components/screen.blade.php \
    && sed -i '/fonts\.bunny\.net/d' "$view" \
    && ! grep -q 'fonts\.bunny\.net' "$view"

COPY rootfs /
RUN chmod +x /etc/entrypoint.d/10-ha-calendar.sh /etc/s6-overlay/s6-rc.d/larapaper-local-prerender/run \
    /etc/s6-overlay/s6-rc.d/larapaper-local-mqtt/run

# Renders recipe screens ahead of time, so the TRMNL doesn't wait on a render: see
# prerender.php. Started by s6 (rootfs/etc/s6-overlay) next to LaraPaper's scheduler.
COPY prerender/prerender.php /opt/larapaper-local/

# Publishes the TRMNL devices (battery, Wi-Fi, firmware, ...) to Home Assistant through
# MQTT discovery: see mqtt.php. Started by s6 like the pre-render.
COPY mqtt/mqtt.php /opt/larapaper-local/

# Home Assistant ingress: see IngressServiceProvider.php and 10-ha-calendar.sh
COPY --chown=www-data:www-data ingress/IngressServiceProvider.php /var/www/html/app/Providers/
COPY --chown=www-data:www-data ingress/ingress.js /var/www/html/public/larapaper-local/
RUN providers=/var/www/html/bootstrap/providers.php \
    && sed -i 's/^];$/    App\\Providers\\IngressServiceProvider::class,\n];/' "$providers" \
    && grep -q 'App\\Providers\\IngressServiceProvider::class' "$providers"
