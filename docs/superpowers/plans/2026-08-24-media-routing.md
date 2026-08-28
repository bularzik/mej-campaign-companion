# PDF & Video Shell Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Foundry's native `pdf` and `video` journal pages open inside the MEJ shell with MEJ chrome, and give them first-class Hub index rows.

**Architecture:** A thin `EnhancedJournalSheet` subclass is registered over the two native page types (the mechanism the campaign portal proved in 0.10.0) and mounts Foundry's own viewer inside MEJ's frame — no new flag types, no data migration. The Hub's untyped-row bucket gains a pure page-type→row-type derivation so PDFs and videos get their own icons and filter chips.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules), MEJ's `EnhancedJournalSheet`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-media-routing-design.md` (on this branch — read it first; its Decisions table is binding, notably: register over native types rather than minting flag types; the companion hosts core's viewer instead of re-implementing it; content search and auto-link-as-source are explicitly out of scope).

## Global Constraints

- Branch `feature/media-routing`, worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/media-routing`. Never commit to main. No changes to the monks-enhanced-journal repo, ever.
- Playwright always `--trace off`; TT- fixture prefix; World A is shared — id-tracked destructive cleanup only; reset the campaign scope AND the timeline selection to `""`; snapshot/restore `autoCaptureCampaign`; call `cleanupTimelineJournal` in teardown; verify the module symlink with readlink afterward.
- Unit suite: **590 green** before this plan; Task 1 adds exactly 10 → **600** from Task 1 on.
- `dataVersion` stays 2 — no migration, no flag writes on load, no conversion of existing pdf/video pages.
- **Two binding lessons from sub-project C** (they cost two fix rounds there; do not relearn them): the new sheet MUST override `_toggleDisabled` to a no-op (MEJ's shell blanket-disables a subsheet whose document isn't owner-editable, which would freeze a video's own play button for every non-owner), and any page-type check MUST accept both the bare and module-prefixed forms because MEJ's `fixType` normalizes a mounted page's in-memory `.type`.
- `CampaignHubPage` and MEJ subsheets use `activateListeners()`/`subRender()`, NEVER `_onRender()` — a listener attached in `_onRender` silently never binds while shell-hosted.
- Disabling the module must fully restore stock Foundry behavior for pdf/video pages (nothing persisted, registration simply absent).

---

### Task 1: Pure row-type derivation for native media pages

**Files:**
- Modify: `scripts/logic/hub-index.mjs` (add `nativeRowType`; use it in `buildIndexSource`)
- Modify: `scripts/logic/sheet-registration.mjs` (extend `missingSheetRegistrations`)
- Test: `test/hub-index.test.js`, `test/sheet-registration.test.js`

**Interfaces:**
- Consumes: nothing new (pure module, no Foundry imports — same convention as the rest of `logic/`).
- Produces: `nativeRowType(entry) -> "pdf"|"video"|"image"|"journal"`; `buildIndexSource`'s rows now carry those types for untyped entries; `missingSheetRegistrations(sheetClasses, sessionType, hubType, campaignType, mediaTypes)` returns `{session, hub, campaign, media}` where `mediaTypes` is a string array. Tasks 2-3 consume both.

- [ ] **Step 1: Write the failing tests**

Append to `test/hub-index.test.js` (read the file first and match its existing fixture helpers — it already builds entry-shaped objects; add pages to them as shown):

```js
describe("nativeRowType", () => {
  const entry = (pageTypes) => ({ pages: { contents: pageTypes.map((type) => ({ type })) } });

  it("maps the first page's native type to a row type", () => {
    expect(nativeRowType(entry(["pdf"]))).toBe("pdf");
    expect(nativeRowType(entry(["video"]))).toBe("video");
    expect(nativeRowType(entry(["image"]))).toBe("image");
  });
  it("falls back to journal for text and unknown page types", () => {
    expect(nativeRowType(entry(["text"]))).toBe("journal");
    expect(nativeRowType(entry(["whatever"]))).toBe("journal");
  });
  it("falls back to journal for an entry with no pages", () => {
    expect(nativeRowType(entry([]))).toBe("journal");
    expect(nativeRowType({})).toBe("journal");
    expect(nativeRowType(null)).toBe("journal");
  });
  it("only considers the FIRST page (single-page convention)", () => {
    expect(nativeRowType(entry(["text", "pdf"]))).toBe("journal");
  });
});

describe("buildIndexSource media rows", () => {
  const user = { isGM: true };
  const mediaEntry = (uuid, name, type) => ({
    uuid, name, testUserPermission: () => true,
    pages: { contents: [{ type }] }
  });

  it("gives untyped pdf/video entries their own row types and icons", () => {
    const rows = buildIndexSource(
      [mediaEntry("J.p", "Rules", "pdf"), mediaEntry("J.v", "Session 3 VOD", "video")],
      user, () => false, () => "fa-unused");
    expect(rows.map((r) => [r.type, r.icon])).toEqual([
      ["pdf", "fas fa-file-pdf"],
      ["video", "fas fa-film"]
    ]);
  });
  it("still lists untyped text entries as journal rows", () => {
    const rows = buildIndexSource([mediaEntry("J.t", "Prose", "text")], user, () => false, () => "fa-unused");
    expect(rows[0].type).toBe("journal");
    expect(rows[0].icon).toBe("fas fa-book");
  });
  it("lets an MEJ type win over the native page type", () => {
    const rows = buildIndexSource([mediaEntry("J.x", "Person", "pdf")], user, () => "person", (t) => `fa-${t}`);
    expect(rows[0].type).toBe("person");
    expect(rows[0].icon).toBe("fa-person");
  });
});
```

Add `nativeRowType` to that file's existing import from `../scripts/logic/hub-index.mjs`.

In `test/sheet-registration.test.js` (read its existing cases and mirror their shape), add:

```js
  it("reports missing media sheet registrations", () => {
    const classes = { session: { a: {} }, "campaign-hub": { a: {} }, campaign: { a: {} } };
    expect(missingSheetRegistrations(classes, "session", "campaign-hub", "campaign", ["pdf", "video"]).media).toBe(true);
  });
  it("reports media registered only when EVERY media type has a class", () => {
    const partial = { session: { a: {} }, "campaign-hub": { a: {} }, campaign: { a: {} }, pdf: { a: {} } };
    expect(missingSheetRegistrations(partial, "session", "campaign-hub", "campaign", ["pdf", "video"]).media).toBe(true);
    const full = { ...partial, video: { a: {} } };
    expect(missingSheetRegistrations(full, "session", "campaign-hub", "campaign", ["pdf", "video"]).media).toBe(false);
  });
  it("treats an empty media list as nothing missing", () => {
    expect(missingSheetRegistrations({}, "s", "h", "c", []).media).toBe(false);
  });
```

Update that file's EXISTING `missingSheetRegistrations` calls to pass a 5th argument (`[]` where the case doesn't care) so they keep compiling — the existing assertions must not change.

