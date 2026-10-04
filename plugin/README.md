# The recipe and its variants

The markup is maintained once, in `src/`: the recipe in trmnlp format, as LaraPaper runs
it (recipe catalog, Home Assistant app, ZIP import) and as trmnlp previews it.

Every other folder here is a **variant**: the same markup with another data source, for
another place to publish it. A variant has only what differs:

- `settings.yml` — its whole trmnlp settings: strategy, form fields, framework.
- optional `*.liquid` — put in front of `src/shared.liquid` (in name order), for data
  handling `src/` can't hold. `trmnl-com-merge/merge.liquid` is one: LaraPaper's Liquid can't
  parse its lookup.
- optional `transform.js` — a TRMNL.com serverless function: runs after polling (Polling
  and Webhook strategies only) and returns the template's data. `trmnl-com-polling/transform.js`
  fetches the weather. LaraPaper has nothing like it, so its output must be a shape
  `src/shared.liquid` already reads.
- optional `tests/*_spec.rb` — its tests, run by `trmnlp test` on the built variant
  (`node preview/trmnlp.mjs --test`, in `preview/ci.sh`): the views on TRMNL's devices and,
  with fake APIs and a fixed clock, its polling and serverless function. Not uploaded.

| Variant | Where | Data |
|---|---|---|
| `src/` | LaraPaper | ICS feeds, Home Assistant (polling) |
| [`trmnl-com-merge/`](trmnl-com-merge/README.md) | TRMNL.com | TRMNL calendar and weather plugins (Plugin Merge) |
| [`trmnl-com-polling/`](trmnl-com-polling/README.md) | TRMNL.com | Home Assistant calendar entities (polling, public URL + token) and weather (serverless function) |

`scripts/build-variant.sh [variant...]` builds each variant into `dist/<variant>/src` (a
trmnlp project) and `dist/rolling-month-calendar-<variant>.zip`. Lint (`trmnlp lint`)
runs on those builds, and every release attaches the ZIPs.

**Keeping them in step.** `preview/variants.mjs check` (run by `preview/ci.sh`) compares
each variant's form fields with `src/settings.yml`: the settings both have must match in
type, name, options, default and order, and a setting of `src/` that a variant leaves out
must be listed for that variant in `VARIANTS` there, with why (as must a property a
variant sets its own way, in its `differs`). So a new setting fails CI
until each variant has it or says why not. The About text is each variant's own.

**Publishing to TRMNL.com.** TRMNL.com changes only on a release: `release.yml` runs
`.github/workflows/trmnl-com.yml`, which uploads each TRMNL.com variant with `trmnlp push`
and checks that TRMNL.com then matches the build. Weekly (and on demand from the Actions
tab) the same workflow only compares TRMNL.com with the latest release, so an edit made on
TRMNL.com itself shows up as a failed run with the differences in its summary. It needs
the `TRMNL_API_KEY` secret and, per variant, the plugin ID variable named in the
workflow's matrix (`TRMNL_PLUGIN_ID_MERGE` for `trmnl-com-merge`, `TRMNL_PLUGIN_ID_POLLING` for
`trmnl-com-polling`). Don't edit the markup on TRMNL.com,
in its editor or through the TRMNL MCP connector: change it here and release.

**Adding a variant** (say a TRMNL.com recipe polling Home Assistant):

1. `plugin/<name>/settings.yml` with its strategy and fields (here: polling URL and
   headers as in `src/settings.yml`, only the HA fields).
2. An entry in `VARIANTS` in `preview/variants.mjs`: the `src/` settings it leaves out,
   and a pattern for the fields only it has.
3. A matrix entry in `.github/workflows/trmnl-com.yml` with the variable holding its
   plugin ID, if it goes to TRMNL.com.
4. If its data arrives in a new shape: handle it in `src/shared.liquid`'s JS if every
   variant can share that, else in a `*.liquid` in the variant's folder; and a
   `render.mjs` option plus a `ci.sh` render for it.
