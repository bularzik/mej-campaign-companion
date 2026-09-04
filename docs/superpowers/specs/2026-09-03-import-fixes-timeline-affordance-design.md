# Import fixes + timeline journal affordance — design (0.16.0)

Date: 2026-09-03. Base: `main` @ f7cc911 (0.15.0). Branch: `feat/import-fixes`.

## Problem

Three defects reported against the docx import wizard and its output, all
reproduced by reading the code and (for #2) running the vendored mammoth on
`examples/Radiant Citadel.docx`:

1. **Two nested folders.** With **Import into = New Campaign…** and the
   default-checked *Create a subfolder named after the document*, the wizard
   creates the campaign folder (named after the document) and then a second,
   identically named folder inside it (`scripts/apps/import-wizard.mjs`
   `#onCreate`, the `dest.subfolder` branch). The subfolder option only makes
   sense when importing into an existing campaign.
2. **Images dropped.** `splitSections` (`scripts/logic/doc-import.mjs`) keeps a
   top-level element only if its `textContent` is not whitespace-only, or it is
   a `TABLE`. Mammoth emits every standalone picture as `<p><img
   src="data:…"></p>` — empty text — so those paragraphs are discarded before
   the upload pass ever runs. Radiant Citadel: 27 images, 17 in picture-only
   paragraphs (lost), 10 inside text paragraphs (kept).
3. **"<campaign> — Timeline" opens a generic editor.** The campaign portal
   ("Radiant Citadel", flag icon) is the Hub; the timeline journal
   ("Radiant Citadel — Timeline", generic icon) is a page-less data journal
   holding the timepoints. Opening it from the sidebar shows an empty
   JournalEntry sheet with no hint of what it is or where the timeline lives.

## Goals

- G1. Importing into a new campaign never creates a redundant subfolder; the
  subfolder option is visibly inapplicable while "New Campaign…" is selected.
- G2. Picture-only paragraphs survive section splitting and reach the existing
  inline-image upload path unchanged.
- G3. Opening a timeline journal — sidebar click, `@UUID` link,
  `entry.sheet.render()` — opens the Campaign Hub on its **Timeline** tab with
  that timeline selected, in both `api` and `native` modes, for GMs and for
  players who can see the journal. No generic editor is ever shown for it.
- G4. Timeline journals carry a distinct icon (`fa-timeline`) in the journal
  sidebar, on both Foundry's directory and MEJ's shell sidebar.

## Non-goals

- Changing how timelines are stored, named or defaulted (spec D stays).
- Hiding timeline journals from the sidebar (rename/delete stay available).
- Any change to MEJ itself (companion-only, as always).
- Re-importing images for documents imported before this fix.

## Design

### A. Subfolder only for existing campaigns

`scripts/logic/campaigns.mjs` gains one pure helper:

```js
/** The import wizard's subfolder option applies only when filing into an existing folder. */
export function subfolderApplies(destinationId) {
  return destinationId !== "__new";
}
```

`scripts/apps/import-wizard.mjs`:

- `#onCreate`: the subfolder branch becomes
  `if (dest.subfolder && chosen)` — `chosen` is the resolved existing folder
  (null on the `__new` path and on the stale-pick degrade path, where the
  campaign is freshly created and already named after the document). The
  comment above `target.disabled = true` is updated to match.
- `_onRender`: after wiring the change listeners, a local
  `syncSubfolder()` sets `form.elements.subfolder.disabled =
  !subfolderApplies(form.elements.destination.value)` and runs once
  immediately and on every destination `change`. The checkbox's `checked`
  state is left alone (so the GM's choice survives switching back to an
  existing campaign); a disabled checkbox is not submitted, and `#onCreate`
  ignores it anyway via `chosen`.
- `templates/import-wizard.hbs`: no change needed — the disabled state is set
  in `_onRender` because the destination default is resolved there too.

Docs: GM guide, Word import step 3, second bullet becomes
"**Create a subfolder named after the document**, checked by default; only
applies when importing into an existing campaign (greyed out for **New
Campaign…**, whose folder is already named after the document)."

### B. Keep picture-only paragraphs

`scripts/logic/doc-import.mjs` `splitSections`:

```js
const MEDIA_SELECTOR = "img, video, audio";
const keepsMedia = (el) => el.tagName === "TABLE" || !!el.querySelector(MEDIA_SELECTOR);
const nodes = [...root.children].filter((el) => !isWhitespaceOnly(el) || keepsMedia(el));
```

Nothing downstream changes: `measureBlocks` word counts ignore the tag,
`uploadInlineImages` already dedupes/uploads/rewrites `src`, and a section
that is *only* pictures gets a title from the heading above it as today.

### C. Timeline journal opens the Hub's timeline pane

**Redirect sheet.** New `scripts/sheets/TimelineJournalSheet.mjs`:

```js
const { ApplicationV2 } = foundry.applications.api;
export class TimelineJournalSheet extends ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "mej-cc-timeline-redirect-{id}", window: { frame: false } };
  constructor(options = {}) { super(options); this.document = options.document; }
  /** Never draws: hands off to the Hub and reports itself as not rendered. */
  async render() { await openTimelineInHub(this.document); return this; }
  async close() { return this; }
}
```

`document` is the JournalEntry Foundry passes when it constructs the sheet
from `flags.core.sheetClass`. `rendered` stays false, so Foundry's sidebar
and link handlers treat every open as a fresh one.

**Registration** (`scripts/integrations/mej-adapter.mjs` `registerCore()`,
which runs in both modes):

```js
foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, TimelineJournalSheet, {
  types: ["base"], makeDefault: false, label: `${I18N}.sheettype.timelineJournal`
});
```

New constant `TIMELINE_SHEET_CLASS = "mej-campaign-companion.TimelineJournalSheet"`
(`scripts/constants.mjs`). Registered but never default, so it only applies to
documents that carry the flag. It will appear in Foundry's *Configure Sheet*
menu under its label; that is acceptable.

**Stamping.** `scripts/data/timeline-journal.mjs`: both creation paths
(`createTimeline` and the legacy root-singleton branch of
`ensureTimelineJournal`) add `flags.core.sheetClass: TIMELINE_SHEET_CLASS`
alongside the existing `flags[MODULE_ID].timeline`.

**Migration.** `CURRENT_DATA_VERSION` 4 → 5. In the existing active-GM
migration block (`scripts/campaign-companion.mjs`, `ready`), a v5 step
updates every `game.journal` entry where `isTimelineJournal(entry)` and
`entry.getFlag("core", "sheetClass") !== TIMELINE_SHEET_CLASS`, one
`entry.update({ "flags.core.sheetClass": TIMELINE_SHEET_CLASS })` each,
per-entry failures logged and skipped like the v3 step. Idempotent: a
world already at v5 has nothing to update.

**MEJ fall-through.** `scripts/hooks/timeline-open.mjs` registers at `init`:

```js
Hooks.on("openJournalEntry", (doc) => (isTimelineJournal(doc) ? false : undefined));
```

MEJ's `openJournalEntry` (`monks-enhanced-journal.js` ~2527) treats `false`
as "don't open in the shell" and its callers fall back to
`entry.sheet.render(true, options)` (~580), which is the redirect sheet. This
runs whenever MEJ is active — `api` mode and `native` mode on a MEJ build that
lacks the extension API alike — so every entry point converges on C's sheet.

**Hub hand-off.** `scripts/apps/CampaignHubPage.mjs`, next to
`showGraphFor`:

```js
/** Sidebar/link entry point: open the Hub on the Timeline tab showing `journal`. */
export async function openTimelineInHub(journal) {
  if (!journal || !isTimelineJournal(journal)) return;
  const cid = campaignIdOf(journal);
  if (cid) {
    HUB_STATE.campaignId = cid;
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, cid);
  }
  await game.settings.set(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING, journal.id);
  HUB_STATE.pendingTimelineId = journal.id;
  HUB_STATE.pendingTab = "timeline";
  const { openHub } = await import("../integrations/mej-adapter.mjs");
  await openHub();
}
```

`HUB_STATE` gains `pendingTimelineId: null`. `#timelineSelection()` consumes
it first: if set, `this.state.timelineId = HUB_STATE.pendingTimelineId;
HUB_STATE.pendingTimelineId = null;` before the existing lazy-seed/validation
logic — so an already-open Hub instance (whose `state.timelineId` was seeded
earlier) switches too. `openHubWindow` already re-renders `main` on an open
window for `pendingTab`; MEJ's `openShellPage` re-renders the shell page.
A world timeline (no campaign) leaves the scope untouched; the pane shows it
because the selection setting names it explicitly.

Players: `isVisibleToUser` gating inside `#timelineSelection` already resets
an invisible selection, and a player cannot open a journal they cannot see,
so no extra check is needed.

### D. Distinct sidebar icon

New `scripts/hooks/timeline-directory.mjs`, registered at `init` (after
MEJ's module-level `renderJournalDirectory` hook, since module scripts
evaluate before any `init` fires):

```js
export function decorateTimelineRows(root) {
  for (const li of root.querySelectorAll("li.directory-item.journalentry[data-entry-id]")) {
    const entry = game.journal.get(li.dataset.entryId);
    if (!entry || !isTimelineJournal(entry)) continue;
    const icon = li.querySelector(".entry-name .journal-type") ?? li.querySelector(".entry-name i");
    if (icon) icon.className = "journal-type fas fa-fw fa-timeline";
  }
}
Hooks.on("renderJournalDirectory", (app, html) => decorateTimelineRows(html instanceof HTMLElement ? html : html[0]));
```

MEJ gives page-less entries `fa-book` via `.journal-type`; the swap targets
that element. MEJ's shell sidebar is decorated by the same
`renderJournalDirectory` pass on our 14.07 build (verify live during
implementation); if a build renders the shell sidebar separately, the same
function is also attached to `renderEnhancedJournal`.

### E. Versioning, docs, changelog

- `module.json` 0.15.0 → 0.16.0 (a data migration ships; not a patch).
- `lang/en.json`: `sheettype.timelineJournal` = "Campaign Timeline (opens the
  Hub)".
