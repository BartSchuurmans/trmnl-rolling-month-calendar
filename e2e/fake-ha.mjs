// Fake Home Assistant for the end-to-end test: serves /api/calendars/<entity> like HA
// does (date-only start/end, bearer token, timed events with an offset) and records
// every request. The events are placed around today so they land in the rolling month.
// It also serves ICS feeds under /feeds/<name>.ics (no token, like a secret feed link),
// and weather.forecast_home's daily forecast to a weather.get_forecasts service call
// (POST, as HA only gives forecasts to that), which the recipe's transform.js makes.
import http from 'node:http';

export const TOKEN = 'e2e-token';
// what the app's Home Assistant proxy adds (SUPERVISOR_TOKEN in app.yml)
export const SUPERVISOR_TOKEN = 'e2e-supervisor-token';
// the app's "Home Assistant key for recipes" (options.json in app.yml), which a recipe
// sends to the proxy as its token
export const APP_HA_KEY = 'e2e-recipe-key-0123456789abcdef';

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function events(entity) {
  const list = [];
  if (entity === 'calendar.family') {
    // two timed events on every day of the window
    for (let d = -7; d < 43; d++) {
      list.push({ start: { dateTime: `${day(d)}T08:30:00+02:00` }, end: { dateTime: `${day(d)}T09:15:00+02:00` }, summary: 'School run' });
      list.push({ start: { dateTime: `${day(d)}T18:00:00+02:00` }, end: { dateTime: `${day(d)}T19:00:00+02:00` }, summary: 'Dinner with friends' });
    }
  } else if (entity === 'calendar.work') {
    // a multi-day all-day event every week
    for (let d = -7; d < 43; d += 7) {
      list.push({ start: { date: day(d) }, end: { date: day(d + 3) }, summary: 'Conference' });
    }
  } else if (entity !== 'calendar.empty') {
    return null;
  }
  return list.map((e, i) => ({ ...e, description: '', location: '', uid: `${entity}-${i}` }));
}

// weather.get_forecasts' response for a daily forecast of `days` days from today
export const FORECAST_DAYS = 7;
function forecast(entity) {
  if (entity !== 'weather.forecast_home') return null;
  const conditions = ['sunny', 'rainy', 'cloudy', 'partlycloudy', 'snowy', 'lightning', 'fog'];
  return { changed_states: [], service_response: { [entity]: { forecast: Array.from({ length: FORECAST_DAYS }, (_, i) => ({
    datetime: `${day(i)}T10:00:00+00:00`, condition: conditions[i % conditions.length], temperature: 20 - i, templow: 10 - i })) } } };
}

// ICS feeds: a daily recurring event in Amsterdam time (with its VTIMEZONE, like Google
// and iCloud send) and a weekly three-day all-day event. `occurrences` lists every
// start/end, so the test can work out what LaraPaper should keep.
const ymd = (n) => day(n).replace(/-/g, '');
export const FEEDS = {
  family: {
    ics: [
      'BEGIN:VEVENT', 'UID:school-run@e2e', `DTSTART;TZID=Europe/Amsterdam:${ymd(-10)}T083000`,
      `DTEND;TZID=Europe/Amsterdam:${ymd(-10)}T091500`, 'RRULE:FREQ=DAILY;COUNT=60', 'SUMMARY:School run', 'END:VEVENT',
    ],
    occurrences: () => Array.from({ length: 60 }, (_, i) => {
      // Amsterdam is UTC+2 in summer, UTC+1 from the last Sunday of October
      const at = (hm) => {
        const d = new Date(`${day(i - 10)}T${hm}:00Z`);
        const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', timeZoneName: 'shortOffset' })
          .formatToParts(d).find((p) => p.type === 'timeZoneName').value.replace('GMT', '') || '0';
        return d.getTime() - parseInt(off, 10) * 3600000;
      };
      return { start: at('08:30'), end: at('09:15') };
    }),
  },
  work: {
    ics: [
      'BEGIN:VEVENT', 'UID:conference@e2e', `DTSTART;VALUE=DATE:${ymd(-7)}`, `DTEND;VALUE=DATE:${ymd(-4)}`,
      'RRULE:FREQ=WEEKLY;COUNT=8', 'SUMMARY:Conference', 'END:VEVENT',
    ],
    // all-day dates are read in the server's zone (UTC in the app)
    occurrences: () => Array.from({ length: 8 }, (_, i) => ({
      start: Date.parse(`${day(-7 + 7 * i)}T00:00:00Z`), end: Date.parse(`${day(-4 + 7 * i)}T00:00:00Z`) })),
  },
};

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Amsterdam',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE',
];

function feed(name) {
  const f = FEEDS[name];
  return f && ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//fake-ha//EN', ...VTIMEZONE, ...f.ics, 'END:VCALENDAR', ''].join('\r\n');
}

export function startFakeHa(port = 8123) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://ha');
    const feedMatch = url.pathname.match(/^\/feeds\/(\w+)\.ics$/);
    if (feedMatch) {
      requests.push({ feed: feedMatch[1], path: url.pathname, authorization: req.headers.authorization });
      const body = feed(feedMatch[1]);
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/calendar; charset=utf-8' });
      return res.end(body || '');
    }
    if (url.pathname === '/api/services/weather/get_forecasts') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let call = {};
        try { call = JSON.parse(body); } catch { /* recorded as is */ }
        requests.push({ weather: call.entity_id, type: call.type, method: req.method, query: url.search,
          path: url.pathname, authorization: req.headers.authorization });
        const result = req.method === 'POST' && url.search === '?return_response' && call.type === 'daily' && forecast(call.entity_id);
        res.writeHead(result ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result || { message: 'Bad request' }));
      });
      return;
    }
    const match = url.pathname.match(/^\/api\/calendars\/([\w.]+)$/);
    const entity = match?.[1];
    requests.push({ entity, path: url.pathname, start: url.searchParams.get('start'),
      end: url.searchParams.get('end'), authorization: req.headers.authorization });
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (![TOKEN, SUPERVISOR_TOKEN].some((t) => req.headers.authorization === `Bearer ${t}`)) {
      return send(401, { message: 'Unauthorized' });
    }
    const list = entity && events(entity);
    if (!list) return send(404, { message: 'Entity not found' });
    send(200, list);
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve({ server, requests })));
}
