// The recipe's serverless function (Node), shared by LaraPaper (0.47.0 and later run a
// recipe's transform.js after polling) and TRMNL.com (plugin/trmnl-com-polling/transform.js
// links here; trmnlp runs it as src/transform.js and `trmnlp push` uploads it). Both call
// run() with the polled data (several URLs as IDX_0, IDX_1, ..., one URL's answer at the
// top level, a list there as `data`) and `trmnl` (custom fields under
// trmnl.plugin_settings.custom_fields_values); what it returns is the template's data.
// Node, 128 MB and 5 s, network access, no packages. `trmnl` stays out of what it
// returns: the server adds it back for the template, and TRMNL.com's Debug Logs, which
// show the output, would show the token. Older LaraPaper ignores this file, so the
// polled data must stay a shape shared.liquid reads as it is.
//
// It adds the weather: Home Assistant gives a forecast only to a POST service call
// (weather.get_forecasts), and the server polls every URL with one verb, so the function
// makes that call itself, with the token, to Home Assistant only (also with ICS feeds,
// which don't get the token). The response goes last, in the same { service_response:
// { <entity>: { forecast: [...] } } } shape the LaraPaper (local) app's proxy answers, so
// shared.liquid reads it unchanged. A failed call goes last as { message }, which the
// calendar shows as "Could not load <entity>: ...", and the calendars still show. With
// the app's proxy as Home Assistant URL (127.0.0.1:8124, which only answers GETs), the
// forecast was already polled as the last URL (polling_url in settings.yml), so the data
// stays as it is.
async function run(input) {
  var fields = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  var entity = String(fields.weather_entity || '').trim();
  var output = {};
  var haUrl = String(fields.ha_url || '').trim().replace(/\/+$/, '');
  if (entity.indexOf('weather.') !== 0 || haUrl.indexOf('127.0.0.1:8124') !== -1) {
    Object.keys(input).forEach(function(key) { if (key !== 'trmnl') output[key] = input[key]; });
    return output;
  }

  // the calendars as IDX_0, IDX_1, ...: one polled calendar arrives as `data` (a list) or,
  // when Home Assistant answered with an object (an error), as that object's keys
  var calendars = [];
  var rest = {};
  Object.keys(input).forEach(function(key) {
    if (key === 'trmnl') return;
    if (/^IDX_\d+$/.test(key)) calendars[parseInt(key.slice(4), 10)] = input[key];
    else rest[key] = input[key];
  });
  if (!calendars.length) calendars.push('data' in rest ? rest.data : rest);

  calendars.push(await forecast(haUrl, String(fields.ha_token || '').trim(), entity));
  calendars.forEach(function(calendar, i) { output['IDX_' + i] = calendar; });
  return output;
}

async function forecast(haUrl, token, entity) {
  try {
    var response = await fetch(haUrl + '/api/services/weather/get_forecasts?return_response', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entity, type: 'daily' }),
      // within the 5 s for the whole function
      signal: AbortSignal.timeout(4000)
    });
    var body = await response.json().catch(function() { return null; });
    if (response.ok && body && body.service_response) return { service_response: body.service_response };
    // answered, but without a forecast (not "HTTP 200")
    if (response.ok) return { message: 'no forecast in the answer' };
    return { message: (body && body.message) || 'HTTP ' + response.status };
  } catch (e) {
    return { message: e && e.name === 'TimeoutError' ? 'no answer' : String((e && e.message) || e) };
  }
}
