# Foundry v13 + MEJ 13.06 compatibility — design (0.15.0)

## Purpose

Ship one companion build that runs on **Foundry VTT 13 with upstream
Monk's Enhanced Journal 13.06** as well as on Foundry 14 with MEJ 14.x. On
v13 the companion runs in its existing `native` mode (MEJ 13.06 has no
extension API); the feature set is exactly what `native` mode already
delivers on v14. No MEJ change of any kind is part of this work.

Evidence base: the 2026-09-02 spike (findings at
`~/.claude/jobs/4378f1d9/tmp/v13-spike-findings.md`, core audit
`v13-audit-core.md`, MEJ-contract audit `v13-audit-mej.md`). Headline
results: 0.14.0 with only its manifest floors lowered boots on Foundry
13.351 + MEJ 13.06 with zero companion console errors, resolves `native`,
runs the dataVersion migration, and passes the stock smoke
(`13-stock-smoke.spec.mjs`) 8/8. Foundry-core audit: 71 identical / 5
changed / 2 absent, no blockers. MEJ-contract audit: 42 identical / 12
changed / 9 absent, all 9 absent being extension-API entry points.

## Decisions taken in chat (2026-09-02)

- **Single release line, one build.** Manifest floors drop to Foundry 13 /
  MEJ 13.06; `verified` stays 14. No separate v13 branch, no opt-in
  setting. Runtime differences are handled by feature detection that
  already exists (api/native mode, `"revealable" in block`) plus the shims
  in §3 — nothing reads `game.release.generation`.
- **Automated v13 verification = the stock-smoke gate.** A v13 harness
  target plus `13-stock-smoke` as the pre-release gate on v13. The full
  e2e suite stays v14-only.
- **Approach 1 — shared render helper.** One module carries the
  `EnhancedJournalSheet.render` bypass; `MediaPageSheet`, `SessionSheet`
  and `CampaignHubPage` delegate to it. No common base class, no copies.
- Strategy B (backporting the extension API onto a 13.x MEJ branch) is
  rejected: 4–7 days plus a permanently maintained second MEJ branch, and
  it conflicts with "companion features never patch MEJ".

## Global constraints

- Version **0.15.0**. `module.json` `compatibility` = `{ "minimum": "13",
  "verified": "14" }`; MEJ requirement `compatibility.minimum` = `"13.06"`.
- No change to any file outside this repository; MEJ is never modified.
- No runtime branch on Foundry generation or MEJ version. Every
  difference is handled by feature detection or by a shim that is correct
  on both platforms.
- Behaviour on Foundry 14 in `api` mode is unchanged. The full v14 e2e
  suite must stay green.
- No `retries`, no `waitForTimeout` in shipped tests. Every product change
  ships with a regression test and a vacuity check (the test must be shown
  to fail without the fix).
- Release ceremony per repo rules: annotated tag `0.15.0` at the commit the
  zip is built from, pushed to origin; never modify published release
  assets in place.
- Test worlds: v13 `world-b` under `~/FoundryVTT` (sandbox). `world-a` on
  v13 has a module-stack quirk (first `Setting` create per session never
  resolves — not a companion problem) and is not used. The v14 `world-a`
  under `~/FoundryVTT-14` is the user's real world: the existing harness
  rules apply (id-tracked cleanup only).

## 1. Manifest and compatibility

`module.json`: version `0.15.0`; `compatibility` → `{ "minimum": "13",
"verified": "14" }`; `relationships.requires[monks-enhanced-journal]
.compatibility` → `{ "minimum": "13.06" }`. `manifest`/`download` URLs
unchanged (`releases/latest/download/…`).

Comment-only correction: `scripts/campaign-companion.mjs:203-206` calls
the object-keyed `controls.notes.tools` "the v14 shape"; it is the v13+
shape. Fix the comment.

Native-mode degradations from the MEJ audit that need **no code** — each
gets a "verified no-op on stock" line in the plan, not a task:

- `campaign` label/icon: the native-mode
  `DocumentSheetConfig.registerSheet` calls in `mej-adapter.mjs` already
  pass `label`; the "raw label" only affects MEJ's own type list, which on
  stock MEJ does not show companion types at all.
- `playerHidden`: stock MEJ has no per-attribute hidden flag, so
  `live-index.mjs:61`'s filter is correctly empty and nothing is hidden
  that MEJ itself would show.
- `fixType` stripping the MEJ type flag from Session pages: bounded,
  `native` mode keys identity off the document subtype
  (`mej-campaign-companion.session`, `scripts/logic/mej-type.mjs`).
- Calendar: `game.time.calendar` / `timeToComponents` are present and
  identical in v13; `campaign-calendar.mjs` already feature-detects.

## 2. Sheets — the awaitable-render helper

**Problem.** Upstream `EnhancedJournalSheet.render()` is not async and
discards the promise from its own `super.render()`, so
`JournalEntrySheet._renderPageView`'s `await sheet.render({force:true})`
resolves before `this.element` exists. On stock MEJ 13.06 the sidebar
open of a Session entry throws `TypeError: Cannot read properties of
undefined (reading 'removeAttribute')` at `JournalEntrySheet.js:609` and
the shell tab shows an empty page body (spike screenshot
`v13-open-shell.png`). `MediaPageSheet.mjs:92-96` already works around
this for pdf/video pages; `SessionSheet` and `CampaignHubPage` do not.

**Design.** New `scripts/sheets/awaitable-render.mjs`:

```js
/** Restore ApplicationV2's awaitable render contract (see comment). */
export function renderAwaitable(sheet, MejSheet, options = {}, _options = {}) {
  if (sheet.enhancedjournal) return MejSheet.prototype.render.call(sheet, options, _options);
  const base = Object.getPrototypeOf(MejSheet.prototype);
  return base.render.call(sheet, options, _options);
}
```

The helper does **not** import `EnhancedJournalSheet` itself: the sheets
import it from the absolute `/modules/monks-enhanced-journal/sheets/
EnhancedJournalSheet.js` path, which vitest cannot resolve, so the sheet
class is passed in — each sheet hands over its own import, the unit test
hands over a stub. The explanatory comment now at
`MediaPageSheet.mjs:49-91` moves here verbatim (it is the record of why
this exists and when to delete it). `MediaPageSheet.render`,
`SessionSheet.render` and `CampaignHubPage.render` become the same
override:

```js
async render(options = {}, _options = {}) { return renderAwaitable(this, EnhancedJournalSheet, options, _options); }
```

Shell-hosted sheets (`this.enhancedjournal` set — api mode on v14) take
MEJ's own path exactly as `MediaPageSheet` does today, so v14 api-mode
behaviour is unchanged by construction.

**Success criterion** on stock MEJ (13.06 on v13; the same code path on
stock 14.x): opening a Session or Hub entry from the sidebar produces
**no console error and no empty page body**. Either the page renders
inside MEJ's shell tab (expected, by analogy with the MediaPageSheet fix)
or the standalone sheet opens. Which of the two occurs is established
during implementation on v13 `world-b` and recorded in this section as an
addendum; both satisfy the requirement. The spike proved the crash, not
the fix — this is the one item with real uncertainty, so it is the first
implementation task.

**Unit test** (`test/awaitable-render.test.js`): with a stub
`EnhancedJournalSheet` whose `render` returns `undefined` and whose
prototype parent's `render` returns a resolved promise carrying a marker,
assert (a) `sheet.enhancedjournal` set → MEJ's render is called, base's is
not; (b) unset → base's render is called with the same arguments and its
promise is returned.

**Addendum (verified 2026-09-02 on Foundry 13.351 + MEJ 13.06, world-b):**
the sidebar open of a Session mounts in the MEJ shell tab —
`{"shellRendered":true,"inShell":true,"standalone":false}`, the
`stock-session-mount` annotation from
`tests/e2e/13-stock-smoke.spec.mjs`'s "opening the session from the
sidebar renders it without errors" test. Zero console errors. Vacuity
check: with the un-fixed SessionSheet/CampaignHubPage restored, the same
test failed with:

```
Error: expect(locator).toBeAttached() failed

Locator: locator('.session-container').first()
Expected: attached
Timeout: 15000ms
Error: element(s) not found
```

Probe E2 (`2026-09-02-v13-compat-investigation.md` in this directory, run
2026-09-02) additionally reproduces the `removeAttribute` TypeError at
`JournalEntrySheet.js:609` with the fix removed and the correct click
target; on 13.06 the page body is eventually populated by MEJ's second
`_renderPageViews` pass, so `expect(errors).toEqual([])` — not the
`.session-container` assertion — is the durable regression net.

## 3. Core shims

- **`URL.parse`** (`MediaPageSheet.mjs:147`; v13 core never uses this
  Baseline-2024 API, v14 core does). New `scripts/logic/url.mjs` exporting
  `isAbsoluteUrl(s)` = `try { new URL(s); return true } catch { return false }`.
  `MediaPageSheet` uses it in place of `URL.parse(src) ? … : …`. Unit test:
  absolute `https://…`, relative `modules/x/y.pdf`, empty string, garbage
  `http://[`.
- **`HTMLSecretBlockElement#revealable`** is v14-only. No code change:
  `suppressCoreRevealToggles` (`secrets-ui.mjs:43-53`) already feature-
  detects and removes `:scope > .secret > button.reveal`, which matches
  v13's `secret-block.mjs` markup exactly; it runs on every
  `renderJournalPageSheet` / `renderEnhancedJournalSheet` pass and again
  after the async section injection (`secrets-ui.mjs:277`), so it is
  re-applied after each re-render. v13's private `#button` field survives
  DOM removal, so a later `connectedCallback` does not re-add the button.
  Parity with v14 is therefore the same hook timing on both platforms; a
  `revealable` accessor shim on the prototype is deliberately not added.
  **Regression net**: the DOM-only loop of `suppressCoreRevealToggles`
  (the `for (const block of element.querySelectorAll("secret-block"))`
  body) moves to a pure function `suppressRevealToggles(element)` in a new
  `scripts/logic/secret-reveal-toggles.mjs` (no imports; `secrets-ui.mjs`
  cannot be imported under vitest because it reaches `mej-adapter.mjs` and
  the absolute MEJ import). `suppressCoreRevealToggles` keeps the
  page/owner checks and calls it. A jsdom vitest test
  (`test/secret-reveal-toggles.test.js`) feeds v13 markup
  (`<secret-block><section class="secret"><button class="reveal">…`, no
  `revealable` property) and asserts the button is removed, and feeds a
  v14-style element (with a `revealable` property) and asserts the
  property is set to `false` and the button kept — so a future edit cannot
  drop either branch.
- The other present-but-changed core items in the audit
  (`DocumentSheetV2#_toggleDisabled` secret sweep — overridden to no-op in
  the companion's sheets; `ClientDocument.createDialog` arity;
  `tab-navigation.hbs` `tabClasses`) were found signature-compatible: **no
  change**. The plan lists them so the reviewer can check the claim.

## 4. Harness — a v13 target for the stock gate

- **Target preset.** `FOUNDRY_TARGET=v13` resolves defaults
  `FOUNDRY_URL=http://localhost:30013`, `FOUNDRY_TEST_WORLD=world-b`,
  `FOUNDRY_APP=~/FoundryVTT/FoundryVTT-Node-13.351`,
  `FOUNDRY_DATA=~/FoundryVTT/Data`,
  `FOUNDRY_MODULE_LINK=~/FoundryVTT/Data/Data/modules/mej-campaign-companion`
  (`~` expanded). Explicit env vars always win. `FOUNDRY_TARGET` unset →
  today's v14 defaults, so no existing run changes. Implemented as a pure
  `resolveTarget(env)` in a new `tests/e2e/helpers/target.mjs`, consumed
  by `foundry.mjs`, `deploy.mjs`, `env-lock.mjs` and `playwright.config.mjs`
  wherever they read those variables today; vitest-covered (unset, `v13`,
  `v13` + one explicit override, unknown value → throws).
