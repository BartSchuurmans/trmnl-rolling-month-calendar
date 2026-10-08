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

## Bundled in the LaraPaper (local) app

The Home Assistant app image adds these files to the official LaraPaper image
(`larapaper/assets.txt`). Their license texts are installed next to them in the image.

| Files | Copyright | License | Text in the image |
|---|---|---|---|
| TRMNL framework 3.4.0 (`plugins.min.css`, `plugins.min.js`) | TRMNL | MIT | `/trmnl-framework/3.4.0/LICENSE` |
| TRMNL12, TRMNL16, TRMNL21 fonts | Heavyweight Digital Type Foundry s.r.o. | SIL OFL 1.1 | `/fonts/OFL-trmnl.txt` |
| Inter (`Inter.ttf`, `Inter-Italic.ttf`) | The Inter Project Authors | SIL OFL 1.1 | `/fonts/OFL-trmnl.txt`, `/fonts/OFL-classic.txt` |
| NicoPups, NicoClean fonts | Emily Huo | SIL OFL 1.1 | `/fonts/OFL-classic.txt` |
| BlockKie font | JoohnFonts | CC BY 3.0 | `/fonts/CC-BY-3.0.txt` |
| FullCalendar 6.1.21 (`index.global.min.js`, `locales-all.global.min.js`), for recipes up to v1.9.0 | Adam Shaw | MIT | `/rolling-month-calendar/fullcalendar/6.1.21/LICENSE.md` |
| FullCalendar 7.1.0 (`all/global.js`, `locales-all/global.js`, `skeleton.css`) | Adam Shaw | MIT | `/rolling-month-calendar/fullcalendar/7.1.0/LICENSE.md` |

The fonts come unmodified from the TRMNL framework's
[font bundles](https://github.com/usetrmnl/trmnl-framework/tree/v3.4.0/public/fonts/bundles),
which also carry per-font details. BlockKie is by
[JoohnFonts](https://fontstruct.com/fontstructors/show/1669437/joohnfonts), used under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), unmodified.

The image is built on [LaraPaper](https://github.com/usetrmnl/larapaper) (MIT), which
is not modified here apart from the Inter stylesheet link removed from its screen
template (see `larapaper/Dockerfile`).

## Device frames in the README images

The TRMNL X and TRMNL OG frames around the screenshots in `docs/preview*.png` are the
bezel artwork from TRMNL's
[`<trmnl-frame>` web component](https://github.com/usetrmnl/trmnl-component)
(`preview/frame.mjs` fetches it at a pinned commit), Copyright (c) 2025 TRMNL, used
under the [MIT license](https://github.com/usetrmnl/trmnl-component/blob/c72d9dc6a161d77a99d4f953c7ca5df2fc7278b7/LICENSE).
