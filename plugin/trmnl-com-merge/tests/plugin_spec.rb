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

  TRMNLP::Testing::PUBLISHABLE_RECIPE_VIEWS.each do |view|
    # TRMNL's devices as trmnlp's publishable-recipe checks draw them: the OG at 1 and 2 bits
    # and the TRMNL X, in landscape and portrait
    TRMNLP::Testing::PUBLISHABLE_RECIPE_SCREENS.each do |screen_options|
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

  TRMNLP::Testing.select_field_values.each do |keyname, values|
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

  it 'draws an empty grid when no calendar is chosen' do
    screen = trmnl.render(device: 'v2', now:, variables:,
                          custom_fields: custom_fields.reject { |key, _| key.match?(/\Acalendar_\d+\z/) })

    expect(screen).to have_css('.trmnl-calendar')
    expect(screen).to have_no_problems
  end
end
