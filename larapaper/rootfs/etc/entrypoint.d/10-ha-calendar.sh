#!/bin/sh
# Home Assistant glue for LaraPaper. serversideup-php runs /etc/entrypoint.d/* in
# order on every start, before 50-laravel-automations.sh (migrations, config cache),
# so what this writes to .env is live on each boot.
set -e

APP_DIR="${APP_DIR:-/var/www/html}"
DATA_DIR="${DATA_DIR:-/data}"

log() { echo "[larapaper-local] $1"; }

# Keep the database and generated screens in /data, which survives app updates and
# is included in Home Assistant backups (same paths as upstream docker-compose).
persist() {
    image_path="$APP_DIR/$1"
    data_path="$DATA_DIR/$2"
    mkdir -p "$data_path"
    if [ ! -L "$image_path" ]; then
        if [ -d "$image_path" ]; then
            cp -a "$image_path/." "$data_path/" 2>/dev/null || true
            rm -rf "$image_path"
        fi
        mkdir -p "$(dirname "$image_path")"
        ln -s "$data_path" "$image_path"
    fi
}
persist database/storage database
persist storage/app/public/images/generated generated
[ -f "$DATA_DIR/database/database.sqlite" ] || touch "$DATA_DIR/database/database.sqlite"
chown -R www-data:www-data "$DATA_DIR/database" "$DATA_DIR/generated" 2>/dev/null || true

# APP_KEY is generated once: rotating it would invalidate encrypted settings.
if [ ! -s "$DATA_DIR/app_key" ]; then
    echo "base64:$(head -c 32 /dev/urandom | base64 | tr -d '\n')" > "$DATA_DIR/app_key"
    log "generated APP_KEY"
fi

# App options (/data/options.json); PHP is in the image, jq/bashio are not.
opt() {
    # shellcheck disable=SC2016 # PHP code, not shell expansions
    php -r '$o = json_decode(@file_get_contents($argv[1]), true) ?: [];
            $v = $o[$argv[2]] ?? "";
            echo is_bool($v) ? ($v ? "1" : "0") : $v;' "$DATA_DIR/options.json" "$1"
}

set_env() {
    tmp="$APP_DIR/.env.tmp"
    grep -v "^$1=" "$APP_DIR/.env" > "$tmp" || true
    printf '%s=%s\n' "$1" "$2" >> "$tmp"
    cat "$tmp" > "$APP_DIR/.env"
    rm -f "$tmp"
}

APP_URL="$(opt app_url)"
APP_URL="${APP_URL%/}"
REGISTRATION_ENABLED="$(opt registration_enabled)"
PRERENDER="${LARAPAPER_LOCAL_PRERENDER:-$(opt prerender)}"
MQTT="${LARAPAPER_LOCAL_MQTT:-$(opt mqtt)}"

set_env APP_KEY "$(cat "$DATA_DIR/app_key")"
set_env APP_ENV production
set_env APP_DEBUG false
set_env DB_DATABASE database/storage/database.sqlite
set_env APP_TIMEZONE "${TZ:-UTC}"
set_env REGISTRATION_ENABLED "${REGISTRATION_ENABLED:-1}"
[ -n "$APP_URL" ] && set_env APP_URL "$APP_URL"

log "APP_URL=${APP_URL:-<unset>} TZ=${TZ:-UTC} registration=${REGISTRATION_ENABLED:-1} prerender=${PRERENDER:-1} mqtt=${MQTT:-1}"

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

# Home Assistant ingress (the sidebar panel and "Open Web UI"): Home Assistant proxies
# /api/hassio_ingress/<token>/... to this port with the prefix removed and the prefix in
# X-Ingress-Path. PHP is told the prefix is where index.php lives, so Laravel puts it in
# front of every URL it makes (links, redirects, Livewire, assets), and the scheme and
# host come from Home Assistant's X-Forwarded-* headers. Only the Supervisor may connect
# (HA_INGRESS_PROXY is for CI). LARAPAPER_INGRESS is for
# larapaper/ingress/IngressServiceProvider.php.
INGRESS_CONF=/etc/nginx/conf.d/ha-ingress.conf
HA_INGRESS_PROXY="${HA_INGRESS_PROXY:-172.30.32.2}"
cat > "$INGRESS_CONF" <<CONF
map \$http_x_ingress_path \$ha_ingress_path {
    "~^/api/hassio_ingress/[A-Za-z0-9_-]+\$" \$http_x_ingress_path;
    default "";
}
map \$http_x_forwarded_host \$ha_ingress_host {
    "" \$http_host;
    default \$http_x_forwarded_host;
}
map \$http_x_forwarded_proto \$ha_ingress_https {
    https on;
    default "";
}

server {
    listen 8099;
    allow ${HA_INGRESS_PROXY};
    deny all;

    root /var/www/html/public;
    index index.php;
    charset utf-8;
    absolute_redirect off;

    if (\$ha_ingress_path = "") { return 400; }

    # The recipe preview writes root-relative asset paths into an iframe; ingress.js
    # puts the prefix in front of them (larapaper/ingress/ingress.js).
    sub_filter '</head>' '<script src="\$ha_ingress_path/larapaper-local/ingress.js"></script></head>';

    # Home Assistant opens the app at the ingress path's root. Laravel's cached routes
    # match a copy of the request with the trailing slash cut off, which loses the
    # prefix there (REQUEST_URI no longer contains the script's directory), so "/"
    # can't be routed: send it to the dashboard (the login page when logged out).
    location = / {
        return 302 \$ha_ingress_path/dashboard;
    }

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    # The framework's stylesheet loads its fonts from /fonts/...
    location ^~ /trmnl-framework/ {
        sub_filter_types text/css;
        sub_filter_once off;
        sub_filter 'url("/fonts/' 'url("\$ha_ingress_path/fonts/';
        try_files \$uri =404;
    }

    location ~ /\.(?!well-known) {
        deny all;
    }

    location ~ \.php\$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param SCRIPT_NAME \$ha_ingress_path\$fastcgi_script_name;
        fastcgi_param PHP_SELF \$ha_ingress_path\$fastcgi_script_name;
        fastcgi_param REQUEST_URI \$ha_ingress_path\$request_uri;
        fastcgi_param HTTP_HOST \$ha_ingress_host;
        fastcgi_param HTTPS \$ha_ingress_https if_not_empty;
        fastcgi_param LARAPAPER_INGRESS 1;
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_buffers ${NGINX_FASTCGI_BUFFERS:-8 8k};
        fastcgi_buffer_size ${NGINX_FASTCGI_BUFFER_SIZE:-8k};
        fastcgi_read_timeout ${PHP_MAX_EXECUTION_TIME:-99};
    }
}
CONF
log "Home Assistant ingress on port 8099 (from $HA_INGRESS_PROXY)"
