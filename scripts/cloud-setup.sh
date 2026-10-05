#!/bin/sh
# Sets up a fresh Claude Code cloud container for preview/ci.sh, render.mjs and trmnlp,
# and prints the environment they need. Safe to run again; skips what is done.
#   eval "$(sh scripts/cloud-setup.sh)"
# Progress goes to stderr, the exports to stdout. GitHub runners don't need this
# (see .github/workflows/render.yml).
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cache="${CLOUD_SETUP_DIR:-$HOME/.cache/rolling-month-calendar}"
mkdir -p "$cache"
log() { echo "cloud-setup: $*" >&2; }

# preview/ and the PHP Liquid engine
[ -d "$root/preview/node_modules" ] || { log "npm ci"; (cd "$root/preview" && npm ci --silent >&2); }
[ -d "$root/preview/php/vendor" ] || { log "composer install"; (cd "$root/preview/php" && composer install -q --no-interaction >&2); }

# TRMNL framework, pinned in larapaper/assets.txt, laid out as render.yml does
version="$(sed -n "s/^framework_version: *['\"]*\([^'\"]*\).*/\1/p" "$root/plugin/src/settings.yml")"
fw="$cache/framework"
if [ ! -e "$fw/css/$version/plugins.css" ]; then
    log "fetching assets (framework $version)"
    sh "$root/larapaper/fetch-assets.sh" "$root/larapaper/assets.txt" "$cache/assets" >/dev/null
    mkdir -p "$fw/css/$version" "$fw/js/$version"
    ln -sfn "$cache/assets/trmnl-framework/$version/plugins.min.css" "$fw/css/$version/plugins.css"
    ln -sfn "$cache/assets/trmnl-framework/$version/plugins.min.js" "$fw/js/$version/plugins.js"
    ln -sfn "$cache/assets/fonts" "$fw/fonts"
fi

# The preinstalled Chromium (playwright-core asks for a newer build than is installed)
chromium="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1 || true)"

# Docker for trmnlp: the daemon isn't running at session start
if command -v dockerd >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    log "starting dockerd"
    (dockerd >"$cache/dockerd.log" 2>&1 &)
    i=0; until docker info >/dev/null 2>&1 || [ $i -ge 30 ]; do sleep 1; i=$((i + 1)); done
fi

# Containers can't reach the agent proxy or trust its CA by themselves: host network,
# Firefox proxy policy and the CA for trmnlp's browser, proxy env for its Ruby side.
# The proxy port changes when the container restarts, so this is rewritten every run.
docker_args=""
if [ -n "${HTTPS_PROXY:-}" ] && [ -f /root/.ccr/ca-bundle.crt ]; then
    proxy="${HTTPS_PROXY#*://}"; proxy="${proxy#*@}"; proxy="${proxy%/}"
    pol="$cache/firefox-policies"
    mkdir -p "$pol"
    cp /root/.ccr/ca-bundle.crt "$pol/ca.crt"
    cat >"$pol/policies.json" <<JSON
{"policies":{"Proxy":{"Mode":"manual","HTTPProxy":"$proxy","UseHTTPProxyForAllProtocols":true,"Passthrough":"localhost, 127.0.0.1"},"Certificates":{"Install":["/etc/firefox/policies/ca.crt"]}}}
JSON
    docker_args="--network=host --volume=$pol:/etc/firefox/policies:ro --env=HTTPS_PROXY=http://$proxy --env=SSL_CERT_FILE=/etc/firefox/policies/ca.crt"
fi

echo "export FRAMEWORK_DIR='$fw'"
[ -z "$chromium" ] || echo "export CHROMIUM_PATH='$chromium'"
[ -z "$docker_args" ] || echo "export TRMNLP_DOCKER_ARGS='$docker_args'"
log "done"