- GM guide §Timelines (the paragraph naming `<campaign name> — Timeline`)
  adds: "A timeline journal has no pages of its own; opening it from the
  journal sidebar opens the Hub on the Timeline tab showing that timeline,
  and it carries a timeline icon there so it's easy to tell apart from the
  campaign's portal entry."
- CHANGELOG 0.16.0 entry covering A–D and the v5 migration.

## Testing

Unit (vitest, `test/`):
- `doc-import.test.js`: `splitSections` keeps `<p><img src="data:image/png;base64,AA=="></p>`
  as a block of its section; a whitespace-only `<p>` is still dropped.
- `campaigns.test.js`: `subfolderApplies("__new")` false, folder id true.
- `hub-timeline`/`timelines` tests unchanged; no new pure logic there.

E2E (`tests/e2e/`, existing harness, `--trace off`):
- `05-docx-import.spec.mjs`: new campaign import → **no** subfolder under the
  campaign folder (entries sit directly in it); at least one created page's
  `text.content` contains `<img src="worlds/`; the subfolder checkbox is
  `disabled` while "New Campaign…" is selected and enabled after picking an
  existing campaign.
- New `20-timeline-journal-open.spec.mjs`: create a TT- campaign + timeline;
  as GM, click the timeline journal in the sidebar → the Hub is open on the
  `timeline` tab with the picker showing that timeline id and **no**
  JournalEntry sheet window for it; the sidebar row's `.journal-type` has
  `fa-timeline`; `fromUuid(uuid).sheet.render(true)` behaves the same; a
  player with observer access on the journal gets the Hub too. Runs in api
  mode and with `forceNativeMode` (same pattern as `12-native-mode.spec.mjs`).
