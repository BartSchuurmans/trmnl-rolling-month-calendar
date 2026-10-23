# Sample server

`worker.mjs` is a fake Home Assistant on Cloudflare Workers with the sample calendars of
`../sample-data.mjs` (six weeks that repeat) and a daily forecast, for trying the
TRMNL.com Home Assistant recipe ([`plugin/trmnl-com-polling/`](../../plugin/trmnl-com-polling/README.md))
without a Home Assistant of your own. It works the data out from today on every request,
so it never runs out, and it answers the weather forecast's POST, which a static file
can't.

| Request | Answer |
|---|---|
| `GET /api/calendars/calendar.family`, `.mark`, `.sara`, `.work` `?start=&end=` | The sample events in that window, as Home Assistant sends them (Amsterdam time) |
| `POST /api/services/weather/get_forecasts?return_response` with `{"entity_id": "weather.forecast_home", "type": "daily"}` | Ten days of forecast from today, as `transform.js` reads it |
| `GET /feeds/family.ics`, `mark.ics`, `sara.ics`, `work.ics` | The sample ICS feeds, the same as `docs/sample-ics/` |

The `/api/` paths want a bearer token, as Home Assistant does, but take any. The data is
public, so there's nothing secret to configure.

In the recipe's form: **Home Assistant URL** the worker's URL, **token** any text,
**calendar entities** `calendar.family`, `calendar.mark`, `calendar.sara`, **weather
entity** `weather.forecast_home`. `calendar.work` is Mark's work calendar, for **Usual
week** `-,-,-,Mon-Thu 08:30-17:00` (as in the README's screenshot).

## Deploying

Cloudflare builds and deploys it from main through its Git integration, with
`wrangler.jsonc` in this folder; nothing about it is stored in GitHub. Set up once in
the Cloudflare dashboard: Workers & Pages → Create → Import a repository, pick this
repository, set the root directory to `preview/sample-server`, keep the deploy command
`npx wrangler deploy`, and limit builds to the `main` branch. It serves at
`https://trmnl-rolling-month-calendar-sample-server.<account subdomain>.workers.dev`. The free
plan's 100,000 requests a day are far more than a few test plugins polling every 15
minutes need.

`preview/transforms.mjs` (in `ci.sh`) serves `worker.mjs` through Node and runs
`transform.js` against it. To run it in Cloudflare's own runtime locally:
`npx wrangler dev` in this folder.
