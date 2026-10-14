// The sample calendars: a family of two adults, with a shared calendar and one of
// their own each. They repeat every six weeks, so any rolling month shows a full one.
// render.mjs draws them (README screenshots, CI), and the same events are published as
// ICS feeds in docs/sample-ics/ for TRMNL.com's marketplace preview, which polls them
// whenever its screenshot is regenerated. docs/sample-ha/ has them as a stand-in Home
// Assistant for the TRMNL.com Home Assistant recipe (plugin/trmnl-com-polling): its Home
// Assistant URL set to that folder on jsDelivr (cdn.jsdelivr.net/gh/<repo>@main/docs/
// sample-ha; raw.githubusercontent.com answers 404 to the token header), any token, the entities
// calendar.family, calendar.mark and calendar.sara. Those files are HA's
// /api/calendars/<entity> responses with every occurrence from the cycle's start to
// SAMPLE_HA_END (a static server ignores ?start=&end=), so move that on before it passes.
// sample-server/worker.mjs is the better stand-in: it works them out from today, and answers
// the weather forecast's POST too.
//
//   node sample-data.mjs write    regenerates docs/sample-ics/*.ics and docs/sample-ha/
//   node sample-data.mjs check    fails when they differ from this file (ci.sh)
//
// Nothing here needs Node but the command line, so the stand-in Home Assistant on
// Cloudflare Workers (preview/sample-server/worker.mjs) imports it as well.

// Week 0 of the cycle; the README screenshots are taken in it (Wednesday 30 September)
const ANCHOR = '2026-09-28';
const CYCLE = 6;
const TZID = 'Europe/Amsterdam';
// Last day (exclusive) in docs/sample-ha/
const SAMPLE_HA_END = '2028-01-03';
const DAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// week: week of the cycle (0-5); every: repeats every so many weeks (a divisor of six);
// nights: a timed event that ends that many days after it starts
const timed = (week, day, from, to, summary, every = CYCLE, nights = 0) => ({ week, day: DAYS[day], from, to, summary, every, nights });
const allDay = (week, day, days, summary, every = CYCLE) => ({ week, day: DAYS[day], days, summary, every });

export const CALENDARS = {
  family: [
    timed(0, 'Mon', '18:30', '19:30', 'Swimming lessons', 1),
    allDay(0, 'Thu', 1, 'Bin day', 2),
    timed(0, 'Fri', '19:00', '21:00', 'Dinner with Anna & Tom'),
    timed(0, 'Sat', '10:00', '16:00', 'Weekend in Antwerp', CYCLE, 1),
    timed(1, 'Wed', '15:00', '16:00', 'Parent-teacher meeting'),
    allDay(1, 'Sat', 1, 'Birthday Oma'),
    timed(1, 'Sat', '16:00', '19:00', 'Birthday party'),
    allDay(2, 'Sat', 9, 'Holiday'),
    timed(4, 'Fri', '20:00', '22:30', 'Concert'),
    timed(5, 'Fri', '19:30', '22:00', 'Movie night'),
    allDay(5, 'Sat', 2, 'Grandparents visiting'),
  ],
  mark: [
    timed(0, 'Tue', '07:00', '08:00', 'Gym', 1),
    timed(0, 'Wed', '11:00', '12:00', 'Dentist'),
    timed(0, 'Thu', '12:00', '13:00', null), // no title: shown as busy
    timed(0, 'Sat', '09:00', '10:30', 'Football', 2),
    timed(1, 'Tue', '09:00', '17:00', 'Offsite'),
    timed(3, 'Thu', '09:00', '09:30', 'Car service'),
    timed(5, 'Wed', '17:30', '18:00', 'Haircut'),
  ],
  sara: [
    timed(0, 'Tue', '13:00', '14:30', 'Quarterly planning'),
    timed(0, 'Wed', '09:30', '10:00', 'Standup'),
    timed(0, 'Thu', '18:00', '19:00', 'Yoga', 2),
    // shared with the family calendar → de-duplicated
    timed(1, 'Wed', '15:00', '16:00', 'Parent-teacher meeting'),
    timed(2, 'Tue', '14:00', '15:00', 'Design review'),
    timed(3, 'Thu', '19:00', '21:00', 'Team dinner'),
    allDay(4, 'Mon', 2, 'Conference'),
    timed(5, 'Tue', '20:00', '21:30', 'Book club'),
  ],
};

const DAY_MS = 86400000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
// first date of an event in the cycle, as UTC midnight
const first = (e) => Date.parse(`${ANCHOR}T00:00:00Z`) + (e.week * 7 + e.day) * DAY_MS;

// UTC offset of `zone` at noon on `date`, as HA writes it (+02:00)
function offset(date, zone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === 'timeZoneName').value;
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}

