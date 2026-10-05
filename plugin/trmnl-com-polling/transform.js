// TRMNL.com's serverless function for this variant (Node; trmnlp runs it as
// src/transform.js and `trmnlp push` uploads it). TRMNL.com calls run() after polling the
// calendars, with the polled data (several calendars as IDX_0, IDX_1, ..., one as `data`)
// and `trmnl` (custom fields under trmnl.plugin_settings.custom_fields_values); what it
// returns is the template's data. Node 24, 128 MB and 5 s, network access, no packages.
// `trmnl` stays out of what it returns: TRMNL.com adds it back for the template, and the
// Debug Logs, which show the output, would show the token.
//
// It adds the weather: Home Assistant gives a forecast only to a POST service call
// (weather.get_forecasts) and TRMNL.com polls every URL with one verb, so the function
// makes that call itself, with the token, to Home Assistant only. The response goes last,
// as the forecast URL does in plugin/src (through the LaraPaper app's proxy there), in
// the same { service_response: { <entity>: { forecast: [...] } } } shape, so
// shared.liquid reads it unchanged. A failed call goes last as { message }, which the
// calendar shows as "Could not load <entity>: ...", and the calendars still show.
async function run(input) {
  var fields = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  var entity = String(fields.weather_entity || '').trim();
  var output = {};
  if (entity.indexOf('weather.') !== 0) {
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

  calendars.push(await forecast(String(fields.ha_url || '').trim().replace(/\/+$/, ''), String(fields.ha_token || '').trim(), entity));
  calendars.forEach(function(calendar, i) { output['IDX_' + i] = calendar; });
  return output;
}

async function forecast(haUrl, token, entity) {
  try {
    var response = await fetch(haUrl + '/api/services/weather/get_forecasts?return_response', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entity, type: 'daily' }),
      // within TRMNL.com's 5 s for the whole function
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
