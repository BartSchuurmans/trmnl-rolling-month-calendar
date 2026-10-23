// A stand-in Home Assistant on Cloudflare Workers, for trying the TRMNL.com Home
// Assistant recipe (plugin/trmnl-com-polling) without one: the sample calendars of
// ../sample-data.mjs (six weeks that repeat) and a daily forecast, worked out from today
// on every request, so it never runs out. It answers what the recipe asks of Home
// Assistant:
//
//   GET  /api/calendars/calendar.family|mark|sara|work?start=YYYY-MM-DD&end=YYYY-MM-DD
//   POST /api/services/weather/get_forecasts?return_response
//        {"entity_id": "weather.forecast_home", "type": "daily"}   (transform.js)
//
// with any bearer token (the data is public; a missing one gets 401 like Home Assistant),
// and the sample ICS feeds as /feeds/family|mark|sara|work.ics, the same as docs/sample-ics/.
// Cloudflare deploys it from main (wrangler.jsonc here); see README.md.
import { CALENDARS, sampleHaRange, sampleForecast, sampleIcs } from '../sample-data.mjs';

const WEATHER = 'weather.forecast_home';
const ZONE = 'Europe/Amsterdam';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());
const date = (value) => (/^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : null);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    const feed = url.pathname.match(/^\/feeds\/(\w+)\.ics$/);
    if (feed && request.method === 'GET') {
      const body = Object.hasOwn(CALENDARS, feed[1]) && sampleIcs(feed[1]);
      return body ? new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } })
        : new Response('Not found', { status: 404 });
    }

    if (!url.pathname.startsWith('/api/')) {
      return new Response('Stand-in Home Assistant for the Rolling Month Calendar recipe: '
        + 'https://github.com/BartSchuurmans/trmnl-rolling-month-calendar/tree/main/preview/sample-server\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (!/^Bearer \S/.test(request.headers.get('Authorization') || '')) return json(401, { message: '401: Unauthorized' });
    if (url.pathname === '/api/') return json(200, { message: 'API running.' });

    const calendar = url.pathname.match(/^\/api\/calendars\/calendar\.(\w+)$/);
    if (calendar && request.method === 'GET') {
      const start = date(url.searchParams.get('start')), end = date(url.searchParams.get('end'));
      if (!start || !end) return json(400, { message: 'Missing or invalid start or end' });
      const events = sampleHaRange(calendar[1], start, end);
      return events ? json(200, events) : json(400, { message: 'Entity not found' });
    }

    if (url.pathname === '/api/services/weather/get_forecasts' && request.method === 'POST') {
      const call = await request.json().catch(() => ({}));
      if (!url.searchParams.has('return_response')) {
        return json(400, { message: 'Service call requires responses but caller did not ask for responses' });
      }
      if (call.entity_id !== WEATHER) return json(400, { message: `Referenced entities ${call.entity_id} are missing or not currently available` });
      if (call.type !== 'daily') return json(400, { message: 'Weather entity does not support that forecast type' });
      return json(200, sampleForecast(today(), WEATHER));
    }

    return json(404, { message: 'Not found' });
  },
};