// One calendar in HA's /api/calendars response format: every occurrence that overlaps
// `from` to `to` (ms, UTC midnights), timed ones in time zone `zone`
function haEvents(name, from, to, zone) {
  const list = CALENDARS[name];
  const occurrences = (e) => {
    const step = e.every * 7 * DAY_MS, start = first(e);
    const out = [];
    for (let t = start + Math.floor((from - start) / step) * step; t < to; t += step) {
      if (t + (e.days || e.nights + 1) * DAY_MS > from) out.push(t);
    }
    return out;
  };
  return list.flatMap((e) => occurrences(e).map((t) => {
    const date = ymd(t), endDate = ymd(t + (e.nights || 0) * DAY_MS);
    const at = e.days ? { start: { date }, end: { date: ymd(t + e.days * DAY_MS) } } : {
      start: { dateTime: `${date}T${e.from}:00${offset(date, zone)}` },
      end: { dateTime: `${endDate}T${e.to}:00${offset(endDate, zone)}` },
    };
    return { ...at, summary: e.summary, description: null, location: null, uid: `${name}-${list.indexOf(e)}-${date}`,
      recurrence_id: null, rrule: null };
  }));
}

// The calendars as polled from HA: every occurrence from a week before `today`
// (YYYY-MM-DD) to seven weeks after it, in time zone `zone`
export function sampleData(today, zone) {
  const from = Date.parse(`${today}T00:00:00Z`) - 7 * DAY_MS, to = from + 8 * 7 * DAY_MS;
  return Object.fromEntries(Object.keys(CALENDARS).map((name, i) => [`IDX_${i}`, { data: haEvents(name, from, to, zone) }]));
}

// A work calendar for "Usual week" (calendar_usual_week), as rendered with
// render.mjs --work: Monday to Thursday 8:30-17:00, apart from a few changes in the cycle
// (a later Wednesday, Thursday swapped for Friday, the family's holiday week off, a short
// Tuesday). Like sampleData, a week before `today` to seven weeks after it, in HA's
// format; not one of the published sample calendars.
const WORK_CHANGES = {
  '1-Wed': ['12:00', '20:00'], '2-Thu': null, '2-Fri': ['08:30', '17:00'],
  '3-Mon': null, '3-Tue': null, '3-Wed': null, '3-Thu': null, '5-Tue': ['08:30', '13:00'],
};
export function sampleWork(today, zone) {
  const from = Date.parse(`${today}T00:00:00Z`) - 7 * DAY_MS, anchor = Date.parse(`${ANCHOR}T00:00:00Z`);
  const names = Object.keys(DAYS);
  const events = [];
  for (let t = from; t < from + 8 * 7 * DAY_MS; t += DAY_MS) {
    const days = Math.round((t - anchor) / DAY_MS);
    const week = ((Math.floor(days / 7) % CYCLE) + CYCLE) % CYCLE, day = names[((days % 7) + 7) % 7];
    const change = `${week}-${day}`;
    const times = change in WORK_CHANGES ? WORK_CHANGES[change] : DAYS[day] < 4 && ['08:30', '17:00'];
    if (!times) continue;
    const date = ymd(t);
    events.push({ start: { dateTime: `${date}T${times[0]}:00${offset(date, zone)}` }, end: { dateTime: `${date}T${times[1]}:00${offset(date, zone)}` },
      summary: 'Work', description: null, location: null, uid: `work-${date}`, recurrence_id: null, rrule: null });
  }
  return { data: events };
}

// docs/sample-ha/api/calendars/calendar.<name>: the cycle's start to SAMPLE_HA_END, in
// Amsterdam time, one event per line
export function sampleHa(name) {
  const events = haEvents(name, Date.parse(`${ANCHOR}T00:00:00Z`), Date.parse(`${SAMPLE_HA_END}T00:00:00Z`), TZID);
  return `[\n${events.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`;
}

// HA's /api/calendars/calendar.<name>?start=&end= (dates, YYYY-MM-DD) in Amsterdam
// time, as the stand-in on Cloudflare Workers answers it; null for an unknown calendar
export function sampleHaRange(name, start, end) {
  return Object.hasOwn(CALENDARS, name) ? haEvents(name, Date.parse(`${start}T00:00:00Z`), Date.parse(`${end}T00:00:00Z`), TZID) : null;
}

// A weather entity's daily forecast as the LaraPaper (local) app's proxy hands it over
// (Home Assistant's weather.get_forecasts response): ten days from `today`, each dated
// at noon UTC, cycling through every condition the recipe draws.
const FORECAST = [
  ['cloudy', 17, 9], ['rainy', 15, 10], ['partlycloudy', 16, 8], ['sunny', 19, 9], ['partlycloudy', 18, 11],
  ['pouring', 14, 9], ['cloudy', 13, 7], ['fog', 12, 6], ['lightning-rainy', 14, 8], ['snowy', 3, -2],
  ['windy', 11, 5], ['clear-night', 15, 5],
];
export function sampleForecast(today, entity = 'weather.forecast_home') {
  const forecast = Array.from({ length: 10 }, (_, i) => {
    const [condition, temperature, templow] = FORECAST[i % FORECAST.length];
    return { condition, datetime: `${ymd(Date.parse(`${today}T00:00:00Z`) + i * DAY_MS)}T12:00:00+00:00`,
      temperature, templow, precipitation: 0 };
  });
  return { changed_states: [], service_response: { [entity]: { forecast } } };
}

