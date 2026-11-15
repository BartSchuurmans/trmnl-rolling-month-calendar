#!/bin/sh
# What LaraPaper (local) adds to the official LaraPaper add-on's glue
# (10-homeassistant.sh in its image, which already ran: /data, options, .env and the
# ingress server): the Home Assistant proxy for recipes and the pre-render default.
# serversideup-php runs /etc/entrypoint.d/* in order on every start, before
# 50-laravel-automations.sh.
set -e

DATA_DIR="${DATA_DIR:-/data}"

log() { echo "[larapaper-local] $1"; }

# App options (/data/options.json); PHP is in the image, jq/bashio are not.
opt() {
    # shellcheck disable=SC2016 # PHP code, not shell expansions
    php -r '$o = json_decode(@file_get_contents($argv[1]), true) ?: [];
            $v = $o[$argv[2]] ?? "";
            echo is_bool($v) ? ($v ? "1" : "0") : $v;' "$DATA_DIR/options.json" "$1"
}

PRERENDER="${LARAPAPER_LOCAL_PRERENDER:-$(opt prerender)}"
MQTT="${LARAPAPER_LOCAL_MQTT:-$(opt mqtt)}"
log "prerender=${PRERENDER:-1} mqtt=${MQTT:-1}"

# Pre-rendering is LaraPaper's own since 0.47.0, a Lab setting ("Pre-render playlist
# items", run by its scheduler and queue worker): the TRMNL firmware gives GET
# /api/display 15 s, and a render inside that request can take longer. The "prerender"
# option sets its default; once someone flips it in Settings -> Lab, that wins.
# Like the add-on's 10-homeassistant.sh, write .env before 50-laravel-automations.sh
# caches the config.
APP_DIR="${APP_DIR:-/var/www/html}"
tmp="$APP_DIR/.env.tmp"
grep -v '^TOGGLE_PRERENDER_PLAYLIST_ITEMS=' "$APP_DIR/.env" > "$tmp" || true
if [ "${PRERENDER:-1}" = 0 ]; then
    echo 'TOGGLE_PRERENDER_PLAYLIST_ITEMS=false' >> "$tmp"
else
    echo 'TOGGLE_PRERENDER_PLAYLIST_ITEMS=true' >> "$tmp"
fi
cat "$tmp" > "$APP_DIR/.env"
rm -f "$tmp"
# LaraPaper caches toggles for an hour (in the database, so across restarts): forget them,
# or a changed option would wait that long. Fails harmlessly before the first migration.
# As www-data: a root-owned laravel.log would break the web app.
as_www=""
[ "$(id -u)" = 0 ] && as_www="/command/s6-setuidgid www-data"
(cd "$APP_DIR" && $as_www php artisan toggle:cache-clear >/dev/null 2>&1) || true

# Home Assistant API without a user token: with homeassistant_api in config.yaml the
# Supervisor gives the app its own token (SUPERVISOR_TOKEN). The recipe can't read
# environment variables, so nginx serves Home Assistant's calendar endpoint on
# 127.0.0.1:8124 and adds the token there. Only calendar reads and daily weather
# forecasts get through, and only from inside this container. HA_API_URL is for the
# end-to-end test's fake HA.
HA_PROXY_CONF=/etc/nginx/conf.d/ha-calendar-api.conf
HA_API_URL="${HA_API_URL:-http://supervisor/core/api}"
# nginx won't start if the upstream name doesn't resolve
# shellcheck disable=SC2016 # PHP code, not shell expansions
ha_api_host="$(php -r '$h = parse_url($argv[1], PHP_URL_HOST);
                       echo gethostbyname($h) === $h ? "" : $h;' "$HA_API_URL")"
# Forecasts are a service call (POST weather.get_forecasts), but the recipe can only
# poll with GET: the weather location turns a GET for one entity into that one call.
# proxy_pass can't take a path there (the URI is rewritten), so split the URL.
# shellcheck disable=SC2016 # PHP code, not shell expansions
ha_api_origin="$(php -r '$u = parse_url($argv[1]);
                         echo $u["scheme"] . "://" . $u["host"] . (isset($u["port"]) ? ":" . $u["port"] : "");' "$HA_API_URL")"
# shellcheck disable=SC2016
ha_api_path="$(php -r 'echo rtrim(parse_url($argv[1], PHP_URL_PATH) ?? "", "/");' "$HA_API_URL")"
rm -f "$HA_PROXY_CONF"
if [ -z "$SUPERVISOR_TOKEN" ]; then
    log "no SUPERVISOR_TOKEN: calendar proxy off, the recipe needs an access token"
elif [ -z "$ha_api_host" ]; then
    log "can't resolve $HA_API_URL: calendar proxy off, the recipe needs an access token"
else
    cat > "$HA_PROXY_CONF" <<CONF
# /api/weather/<weather entity> → the entity id, or empty for anything else
map \$uri \$ha_weather_entity {
    "~^/api/weather/(?<entity>weather\\.[a-z0-9_]+)\$" \$entity;
    default "";
}

server {
    listen 127.0.0.1:8124;
    access_log off;

    location /api/calendars/ {
        limit_except GET { deny all; }
        proxy_pass ${HA_API_URL}/calendars/;
        proxy_set_header Authorization "Bearer ${SUPERVISOR_TOKEN}";
    }

    location /api/weather/ {
        limit_except GET { deny all; }
        if (\$ha_weather_entity = "") { return 404; }
        # (the trailing ? drops the request's own query string)
        rewrite ^ ${ha_api_path}/services/weather/get_forecasts?return_response? break;
        proxy_method POST;
        proxy_set_header Content-Type application/json;
        proxy_set_body '{"entity_id": "\$ha_weather_entity", "type": "daily"}';
        proxy_pass ${ha_api_origin};
        proxy_set_header Authorization "Bearer ${SUPERVISOR_TOKEN}";
    }

    location / {
        return 404;
    }
}
CONF
    chmod 600 "$HA_PROXY_CONF"
    log "calendar and weather proxy on http://127.0.0.1:8124 → $HA_API_URL"
fi