(4 + 3 in hub-index + 3 in sheet-registration = 10 new tests. Updating the existing `missingSheetRegistrations` calls to pass a 5th argument adds no tests.)

- [ ] **Step 2: Run to verify they fail**

Run (worktree root): `npx vitest run test/hub-index.test.js test/sheet-registration.test.js`
Expected: FAIL — `nativeRowType` is not exported; `media` is undefined.

- [ ] **Step 3: Implement**

In `scripts/logic/hub-index.mjs`, above `buildIndexSource`:

```js
/**
 * Row type for an entry carrying no MEJ type, derived from its FIRST page's
 * native Foundry type (spec E §2). Single-page convention, the same one
 * graph-rows.mjs and the Hub's other consumers use. Anything not in the
 * table - text, or a type a future Foundry adds - stays "journal", so this
 * can only refine the untyped bucket, never break it.
 */
const NATIVE_ROW_TYPES = { pdf: "pdf", video: "video", image: "image" };

export function nativeRowType(entry) {
  const first = entry?.pages?.contents?.[0]?.type;
  return NATIVE_ROW_TYPES[first] ?? "journal";
}

/** Icon per synthetic row type (those MEJ's own getIcon map doesn't know). */
const SYNTHETIC_ICONS = {
  journal: "fas fa-book",
  pdf: "fas fa-file-pdf",
  video: "fas fa-film",
  image: "fas fa-image"
};
```

and replace `buildIndexSource`'s loop body type/icon lines with:

