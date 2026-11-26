# frozen_string_literal: true

# TRMNL.com's Plugin Merge recipe through trmnlp's own pipeline (`trmnlp test`, run by
# `node preview/trmnlp.mjs --test`): every view on the TRMNL X and the OG,
# in Firefox. The merged data is the render context of `render.mjs --merge-weather trmnl
# --dump-context` (ci.sh's), copied next to this file as context.json: the sample calendars
# as TRMNL's calendar plugins share them, and TRMNL's Weather plugin.
RSpec.describe 'Rolling Month Calendar' do
  # Where a day has no room for a forecast's low, it wraps to a line its box hides on purpose
  CLIPPED = '.trmnl-weather'

  let(:context) { JSON.parse(File.read(File.join(__dir__, 'context.json'))) }
  let(:now) { Time.at(context.dig('trmnl', 'system', 'timestamp_utc')).utc }
  let(:custom_fields) { context['config'] }
  # the chosen plugins' data, at the top level as TRMNL.com merges it
  let(:variables) { context.select { |key, _| key.match?(/\A(caldav|weather)_\d+\z/) } }

  # trmnlp's own checks before publishing: every view on TRMNL's devices and each select
  # field's options, without page errors or leaked values. The examples below check what is drawn.
  it_behaves_like 'a publishable recipe'

  # The TRMNL Frame (31.5" Spectra 6) in its default palette, which trmnlp doesn't pick by
  # itself (upstream item 51)
  FRAME = { device: 'frame', palette: 'color-6a' }.freeze
  FRAME_SCREENS = [FRAME, FRAME.merge(orientation: :portrait)].freeze

  TRMNLP::Testing::PUBLISHABLE_RECIPE_VIEWS.each do |view|
    # TRMNL's devices as trmnlp's publishable-recipe checks draw them: the OG at 1 and 2 bits
    # and the TRMNL X, in landscape and portrait; and the Frame
    (TRMNLP::Testing::PUBLISHABLE_RECIPE_SCREENS + FRAME_SCREENS).each do |screen_options|
      device = screen_options[:device]
      name = [device, screen_options[:orientation]].compact.join(' ')
      it "draws the #{view} view on #{name} with events and the forecast" do
        screen = trmnl.render(view:, **screen_options, now:, custom_fields:, variables:)

        expect(screen).to have_css('.trmnl-calendar')
        # every Monday, so in the current week too
        expect(screen).to have_text('Swimming lessons')
        # TRMNL's Weather plugin has today and tomorrow only, which a one-week grid (no day-number
        # line) or a Sunday in the last week shown can leave without a place: the full view has both
        expect(screen).to have_css('.trmnl-weather') if view == 'full'
        expect(screen).to have_no_text('Could not load')
        expect(screen).to have_no_overflow(except: CLIPPED)
      end
    end
  end

  # Select fields only: 'a publishable recipe' already draws each boolean field on and off
  TRMNLP::Testing.option_field_values.reject { |_, values| values == %w[true false] }.each do |keyname, values|
    values.each do |value|
      it "draws the full view with #{keyname} set to #{value}" do
        screen = trmnl.render(device: 'v2', now:, variables:, custom_fields: custom_fields.merge(keyname => value))

        expect(screen).to have_text('Swimming lessons')
        expect(screen).to have_no_overflow(except: CLIPPED)
      end
    end
  end

  it 'draws every Calendar dropdown chosen' do
    # the sample calendars again in the dropdowns they leave empty: the same events, merged once
    calendars = variables.keys.grep(/\Acaldav_/)
    chosen = (1..8).to_h { |n| ["calendar_#{n}", calendars[(n - 1) % calendars.size]] }
    screen = trmnl.render(device: 'v2', now:, variables:, custom_fields: custom_fields.merge(chosen))

    expect(screen).to have_text('Swimming lessons')
    expect(screen).to have_css('.trmnl-weather')
    expect(screen).to have_no_problems
  end

  # TRMNL's calendar plugins share each event's colour (background_color): the default for a
  # calendar without one, matched to the screen's palette. Events that come without one
  # (CalDAV drops it from an event with a COLOR of its own) take the calendar's.
  SHARED = { 'Swimming lessons' => '#33B679' }.freeze # Sage
  let(:shared) do
    variables.transform_values do |data|
      next data unless data.is_a?(Hash) && data['events']

      data.merge('events' => data['events'].map { |e| e.merge('background_color' => SHARED[e['summary']]).compact })
    end
  end

  # ... a grey on the TRMNL X; on the Frame the green ink, with "Color style" on Filled events
  [['v2', 'bg--gray-'], ['frame', 'bg--green']].each do |device, fill|
    it "draws the colours calendar plugins share on #{device}" do
      palette = device == 'frame' ? { palette: 'color-6a' } : {}
      screen = trmnl.render(device:, **palette, now:, variables: shared,
                            custom_fields: custom_fields.merge('color_style' => 'fill'))

      expect(screen).to have_css(".mono-event--fill[class*='#{fill}']", text: 'Swimming lessons')
      expect(screen).to have_css(".mono-event--fill[class*='#{fill}']", text: 'Bin day')
      expect(screen).to have_no_problems
    end
  end

  # ... and by default on the Frame (Bars and bands) a bar in the ink next to a timed event,
  # which keeps its black text on white; the all-day event stays a band, with white text
  it 'draws the colours calendar plugins share as bars and bands on the Frame' do
    screen = trmnl.render(**FRAME, now:, variables: shared, custom_fields:)

    expect(screen).to have_css('.mono-event--bar:has(.mono-event-bar.bg--green.trmnl-bar--ink)', text: 'Swimming lessons')
    expect(screen).to have_no_css(".mono-event--bar[class*='bg--']")
    expect(screen).to have_css('.mono-event--fill.bg--green', text: 'Bin day')
    expect(screen.evaluate(<<~JS)).to eq('rgb(255, 255, 255)')
      getComputedStyle(document.querySelector('.mono-event--fill.bg--green .mono-event-title')).color
    JS
    expect(screen).to have_no_problems
  end

  it 'draws an empty grid when no calendar is chosen' do
    screen = trmnl.render(device: 'v2', now:, variables:,
                          custom_fields: custom_fields.reject { |key, _| key.match?(/\Acalendar_\d+\z/) })

    expect(screen).to have_css('.trmnl-calendar')
    expect(screen).to have_no_problems
  end
end