- `19-reveal-migration.spec.mjs` pattern reused for a v4→v5 check: a timeline
  journal lacking the flag is stamped after a GM reload.
- Full unit + e2e runs, `check:links`, `check:vendor` before finishing.

## Files

Modify: `scripts/apps/import-wizard.mjs`, `scripts/logic/campaigns.mjs`,
`scripts/logic/doc-import.mjs`, `scripts/data/timeline-journal.mjs`,
`scripts/apps/CampaignHubPage.mjs`, `scripts/integrations/mej-adapter.mjs`,
`scripts/campaign-companion.mjs`, `scripts/constants.mjs`, `lang/en.json`,
`module.json`, `CHANGELOG.md`, `docs/gm-guide.md`,
`test/doc-import.test.js`, `test/campaigns.test.js`,
`tests/e2e/05-docx-import.spec.mjs`.
Create: `scripts/sheets/TimelineJournalSheet.mjs`,
`scripts/hooks/timeline-open.mjs`, `scripts/hooks/timeline-directory.mjs`,
`tests/e2e/20-timeline-journal-open.spec.mjs`.

## Deviations

- Redirect sheet extends `foundry.applications.api.DocumentSheetV2`, not
  `ApplicationV2` (v14's `DocumentSheetConfig.registerSheet` throws for a
  non-DocumentSheetV2 class); no custom constructor (the base class owns the
  read-only `document` getter); `canBeDefault: false` added to the
  registration.
- Registration is repaired at `ready` through the existing
  `ensureSheetRegistrations()` path (new pure helper
  `missingOwnRegistration()` in `scripts/logic/sheet-registration.mjs`,
  unit-tested) because Foundry's one-time pre-ready `registerSheet` drain
  dropped it; registration stays in `registerCore()` so absent mode remains
  inert.
- E2E hub root selector is `.mej-cc-hub-container` (`.mej-cc-hub` is the
  flattened root PART and never reaches the DOM).
- Nine e2e specs' MEJ-shell bootstrap (`game.journal.contents[0]`) now skips
  timeline journals, since the `openJournalEntry` hook refuses them.
- The 05 e2e image assertion checks both `text.content` and `system.recap`
  (session pages store their html in `system.recap`).
- Task 3's `openTimelineInHub` also guards `!journal`.
- The directory hook matches bare `[data-entry-id]` rows (MEJ's shell sidebar
  and the core sidebar differ in their `li` classes); the `isTimelineJournal`
  guard keeps it safe.