```js
    // Spec §2 (campaign-container): membership, not typing - an untyped
    // member still lists, now under a row type derived from its native page
    // type (spec E §2) instead of the generic "journal" bucket.
    const type = getMEJType(entry) || nativeRowType(entry);
    rows.push({
      uuid: entry.uuid, name: entry.name, type,
      icon: SYNTHETIC_ICONS[type] ?? getIcon(type)
    });
```

In `scripts/logic/sheet-registration.mjs`, change the signature and return:

```js
export function missingSheetRegistrations(sheetClasses, sessionType, hubType, campaignType, mediaTypes = []) {
  const has = (t) => Object.keys((sheetClasses ?? {})[t] ?? {}).length > 0;
  return {
    session: !has(sessionType),
    hub: !has(hubType),
    campaign: !has(campaignType),
    // Media covers TWO native types; report missing unless BOTH are registered,
    // so a partial repair still re-runs.
    media: (mediaTypes ?? []).some((t) => !has(t))
  };
}
```

and update its doc comment to describe the new parameter and key.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run` — Expected: 600 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/hub-index.mjs scripts/logic/sheet-registration.mjs test/hub-index.test.js test/sheet-registration.test.js
git commit -m "feat: derive pdf/video/image row types for untyped Hub members"
```

---

### Task 2: The media page sheet

**Files:**
- Create: `scripts/sheets/MediaPageSheet.mjs`
- Create: `templates/media-page.hbs`
- Modify: `scripts/constants.mjs` (`MEDIA_PAGE_TYPES`)
- Modify: `lang/en.json` (row-type labels + sheet strings)

**Interfaces:**
- Consumes: MEJ's `EnhancedJournalSheet` (imported from `/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js`, exactly as `scripts/sheets/SessionSheet.mjs` does — read that file's first 30 lines for the import path and the shell-listener convention comment); `MODULE_ID`, `I18N`.
- Produces: `export class MediaPageSheet extends EnhancedJournalSheet` with `static MEDIA_TYPES` and the `_toggleDisabled` no-op; `MEDIA_PAGE_TYPES = ["pdf", "video"]` from constants. Task 3 registers the class for those types.

- [ ] **Step 1: Constant + labels**

`scripts/constants.mjs`:

```js
/** Native Foundry JournalEntryPage types the companion mounts inside the MEJ shell (spec E §1). */
export const MEDIA_PAGE_TYPES = ["pdf", "video"];
```

`lang/en.json`, inside the `hub` block beside `journalType`:

```json
      "pdfType": "Document",
      "videoType": "Recording",
      "imageType": "Picture",
```

and a new sibling block at the top level of `MEJCampaignCompanion`:

```json
    "media": {
      "missingSrc": "This page has no file attached yet.",
      "openExternal": "Open in a new tab"
    },
```

- [ ] **Step 2: Template**

Create `templates/media-page.hbs`:

```handlebars
<div class="mej-cc-media-page flexcol">
    {{#if hasSrc}}
    {{#if isPdf}}
    <iframe class="mej-cc-media-pdf" src="{{viewerSrc}}" title="{{name}}"></iframe>
    {{else}}
    <video class="mej-cc-media-video" src="{{src}}" controls preload="metadata"
           {{#if loop}}loop{{/if}} {{#if autoplay}}autoplay{{/if}}></video>
    {{/if}}
    <a class="mej-cc-media-external" href="{{src}}" target="_blank" rel="noopener">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> {{localize "MEJCampaignCompanion.media.openExternal"}}
    </a>
    {{else}}
    <p class="notes">{{localize "MEJCampaignCompanion.media.missingSrc"}}</p>
    {{/if}}
</div>
```

- [ ] **Step 3: The sheet class**

Create `scripts/sheets/MediaPageSheet.mjs`:

```js
// MediaPageSheet - mounts Foundry's own pdf/video viewing surface inside the
// MEJ shell (spec E §1). Registered over the NATIVE page types (see
// integrations/mej-adapter.mjs); no MEJ flag type is minted and no existing
// page is converted, so disabling this module restores stock Foundry
// behavior for these pages exactly.
//
// MEJ's tabbed shell renders subsheets by calling _replaceHTML directly and
// then manually invoking activateListeners()/subRender() - it never calls
// _onRender() for a shell-hosted subsheet. Any listener beyond the native
// data-action bindings must attach from activateListeners(), never from an
// _onRender() override (the same note SessionSheet.mjs carries).
import { EnhancedJournalSheet } from "/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js";
import { MODULE_ID, I18N, MEDIA_PAGE_TYPES } from "../constants.mjs";

export class MediaPageSheet extends EnhancedJournalSheet {
  /** The native types this sheet serves. */
  static MEDIA_TYPES = MEDIA_PAGE_TYPES;

  static DEFAULT_OPTIONS = {
    classes: ["mej-campaign-companion", "mej-cc-media-sheet"],
    window: { icon: "fa-solid fa-file-pdf" }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/media-page.hbs` }
  };

  static get type() {
    return "mediapage";
  }

  /**
   * MEJ's shell calls subsheet._toggleDisabled(true) for any mount whose
   * document isn't owner-editable (enhanced-journal.js's renderSubSheet) -
   * correct for editable content sheets, wrong for a read-only VIEWER: it
   * would disable the video element's own controls and the external-open
   * link for every non-owner. This sheet has no editable inputs at all, so
   * there is nothing for the blanket disable to protect. Same override, same
   * reason, as CampaignHubPage's.
   */
  _toggleDisabled(_disabled) {}

  /**
   * The page's native type, tolerant of MEJ's fixType() normalization: a
   * mounted page's in-memory `.type` may be the bare key while `_source.type`
   * keeps the stored value. Checking both is the lesson from the campaign
   * portal round.
   */
  get mediaType() {
    const t = this.document?.type ?? "";
    const source = this.document?._source?.type ?? "";
    const bare = (v) => String(v).split(".").pop();
    return MediaPageSheet.MEDIA_TYPES.find((m) => bare(t) === m || bare(source) === m) ?? null;
  }

  async _prepareBodyContext(context, options) {
    context = await super._prepareBodyContext(context, options);
    const page = this.document;
    const src = page?.src ?? "";
    const kind = this.mediaType;
    context.name = page?.name ?? "";
    context.src = src;
    context.hasSrc = !!src;
    context.isPdf = kind === "pdf";
    // Foundry ships PDF.js and serves its viewer from a fixed path; pointing
    // the iframe at it (rather than at the raw file) is what core's own PDF
    // page sheet does, and gives paging/zoom/search for free.
    context.viewerSrc = kind === "pdf" && src
      ? `scripts/pdfjs/web/viewer.html?file=${encodeURIComponent(src)}`
      : "";
    context.loop = page?.video?.loop === true;
    context.autoplay = page?.video?.autoplay === true;
    return context;
  }
}
```

**Verify against the real Foundry v14 source before trusting two details here** (read-only, at `/Users/danbularzik/FoundryVTT-14/FoundryVTT-Node-14.365/client/applications/sheets/journal/`): (a) the PDF.js viewer path core actually uses — if it differs, use core's exact path and cite the file:line in your report; (b) where a video page stores `loop`/`autoplay` (`page.video.*` vs `page.system.*`) — match the real schema. Adjust the context keys accordingly; the template keys stay as written.

- [ ] **Step 4: Verify**

Run: `npx vitest run` — Expected: 600 passed (this task adds no unit tests; the suite must not regress).
Run: `node --input-type=module --check < scripts/sheets/MediaPageSheet.mjs && echo OK` — Expected: OK.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('ok')"` — Expected: ok.
Run: `grep -c "{{#if" templates/media-page.hbs && grep -c "{{/if}}" templates/media-page.hbs` — the counts must match.

- [ ] **Step 5: Commit**

```bash
git add scripts/sheets/MediaPageSheet.mjs templates/media-page.hbs scripts/constants.mjs lang/en.json
git commit -m "feat: MediaPageSheet - native pdf/video viewer inside MEJ chrome"
```

---

### Task 3: Registration, knowledge panel, Hub labels

**Files:**
- Modify: `scripts/integrations/mej-adapter.mjs` (register for both modes; extend `ensureSheetRegistrations`)
- Modify: `scripts/hooks/knowledge-ui.mjs` (widen `mejPageOf`)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`#typeLabel`, `#typeIcon` for the new synthetic types)

