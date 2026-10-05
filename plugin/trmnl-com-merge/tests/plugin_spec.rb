# frozen_string_literal: true

# TRMNL.com's Plugin Merge recipe through trmnlp's own pipeline (`trmnlp test`, run by
# `node preview/trmnlp.mjs --test`): every view on the TRMNL X and the OG,
# in Firefox. The merged data is the render context of `render.mjs --merge-weather trmnl
# --dump-context` (ci.sh's), copied next to this file as context.json: the sample calendars
# as TRMNL's calendar plugins share them, and TRMNL's Weather plugin.
RSpec.describe 'Rolling Month Calendar (TRMNL calendars)' do
  VIEWS = %w[full half_horizontal half_vertical quadrant].freeze
  DEVICES = %w[v2 og_png og_plus].freeze
  # trmnlp's 'a publishable recipe' checks (0.18.0) have no room for the two lists below, nor
  # for Plugin Merge's data, so the examples here run the same checks with them
  EXPECTED_PROBLEMS = [
    # Firefox's notice that FullCalendar's ResizeObservers left a change for the next frame
    # (the week fitting re-renders); the layout still settles
    /\AResizeObserver loop completed with undelivered notifications/,
  ].freeze
  # Boxes that cut off on purpose: a forecast's low goes to a hidden second line where the
  # day has no room for it, and long titles end in an ellipsis
  CLIPPED = [/\.trmnl-weather\b/, /\.mono-event-title\b/].freeze

  let(:context) { JSON.parse(File.read(File.join(__dir__, 'context.json'))) }
  let(:now) { Time.at(context.dig('trmnl', 'system', 'timestamp_utc')).utc }
  let(:custom_fields) { context['config'] }
  # the chosen plugins' data, at the top level as TRMNL.com merges it
  let(:variables) { context.select { |key, _| key.match?(/\A(caldav|weather)_\d+\z/) } }

  def problems(screen) = screen.problems.reject { |p| EXPECTED_PROBLEMS.any? { it.match?(p) } }
  def overflowing(screen) = screen.overflowing.reject { |el| CLIPPED.any? { it.match?(el) } }

  VIEWS.each do |view|
    DEVICES.each do |device|
      it "draws the #{view} view on #{device} with events and the forecast" do
        screen = trmnl.render(view:, device:, now:, custom_fields:, variables:)

        expect(screen).to have_css('.trmnl-calendar')
        # every Monday, so in the current week too
        expect(screen).to have_text('Swimming lessons')
        # TRMNL's Weather plugin has today and tomorrow only, which a one-week grid (no day-number
        # line) or a Sunday in the last week shown can leave without a place: the full view has both
        expect(screen).to have_css('.trmnl-weather') if view == 'full'
        expect(screen).to have_no_text('Could not load').and have_no_leaked_text
        expect(problems(screen)).to be_empty
        expect(overflowing(screen)).to be_empty
      end
    end
  end

  TRMNLP::Testing.select_field_values.each do |keyname, values|
    values.each do |value|
      it "draws the full view with #{keyname} set to #{value}" do
        screen = trmnl.render(device: 'v2', now:, variables:, custom_fields: custom_fields.merge(keyname => value))

        expect(screen).to have_text('Swimming lessons').and have_no_leaked_text
        expect(problems(screen)).to be_empty
        expect(overflowing(screen)).to be_empty
      end
    end
  end

  it 'draws an empty grid when no calendar is chosen' do
    screen = trmnl.render(device: 'v2', now:, variables:,
                          custom_fields: custom_fields.reject { |key, _| key.match?(/\Acalendar_\d\z/) })

    expect(screen).to have_css('.trmnl-calendar')
    expect(problems(screen)).to be_empty
  end
end