- **Wrong-server guard.** `global-setup.mjs` reads `/api/status` and fails
  fast if the reported core generation does not match the target
  (`v13` → 13, default → 14). Protects the real v14 `world-a` from a v13
  run pointed at the wrong port and vice-versa.
- **Deploy.** The v13 module path is a symlink to the main checkout; the
  existing `verifyDeployment` contract (symlink resolves to repo root,
  sentinels byte-identical) is unchanged. The e2e lock lives under
  `FOUNDRY_DATA`, so v13 and v14 locks are independent.
- **Noise.** `KNOWN_V13_COMPUTE_PRESSURE_POLICY = /compute-pressure is not
  allowed/` joins the default ignore list in `trackConsoleErrors`.
- **Server.** The harness's existing `ensureTestWorld` starts Foundry when
  the target world is not up; `startServer` now passes
  `--port=<port of FOUNDRY_URL>` so the v13 launch (30013) never falls back
  to `options.json`'s 30000, which the v14 server holds. No manual step.
- **Regression test for §2.** `13-stock-smoke.spec.mjs` gains one test in
  the `stock` phase: open the fixture Session from the journal sidebar,
  assert zero tracked console errors and a non-empty page body (the
  rendered sheet's content region has at least one element child). Vacuity
  check: it must fail against 0.14.0 on v13 (the reproduced crash). Because
  stock MEJ 13.06 needs no symlink swap, the v13 gate is
  `FOUNDRY_TARGET=v13 STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
  followed by `STOCK_PHASE=cleanup` (deletes the fixture). The `return` phase
  asserts `api` mode on the API-carrying MEJ and is v14-only. The v14 procedure
  (symlink swap to `maint/14.00-sync`) stays as-is for v14 stock claims.

## 5. Docs and release

- `README.md`: requirements → Foundry VTT **v13 or v14**; MEJ **13.06+ on
  v13**, **14.01+ on v14** (extension API only on 14.x builds that carry
  it). Mode table gains a note: on Foundry 13, MEJ 13.06 has no extension
  API, so the companion always runs `native` there. `README.md:16`
  "Foundry's v14 calendar API" → "Foundry's calendar API (v13+)".
- `tests/e2e/README.md`: new "Stock gate on v13" section with the commands
  above; `FOUNDRY_TARGET` documented next to the other env vars.
- User guides (`docs/*.md`): grep for "v14"; the three `gm-guide.md`
  mentions describe MEJ header-button behaviour and stay; any absolute
  "requires v14" claim is reworded. `npm run check:links` as usual.
- `CHANGELOG.md`: 0.15.0 entry.
- Release: version 0.15.0; annotated tag `0.15.0` at the commit the zip is
  built from, pushed; GitHub release with `module.zip` + `module.json`.
  Gates before tagging, in order: `npm test`, `npm run check:links`,
  `npm run check:vendor`, full v14 e2e on the v14 harness, v13 stock gate
  `stock` + `cleanup` on `world-b`.

## 6. Verification matrix

| Surface | v14 + fork MEJ (api) | v13 + MEJ 13.06 (native) |
|---|---|---|
| Boot, settings, migrations | full suite | stock-smoke |
| Session/Hub render via helper | full suite (01, 02, 14, 17) | new sidebar-open test |
| Secrets reveal suppression | 09/10 | vitest `secret-reveal-toggles` (v13 + v14 markup) |
| PDF viewer `isAbsoluteUrl` | 17 | vitest |
| Target preset / wrong-server guard | vitest | vitest + one real run |

## Out of scope

- Extension-API backport onto a 13.x MEJ branch (Strategy B).
- Running the full e2e suite on v13; mode-aware skips for api-only specs.
- Foundry v12.
- Automating the v13 server launch.
- Any change to Monk's Enhanced Journal.
- The v13 `world-a` Setting-create quirk (environmental; not ours).