// The same forecast as Open-Meteo's daily forecast (on TRMNL.com: a recipe polling it,
// such as Daily Weather): 16 days from `today`, conditions as WMO codes
const WMO = { sunny: 0, 'clear-night': 0, partlycloudy: 2, cloudy: 3, windy: 3, fog: 45, rainy: 61, pouring: 65, snowy: 73, 'lightning-rainy': 95 };
export function sampleOpenMeteo(today) {
  const days = Array.from({ length: 16 }, (_, i) => FORECAST[i % FORECAST.length]);
  return {
    latitude: 52.38, longitude: 4.9, timezone: 'Europe/Amsterdam', utc_offset_seconds: 7200,
    daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C' },
    daily: {
      time: days.map((_, i) => ymd(Date.parse(`${today}T00:00:00Z`) + i * DAY_MS)),
      weather_code: days.map(([condition]) => WMO[condition]),
      temperature_2m_max: days.map(([, high]) => high + 0.3),
      temperature_2m_min: days.map(([, , low]) => low - 0.2),
    },
  };
}

// The same forecast's first two days as TRMNL's Weather plugin shares them (its Plugin
// Merge data): today and tomorrow, named in words, without dates
export function sampleTrmnlWeather() {
  const day = ([, high, low], icon, conditions) => ({ icon, conditions, maxtemp: high, mintemp: low, uv_index: 1,
    precip: { icon: 'chance-rain', probability: 20 }, day_override: null });
  return {
    forecast: {
      today: day(FORECAST[0], 'cloudy', 'Cloudy'),
      tomorrow: day(FORECAST[1], 'rainy', 'Rain Likely'),
      right_now: { icon: 'cloudy', conditions: 'Cloudy', temperature: 15, humidity: 70, feels_like: 15 },
    },
    temperature: 15, humidity: 70, utc_offset: 7200, data_provider: 'tempest', today_conditions: 'Cloudy',
  };
}

// iCalendar feed of one calendar: each event repeats weekly with its interval, timed
// ones in Amsterdam time (with its VTIMEZONE, like Google and iCloud send)
export function sampleIcs(name) {
  const compact = (s) => s.replace(/[-:]/g, '');
  const escape = (s) => s.replace(/[\\;,]/g, (c) => `\\${c}`);
  const events = CALENDARS[name].flatMap((e, i) => {
    const date = compact(ymd(first(e)));
    return [
      'BEGIN:VEVENT', `UID:${name}-${i}@rolling-month-calendar.sample`, `DTSTAMP:${compact(ANCHOR)}T000000Z`,
      ...(e.days ? [`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${compact(ymd(first(e) + e.days * DAY_MS))}`]
        : [`DTSTART;TZID=${TZID}:${date}T${compact(e.from)}00`, `DTEND;TZID=${TZID}:${compact(ymd(first(e) + e.nights * DAY_MS))}T${compact(e.to)}00`]),
      `RRULE:FREQ=WEEKLY;INTERVAL=${e.every}`,
      ...(e.summary ? [`SUMMARY:${escape(e.summary)}`] : []),
      'END:VEVENT',
    ];
  });
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rolling Month Calendar//sample//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${name[0].toUpperCase()}${name.slice(1)} (sample)`, `X-WR-TIMEZONE:${TZID}`,
    'BEGIN:VTIMEZONE', `TZID:${TZID}`,
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE',
    ...events, 'END:VCALENDAR', '',
  ].join('\r\n');
}

const { fileURLToPath } = globalThis.process?.argv?.[1] ? await import('node:url') : {};
if (fileURLToPath && process.argv[1] === fileURLToPath(import.meta.url)) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const docs = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs');
  const mode = process.argv[2];
  if (mode !== 'write' && mode !== 'check') {
    console.error('usage: node sample-data.mjs write|check');
    process.exit(2);
  }
  let stale = 0;
  const files = Object.keys(CALENDARS).flatMap((name) => [
    [path.join(docs, 'sample-ics', `${name}.ics`), sampleIcs(name)],
    [path.join(docs, 'sample-ha', 'api', 'calendars', `calendar.${name}`), sampleHa(name)],
  ]);
  for (const [file, content] of files) {
    if (mode === 'write') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    } else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
      console.error(`${path.relative(process.cwd(), file)} is out of date: run node preview/sample-data.mjs write`);
      stale++;
    }
  }
  if (stale) process.exit(1);
}