**Interfaces:**
- Consumes: Task 1's `missingSheetRegistrations(..., mediaTypes)`; Task 2's `MediaPageSheet` and `MEDIA_PAGE_TYPES`.
- Produces: pdf/video pages route to `MediaPageSheet` in both hosting modes; the knowledge panel injects for them; Hub rows show localized labels/icons. Task 4 asserts all three live.

- [ ] **Step 1: Register the sheet**

In `scripts/integrations/mej-adapter.mjs`, beside `registerHubSheetClass` (read how it and the campaign registration are written, and follow the same shape), add:

```js
/**
 * Route Foundry's native pdf/video pages to the companion's viewer sheet so
 * they open inside the MEJ shell (spec E §1). makeDefault claims them as the
 * default sheet; canConfigure stays true so a GM can opt an individual page
 * back to core's sheet. Registered in BOTH modes - the shell hosts it in api
 * mode, and it stands alone in native mode.
 */
export function registerMediaSheetClass(MediaPageSheet) {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, MediaPageSheet, {
    types: MEDIA_PAGE_TYPES,
    makeDefault: true,
    canBeDefault: true,
    canConfigure: true,
    label: `${I18N}.sheettype.media`
  });
}
```

Add `"media": "Media (Enhanced Journal)"` under `sheettype` in `lang/en.json`. Call `registerMediaSheetClass(MediaPageSheet)` wherever `registerHubSheetClass` is called (import `MediaPageSheet` the same deferred way the adapter imports other sheet classes — check whether the file's other sheet imports are static or dynamic and match; `MediaPageSheet` statically imports MEJ's `EnhancedJournalSheet`, so if the adapter defers those imports, defer this one too).

Extend `ensureSheetRegistrations` to pass `MEDIA_PAGE_TYPES` as the 5th argument to `missingSheetRegistrations` and repair `media` when missing, mirroring how it repairs `session`/`hub`/`campaign`.

- [ ] **Step 2: Widen the knowledge-panel gate**

`scripts/hooks/knowledge-ui.mjs`'s `mejPageOf` currently returns the page only when `mejType(doc)` is truthy, so a pdf/video page would get no tags/attributes/Mentioned-in panel. Replace it with:

```js
/** The page this sheet fronts, if the companion owns its presentation: an MEJ-typed page, or a native media page the companion mounts (spec E §1). */
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  if (mejType(doc)) return doc;
  const bare = String(doc.type ?? "").split(".").pop();
  return MEDIA_PAGE_TYPES.includes(bare) ? doc : null;
}
```

(import `MEDIA_PAGE_TYPES` from `../constants.mjs`.)

- [ ] **Step 3: Hub labels and icons**

