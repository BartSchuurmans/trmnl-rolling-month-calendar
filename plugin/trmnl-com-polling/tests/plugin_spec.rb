# frozen_string_literal: true

# TRMNL.com's Home Assistant recipe through trmnlp's own pipeline (`trmnlp test`, run by
# `node preview/trmnlp.mjs --test`): polling the calendars, the serverless function's
# forecast call (transform.js), and the views in Firefox, against a fake Home Assistant
# and at a fixed time. The calendars are the sample ones (docs/sample-ha, copied next to
# this file as sample-ha/); `trmnlp test --report` shows every screen drawn.
RSpec.describe 'Rolling Month Calendar (Home Assistant)' do
  HA = 'https://ha.example'
  TOKEN = 'test-token'
  # Every view and screen size of the recipe, each with its devices: the TRMNL X, and the OG
  # at 1 and 2 bits
  VIEWS = %w[full half_horizontal half_vertical quadrant].freeze
  DEVICES = %w[v2 og_png og_plus].freeze
  # One week fits in these, and a one-week grid has no day-number line for the forecast
  NO_FORECAST = [%w[half_horizontal og_png], %w[half_horizontal og_plus], %w[quadrant og_png],
                 %w[quadrant og_plus]].freeze
  EXPECTED_PROBLEMS = [
    # The local copy of FullCalendar (the LaraPaper app's) isn't there: the page then loads
    # jsDelivr's, as on TRMNL.com
    %r{\Afailed to load /rolling-month-calendar/},
    # Firefox's notice that FullCalendar's ResizeObservers left a change for the next frame
    # (the week fitting re-renders); the layout still settles
    /\AResizeObserver loop completed with undelivered notifications/,
  ].freeze
  # Boxes that cut off on purpose: a forecast's low goes to a hidden second line where the
  # day has no room for it, and long titles end in an ellipsis
  CLIPPED = [/\.trmnl-weather\b/, /\.mono-event-title\b/].freeze

  # Wednesday 7 October 2026, 08:00 in Amsterdam: the second week of the sample cycle
  let(:now) { '2026-10-07T06:00:00Z' }
  let(:custom_fields) do
    { ha_url: HA, ha_token: TOKEN, calendars: 'calendar.family,calendar.sara,calendar.mark',
      weather_entity: 'weather.forecast_home' }
  end
  let(:calendars) do
    lambda do |request|
      name = request[:url][%r{/api/calendars/([^?]+)}, 1]
      file = File.join(__dir__, 'sample-ha', name)
      next { status: 404, json: { message: 'Entity not found' } } unless File.exist?(file)

      { body: File.read(file), headers: { 'content-type' => 'application/json' } }
    end
  end
  let(:forecast) do
    { json: { changed_states: [], service_response: { 'weather.forecast_home' => { forecast: (0..9).map do |i|
      { condition: 'sunny', datetime: "#{Date.new(2026, 10, 7) + i}T12:00:00+00:00", temperature: 17 + i, templow: 5 }
    end } } } }
  end
  let(:mocks) do
    { "GET #{HA}/api/calendars/*" => calendars, "POST #{HA}/api/services/weather/get_forecasts*" => forecast }
  end

  def header(request, name) = request[:headers].find { |key, _| key.casecmp?(name) }&.last
  def problems(screen) = screen.problems.reject { |p| EXPECTED_PROBLEMS.any? { it.match?(p) } }
  def overflowing(screen) = screen.overflowing.reject { |el| CLIPPED.any? { it.match?(el) } }

  VIEWS.each do |view|
    DEVICES.each do |device|
      it "draws the #{view} view on #{device} with events and the forecast" do
        screen = trmnl.render(view:, device:, now:, custom_fields:, mocks:)

        expect(screen).to have_css('.trmnl-calendar')
        expect(screen).to have_text('Parent-teacher meeting')
        expect(screen).to have_css('.trmnl-weather') unless NO_FORECAST.include?([view, device])
        expect(screen).to have_no_text('Could not load')
        expect(problems(screen)).to be_empty
        expect(overflowing(screen)).to be_empty
      end
    end
  end

  it 'polls each calendar from the week before today to six weeks ahead, with the token' do
    run = trmnl.transform(now:, custom_fields:, mocks:)
    polls = run.requests.select { it[:via] == :polling }

    expect(polls.map { it[:url] }).to eq(%w[family sara mark].map do |name|
      "#{HA}/api/calendars/calendar.#{name}?start=2026-09-30&end=2026-11-19"
    end)
    expect(polls.map { header(it, 'Authorization') }.uniq).to eq(["Bearer #{TOKEN}"])
  end

  it 'asks Home Assistant for the forecast and adds it last, within the limits' do
    run = trmnl.transform(now:, custom_fields:, mocks:)
    call = run.requests.find { it[:method] == 'POST' }

    expect(call[:url]).to eq("#{HA}/api/services/weather/get_forecasts?return_response")
    expect(header(call, 'Authorization')).to eq("Bearer #{TOKEN}")
    expect(JSON.parse(call[:body])).to eq('entity_id' => 'weather.forecast_home', 'type' => 'daily')
    expect(run.error).to be_nil
    expect(run.data.keys).to include('IDX_0', 'IDX_1', 'IDX_2', 'IDX_3')
    expect(run.data.dig('IDX_3', 'service_response', 'weather.forecast_home', 'forecast').size).to eq(10)
    expect(run).to stay_within_serverless_limits
  end

  it 'leaves the forecast out without a weather entity' do
    run = trmnl.transform(now:, custom_fields: custom_fields.merge(weather_entity: ''), mocks:)

    expect(run.requests.map { it[:method] }.uniq).to eq(['GET'])
    expect(run.data.keys.grep(/\AIDX_/)).to eq(%w[IDX_0 IDX_1 IDX_2])
  end

  it "still draws the calendars when the forecast doesn't come in time" do
    slow = mocks.merge("POST #{HA}/api/services/weather/get_forecasts*" => forecast.merge(delay: 6))
    screen = trmnl.render(device: 'v2', now:, custom_fields:, mocks: slow)

    expect(screen.result.requests.find { it[:method] == 'POST' }[:aborted]).to be(true)
    expect(screen).to have_text('Parent-teacher meeting')
    expect(screen).to have_text('Could not load weather.forecast_home: no answer')
    expect(problems(screen)).to be_empty
  end

  it 'says which calendar Home Assistant refused' do
    screen = trmnl.render(device: 'v2', now:, mocks:,
                          custom_fields: custom_fields.merge(calendars: 'calendar.family,calendar.missing'))

    expect(screen).to have_text('Parent-teacher meeting')
    expect(screen).to have_text('Could not load')
    expect(problems(screen)).to be_empty
  end
end
