# Vendored third-party bundles

These three files are checked-in builds of third-party libraries. They are
loaded at runtime by `scripts/integrations/vendor-loader.mjs` (script tag, on
first use) or imported directly, and they ship inside the release zip.

Because they are checked in rather than installed, **`npm audit` never sees
them** — it only reads `package.json`. That makes their provenance something
this file has to carry explicitly, which is why it exists.

`npm run check:vendor` verifies each file still matches the checksum recorded
below, and runs in CI alongside the unit suite.

## Inventory

| File | Upstream | License | Build format |
|---|---|---|---|
| `mammoth.browser.min.js` | [mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | browserify UMD, minified |
| `docx.iife.js` | [dolanmiu/docx](https://github.com/dolanmiu/docx) | MIT | rolldown IIFE |
| `d3-force.esm.js` | [d3/d3-force](https://github.com/d3/d3-force) + its deps | ISC | esbuild ESM bundle |

`mammoth` converts an imported `.docx` into HTML — it is the one library here
that parses untrusted input, so it is the one whose version matters most.
`docx` builds the export. `d3-force` lays out the relationship graph.

## Recorded checksums

    sha256  48f782490b81115af367308c904b6f5b8795c1662467f3b317208a017d62e3d8  d3-force.esm.js
    sha256  d5ec4f5a8b99740845974f5f6f020d6e5b1b6c27026195befc67eb37035c84c7  docx.iife.js
    sha256  5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9  mammoth.browser.min.js

These are also in `checksums.txt`, which is what `check:vendor` reads.

## Known gap: the current versions are unidentified

**None of these files records the version it was built from, and the versions
cannot be recovered after the fact.** The bundles were added on 2026-08-16 with
no version noted. `mammoth.browser.min.js` was checked by SHA-256 against every
published `mammoth` release from 1.6.0 through 1.12.1 and matches **none** of
them — consistent with a local build rather than a copy of the file shipped in
the npm package (`d3-force.esm.js`'s own header says it was bundled locally with
esbuild, and `docx.iife.js` is a rolldown build, so a local build step is the
likely origin for all three).

The practical consequence: if a CVE is published against `mammoth`, there is
currently no way to answer "are we affected?" from this repository. Treat that
as open.

Closing it means re-vendoring from pinned versions and recording them here.
That is deliberately **not** bundled into the bugfix round that wrote this file:
replacing these bundles changes library behavior for docx import and export, so
it needs its own change with the round-trip e2e specs (`05-docx-import`) run
against it, not a drive-by swap.

## Regenerating (for whoever does that next)

Pin the version explicitly and record it, so the next reader does not inherit
this same gap:

```sh
# mammoth — the npm package ships the browser bundle prebuilt
npm pack mammoth@<version>
tar xzf mammoth-<version>.tgz
cp package/mammoth.browser.min.js vendor/

# docx — ships a prebuilt IIFE bundle
npm pack docx@<version>
tar xzf docx-<version>.tgz
cp package/build/index.iife.js vendor/docx.iife.js

# d3-force — bundled locally with its transitive deps
npm i --no-save d3-force@<version>
npx esbuild --bundle --format=esm --minify \
  --outfile=vendor/d3-force.esm.js node_modules/d3-force/src/index.js
```

Then, in this order:

1. Add the version to the Inventory table above.
2. Refresh the checksums here and in `checksums.txt`:
   `shasum -a 256 vendor/*.js`
3. Run `npm run check:vendor` — it must pass.
4. Run the docx round-trip e2e (`npx playwright test tests/e2e/05-docx-import.spec.mjs`)
   and the graph spec (`08-query-graph`) against a live world; unit tests do
   not exercise these bundles.
5. Keep the license row accurate, and keep the attribution in the repo README's
   license section in step with it.

The first line of `d3-force.esm.js` is a provenance comment this project added,
not upstream content — preserve it (or re-add it) when regenerating, and expect
it to change that file's checksum.
