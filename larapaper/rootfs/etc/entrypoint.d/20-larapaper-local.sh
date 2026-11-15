#!/bin/sh
# What LaraPaper (local) adds to the official LaraPaper add-on's glue
# (10-homeassistant.sh in its image, which already ran: /data, options, .env and the
# ingress server): the Home Assistant proxy for recipes.
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

MQTT="${LARAPAPER_LOCAL_MQTT:-$(opt mqtt)}"
log "mqtt=${MQTT:-1}"

# The same proxy as the official add-on's (BartSchuurmans/trmnl-home-assistant#8, from
# add-on 0.47.0-2 on), until this app builds on an add-on image that has it: then this
# block goes. Unlike there, the Supervisor token is still in the environment here (the
# MQTT sensors read the broker's address with it).
HA_KEY="$(opt home_assistant_key)"

# Home Assistant for recipes: a read-only copy of Home Assistant's REST API on
# http://127.0.0.1:8124, for recipes that poll Home Assistant (a TRMNL.com recipe's
# "Home Assistant URL" plus its access token). It answers only requests that carry the
# home_assistant_key option as their Bearer token, swaps that for the app's own
# Supervisor token (homeassistant_api), and passes only reads and the service calls that
# only return data. That token can do anything an administrator can, so it stays in this
# root-only nginx file (nginx's workers drop the environment). Browsers (a recipe's page
# while Chromium renders it) send Sec-Fetch-* or Origin headers, PHP's HTTP client
# doesn't: those requests are refused, so a page can't call it. HA_API_URL is for the
# end-to-end test's fake Home Assistant.
HA_API_CONF=/etc/nginx/conf.d/ha-api.conf
HA_API_URL="${HA_API_URL:-http://supervisor/core/api}"
HA_API_URL="${HA_API_URL%/}"
rm -f "$HA_API_CONF"
if [ -z "$HA_KEY" ]; then
    log "Home Assistant for recipes: off (no home_assistant_key)"
elif ! printf '%s' "$HA_KEY" | grep -Eqx '[A-Za-z0-9_-]{24,}'; then
    log "Home Assistant for recipes: off (home_assistant_key must be 24 or more letters, digits, - or _)"
elif [ -z "${SUPERVISOR_TOKEN:-}" ]; then
    log "Home Assistant for recipes: off (no SUPERVISOR_TOKEN)"
# nginx won't start if the upstream's name doesn't resolve
elif ! getent hosts "$(printf '%s' "$HA_API_URL" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')" >/dev/null; then
    log "Home Assistant for recipes: off (can't resolve $HA_API_URL)"
else
    # One location per API path, each with the methods it allows; the rest is 404
    ha_location() { # ha_location <location> <path under /api> <method>
        cat <<LOCATION
    location $1 {
        limit_except $3 { deny all; }
        proxy_pass ${HA_API_URL}$2;
        proxy_set_header Authorization "Bearer ${SUPERVISOR_TOKEN}";
    }
LOCATION
    }
    {
        cat <<CONF
map \$http_authorization \$ha_key_ok {
    "Bearer ${HA_KEY}" 1;
    default 0;
}

server {
    listen 127.0.0.1:8124;
    access_log off;
    default_type application/json;

    if (\$http_sec_fetch_mode) { return 403 '{"message": "Not for browsers"}'; }
    if (\$http_origin) { return 403 '{"message": "Not for browsers"}'; }
    if (\$ha_key_ok = 0) { return 401 '{"message": "401: Unauthorized"}'; }

CONF
        ha_location "= /api/" / GET
        ha_location "= /api/config" /config GET
        ha_location "= /api/states" /states GET
        ha_location /api/states/ /states/ GET
        ha_location "= /api/calendars" /calendars GET
        ha_location /api/calendars/ /calendars/ GET
        ha_location /api/history/period /history/period GET
        ha_location /api/logbook /logbook GET
        ha_location "= /api/template" /template POST
        for service in weather/get_forecasts calendar/get_events todo/get_items; do
            ha_location "= /api/services/$service" "/services/$service" POST
        done
        cat <<CONF

    location / {
        return 404 '{"message": "Not available to recipes"}';
    }
}
CONF
    } > "$HA_API_CONF"
    chmod 600 "$HA_API_CONF"
    log "Home Assistant for recipes on http://127.0.0.1:8124 (read-only) -> $HA_API_URL"
fi