In `scripts/apps/CampaignHubPage.mjs`, replace `#typeLabel` and `#typeIcon` with versions that know the synthetic types (keep their existing comments' intent):

```js
  #typeLabel(type) {
    const synthetic = {
      journal: `${I18N}.hub.journalType`,
      pdf: `${I18N}.hub.pdfType`,
      video: `${I18N}.hub.videoType`,
      image: `${I18N}.hub.imageType`
    };
    if (synthetic[type]) return game.i18n.localize(synthetic[type]);
    const labels = game.MonksEnhancedJournal.getTypeLabels();
    return labels[type] ? game.i18n.localize(labels[type]) : type;
  }

  #typeIcon(type) {
    // The synthetic row types (hub-index.mjs's nativeRowType) have no entry
    // in MEJ's own type-icon map, so getIcon() would render "fas undefined".
    const synthetic = {
      journal: "fas fa-book",
      pdf: "fas fa-file-pdf",
      video: "fas fa-film",
      image: "fas fa-image"
    };
    if (synthetic[type]) return synthetic[type];
    return `fas ${game.MonksEnhancedJournal.getIcon(type)}`;
  }
```

- [ ] **Step 4: Verify**

Run: `npx vitest run` — Expected: 600 passed.
Run: `node --input-type=module --check < scripts/integrations/mej-adapter.mjs && node --input-type=module --check < scripts/hooks/knowledge-ui.mjs && node --input-type=module --check < scripts/apps/CampaignHubPage.mjs && echo OK` — Expected: OK.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('ok')"` — Expected: ok.

- [ ] **Step 5: Commit**

```bash
git add scripts/integrations/mej-adapter.mjs scripts/hooks/knowledge-ui.mjs scripts/apps/CampaignHubPage.mjs lang/en.json
git commit -m "feat: route native pdf/video pages to the shell; knowledge panel and Hub rows"
```

---

### Task 4: E2E — live verification

**Files:**
- Create: `tests/e2e/17-media-routing.spec.mjs`
- Possibly modify: existing suites if any assertion counts index rows by type

**Interfaces:**
- Consumes: Tasks 1-3 live behavior. DOM: `.mej-cc-media-sheet` / `.mej-cc-media-page`, `iframe.mej-cc-media-pdf`, `video.mej-cc-media-video`, `.mej-cc-knowledge`, index rows `li.mej-cc-index-row` with their type icons, the doctype filter menu's chips.
- Produces: the live gate for this branch.

- [ ] **Step 1: Sweep**

Run `grep -n "journalType\|mej-cc-index-row\|doctype" tests/e2e/*.spec.mjs`. Any assertion that counts index rows of a given type, or that asserts an untyped media entry lists as "Journal", must be updated to the new row types — updated, not weakened. Report what you found; if nothing needs changing, say so explicitly.

- [ ] **Step 2: New spec `tests/e2e/17-media-routing.spec.mjs`**

Follow `14-campaigns.spec.mjs`'s imports and helpers (login, TT_PREFIX, settle, trackConsoleErrors, its hub-open/scope helpers, cleanup discipline: id-tracked deletes, scope + timeline selection reset, `autoCaptureCampaign` snapshot/restore, `cleanupTimelineJournal`). Write these as REAL tests — every assertion named below must exist in code:

```js
  test("1. a pdf page opens inside the MEJ shell, not a separate window", async ({ page }) => {
    // GM. Create a campaign (createCampaign API) and inside it a JournalEntry whose
    // single page is { type: "pdf", src: "systems/…/any-existing.pdf" } — use a file
    // that exists in this Foundry install, or an empty src and assert the
    // missing-src notice instead (the routing assertion is the point, not the file).
    // Open it: game.MonksEnhancedJournal.openJournalEntry(entry).
    // Assert: the MEJ shell (#MonksEnhancedJournal) contains .mej-cc-media-page,
    //         no standalone .journal-entry-page window opened outside the shell,
    //         and (with a src) iframe.mej-cc-media-pdf is present.
  });

  test("2. a video page mounts the native video element with working controls", async ({ page }) => {
    // Same shape with { type: "video", src: <existing video or empty> }.
    // Assert video.mej-cc-media-video exists inside the shell and has the `controls`
    // attribute; assert it is NOT disabled (the _toggleDisabled regression).
  });

  test("3. the knowledge panel injects for media pages", async ({ page }) => {
    // With the pdf page open, assert .mej-cc-knowledge is present in the shell.
  });

  test("4. media entries get their own Hub index rows and filter chips", async ({ page }) => {
    // Scope the Hub to the campaign, Index tab.
    // Assert the pdf entry's row shows the fa-file-pdf icon and the video entry's
    // shows fa-film (query the row's <i> class), and that neither shows fa-book.
    // Open the doctype filter menu: assert chips for the Document and Recording
    // labels exist; uncheck Document and assert the pdf row disappears while the
    // video row remains.
  });

  test("5. player seat: observer can view a media page, sees no GM chrome", async ({ browser }) => {
    // GM pre-creates the campaign + a pdf page at the OBSERVER baseline.
    // Player context (User 1) opens the entry: .mej-cc-media-page present,
    // the viewer/external-open link NOT disabled, and .mej-cc-edit-campaign count 0.
  });
```

- [ ] **Step 3: Run**

```bash
npx playwright test tests/e2e/17-media-routing.spec.mjs --trace off --reporter=line
```
Green twice consecutively. Then the regression set:
```bash
npx playwright test tests/e2e/02-hub-timeline.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/16-multi-timeline.spec.mjs --trace off --reporter=line
```
All passing. A failure that is a product bug (page still opens outside the shell, panel missing, controls disabled) → stop, commit nothing for that portion, report BLOCKED with DOM/console evidence and your diagnosis; do not weaken assertions.

- [ ] **Step 4: Confirm the environment**

Run: `readlink ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion` — Expected: the MAIN checkout path. Confirm no leftover TT- fixtures remain in World A.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/
git commit -m "test: e2e for pdf/video shell routing, knowledge panel, and media index rows"
```
