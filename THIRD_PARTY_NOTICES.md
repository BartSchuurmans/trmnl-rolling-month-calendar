# Third-party notices

The MIT license in [LICENSE](LICENSE) covers this project's own code. The works below
are included in or redistributed with it under their own terms.

## TRMNL native calendar plugin

The recipe in `plugin/src/` is forked from TRMNL's native calendar plugin in
[usetrmnl/plugins](https://github.com/usetrmnl/plugins) (`lib/calendars`,
`lib/google_calendar`); [UPSTREAM.md](UPSTREAM.md) lists what was kept and what changed.
That repository has no license file. TRMNL treats its native plugins as
source-available and has confirmed it is fine with them being remixed; this project
relies on that permission for the upstream-derived parts, which remain TRMNL's work
and are not covered by the MIT license above. Only the changes and additions made
here are.

## The LaraPaper (local) app

The Home Assistant app image is built on the official LaraPaper add-on's image
([LaraPaper](https://github.com/usetrmnl/larapaper), MIT), unmodified, with this
project's own scripts added. Up to app version 0.46.0 it also bundled the TRMNL
framework, its fonts and FullCalendar; it no longer redistributes them.
