# Carried items — root-cause investigation

Read-only pass over `mej-campaign-companion` @ `59c5e0b` (v0.13.5), with
`monks-enhanced-journal` (branch `integration-14.07`) and FoundryVTT
14.365's `client/` read as references. Nothing was edited; no Playwright
was run. `npm test` was not needed for any finding below.

Path conventions in this file:

- `CC/…` = `/Users/danbularzik/Claude/Projects/mej-campaign-companion/…`
- `MEJ/…` = `/Users/danbularzik/Claude/Projects/monks-enhanced-journal/…`
- `FV/…`  = `/Users/danbularzik/FoundryVTT-14/FoundryVTT-Node-14.365/…`

Confidence is stated per item. Where a claim rests on a screenshot or an
archived report rather than on code I read, that is said explicitly.

---

## 1. `.mej-cc-timeline-controls` has no CSS rule

**(a) Where**

- Markup: `CC/templates/hub.hbs:94-111` — `<div class="mej-cc-timeline-controls">`
  wrapping `select.mej-cc-timeline-select` (`:95`), `button.mej-cc-timeline-default`
  (`:102`), `button.mej-cc-timeline-rename` (`:106`), `button.mej-cc-timeline-delete`
  (`:108`).
- Missing rule: `CC/styles/campaign-companion.css` — the only `timeline`
  selectors in the whole file are `.mej-cc-timeline` (`:212`),
  `.mej-cc-order-menu` (`:216`), `.mej-cc-timeline-list` (`:228`).
  `grep -n "timeline-controls" styles/campaign-companion.css` → no hits.

**(b) Root cause**

`.mej-cc-timeline-controls` is a plain `<div>` and the stylesheet declares
nothing for it, so it stays `display: block`. Its children are a `<select>`
(block-level default width `auto`, but stretched because its parent
`.mej-cc-timeline` is `flexcol` — the controls div fills the pane width) and
three `<button>`s. Block layout puts each on its own line. Every sibling
control row in the same file *does* have a rule and they all look the same:
`.mej-cc-index-controls` (`:90-96`: `display:flex; align-items:center;
gap:0.5em; position:relative; flex:0 0 auto`), `.mej-cc-graph-controls`
(`:765`), `.mej-cc-secrets-controls` (`:874-880`), `.mej-cc-order-menu`
(`:216-220`). The timeline row is simply the one that was never given one —
consistent with it being the newest of the group (multi-timeline, 0.11/0.12).
The symptom is visible in `CC/docs/images/timeline-selector.png` and is
recorded as product bug 1 in the archived task-5 report.

**(c) Smallest correct fix**

One rule in `CC/styles/campaign-companion.css`, modelled on
`.mej-cc-index-controls`:

```css
.mej-cc-timeline-controls {
  display: flex;
  align-items: center;
  gap: 0.5em;
  flex: 0 0 auto;
}
.mej-cc-timeline-controls .mej-cc-timeline-select { flex: 1 1 auto; min-width: 0; }
.mej-cc-timeline-controls button { flex: 0 0 auto; }
```

Files touched: `CC/styles/campaign-companion.css` only.

**(d) Test seam**

No vitest seam exists (this is CSS). Existing e2e seam:
`CC/tests/e2e/16-multi-timeline.spec.mjs` — it already drives the picker,
`makeTimelineDefault`, rename and delete. Add a layout assertion there:
read `boundingBox()` for `.mej-cc-timeline-select` and
`button.mej-cc-timeline-rename` and assert their `y` centres are within a
few px of each other (i.e. same row), which fails today and passes after.
`CC/tests/e2e/guide-screenshots.spec.mjs` already clips exactly this row
(`shotAround` on `.mej-cc-timeline-controls`, `x=0,y=0,w=1007,h=120`), so
the shipped PNG must be re-captured with the fix — its committed crop was
sized around the *broken* stacked layout.

**(e) Risk / coupling**

Very low. The class is companion-only and appears nowhere in MEJ. The one
coupling is the guide screenshot above: the crop rectangle recorded in the
round-5 fix report (`h=120`) is derived from the stacked layout and will be
too tall once the row collapses to one line.

---

## 2. Prep-board attendees render with no names

**(a) Where**

- `CC/templates/prep-board.hbs:6-9`:
  ```hbs
  {{#each attendees}}<li data-tooltip="{{this.name}}"><img src="{{this.img}}" alt="{{this.name}}"></li>
  ```
- `CC/scripts/apps/prep-board-app.mjs:83-87` (`_prepareContext`) — builds
  `{ uuid, name, img }` per attendee, so the name *is* in the context.
- `CC/styles/campaign-companion.css:972-976` — the only prep-attendee rule is
  `.mej-cc-prep-attendees img { width:36px; height:36px; border-radius:4px }`.

**(b) Root cause**

Purely a template omission, not a data problem. `_prepareContext` resolves
each attendee UUID to `{ uuid, name: actor?.name ?? uuid, img: actor?.img ??
"icons/svg/mystery-man.svg" }` — the name is always present. The template
renders the name only into `data-tooltip` and `alt`, never as a text node, so
the board shows an unlabeled row of 36×36 portraits. Contrast the Session
sheet, which renders the same data with a visible label:
`CC/templates/session.hbs` attendee row = `<img class="item-image">` +
`<div class="item-name">{{attendee.name}}</div>`. The `<ul class="flexrow">`
compounds it: a horizontal strip of images with no captions. The archived
task-5 report notes the same defect is present in the previously committed
`prep-board.png`, i.e. it is pre-existing, not a 0.13.x regression.

**(c) Smallest correct fix**

Render the name. In `CC/templates/prep-board.hbs`:

```hbs
{{#each attendees}}
<li data-tooltip="{{this.name}}">
  <img src="{{this.img}}" alt="{{this.name}}">
  <span class="mej-cc-prep-attendee-name">{{this.name}}</span>
</li>
{{else}}…
```

plus a small CSS block in `CC/styles/campaign-companion.css` next to the
existing `.mej-cc-prep-attendees img` rule so each `<li>` is a centred
column and the strip wraps:

```css
.mej-cc-prep-attendees ul { flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
.mej-cc-prep-attendees li { display: flex; flex-direction: column; align-items: center; width: 56px; }
.mej-cc-prep-attendee-name { font-size: var(--font-size-11, 11px); text-align: center; overflow-wrap: anywhere; }
```

Files touched: `CC/templates/prep-board.hbs`, `CC/styles/campaign-companion.css`.

**(d) Test seam**

Needs new. `_prepareContext` is a method on an `ApplicationV2` subclass and
imports Foundry globals, so it is not vitest-loadable as-is. Two options,
cheapest first:

1. e2e in `CC/tests/e2e/01-session.spec.mjs` (it already creates sessions
   with attendees) or `CC/tests/e2e/06-player-collab.spec.mjs`: open the prep
   board via `button[data-action="openPrepBoard"]` and assert
   `.mej-cc-prep-attendees li` `toContainText(<actor name>)`. There is no
   prep-board e2e spec today — this would be the first.
2. If a unit seam is wanted, extract the attendee-row shaping into a pure
   `buildAttendeeRows(resolved)` in a new `CC/scripts/logic/prep-board-rows.mjs`
   with `test/prep-board-rows.test.js` — but the defect is in the template, so
   a unit test would not have caught it. Prefer (1).

**(e) Risk / coupling**

Low. `.mej-cc-prep-attendees` is companion-only. The one coupling is
`CC/docs/images/prep-board.png`, a committed guide screenshot captured by
`CC/tests/e2e/guide-screenshots.spec.mjs`; it must be re-captured, and
`npm run check:links` re-run if the guide text describes the strip.

---

## 3. GM's "Player Recaps" block reads empty

**(a) Where**

- `CC/templates/session.hbs:23-47` — the `.player-recaps-section` block:
  `<h3>` → `div.flexcol.editor-parent.player-recap-self` → `ol.other-recaps-list.item-list`
  containing `li.other-recap` with `.recap-author` and `.recap-content`.
- `CC/scripts/sheets/SessionSheet.mjs:186-205` — `context.otherRecaps`.
- `CC/scripts/logic/player-recap.mjs:34-43` — `buildRecapEntries`.
- The rule that actually breaks it: `MEJ/css/monks-journal-sheet.css:606-610`
  ```css
  .monks-journal-sheet.sheet .editor-parent { flex: 1; height: 100%; overflow: hidden; }
  ```
  and `:612-619` `.editor.editor-display { min-height:100%; height:100%; overflow-y:auto }`.

**(b) Root cause — companion-side CSS, *not* an MEJ data bug**

I desk-checked the data path and it is correct. `buildRecapEntries` keeps an
entry when `userId === currentUserId || text.trim()`
(`player-recap.mjs:36`), so a GM viewing a page whose flag holds
`{ <user1Id>: "<p>…</p>" }` gets two entries and exactly one non-self entry;
`SessionSheet.mjs:197-204` maps that into `context.otherRecaps`. The context
survives MEJ's part-context plumbing: `MEJ/sheets/EnhancedJournalSheet.js:236-245`
calls `await this._prepareBodyContext(context, options)` and *discards* the
return, but MEJ's own `_prepareBodyContext` (`:248-249`) uses
`foundry.utils.mergeObject(context, {...})` with the default `inplace:true`,
so the companion's mutations land on the same object. Flag persistence is
also fine: Foundry merges nested flag updates rather than replacing them
(`FV/common/data/fields.mjs:1937-1966`, `ObjectField._updateDiff` →
`mergeObject(state.source[key], diff)`), so a GM form resubmit writing
`playerRecaps.<gmId>` cannot wipe `playerRecaps.<user1Id>`.
`CC/tests/e2e/06-player-collab.spec.mjs:125` proves the `<li class="other-recap">`
reaches the DOM for a *second player*, via `toHaveCount(1)` with `hasText`.

What is wrong is layout. `.player-recaps-section` is a plain block that is a
flex item of `.tab-inner.flexcol`, so the flex algorithm gives it a
**definite** main size; a definite flex-item height makes `height: 100%` on
its children resolvable. Its first child, `.player-recap-self`, carries MEJ's
`.editor-parent { height: 100%; overflow: hidden }` — so the (for a GM,
empty) self-recap editor claims the whole section height and pushes
`ol.other-recaps-list` past the bottom of the section, where
`.monks-journal-sheet .journal-subsheet { overflow: hidden }`
(`MEJ/css/monks-journal-sheet.css:5-9`) and
`.sheet-body { overflow: hidden }` (`:331-336`) clip it.

Screenshot evidence, read directly:
`CC/docs/images/session-sheet-gm.png` — "Player Recaps" heading, then the
self-recap pencil at y≈557, then ~90 px of empty band, then the Knowledge
panel; no `.recap-author` text ("User 1") anywhere.
`CC/docs/images/session-sheet-player.png` — the same page as User 1 shows
"Boot prints led away…" — but that is User 1's *own* recap in the
`player-recap-self` slot, not an `.other-recap` row, so it does not
contradict the above.

The companion's own stylesheet already anticipated this: the comment at
`CC/styles/campaign-companion.css:14` reads "session.hbs and other-recap
items also assume flex sizing similar to MEJ's editor-parent — no functional
CSS besides `position` is changed."

This is the same root-cause family as item 13 (MEJ's `.editor-parent`/
`.editor-display` `height:100%` chain resolving against containers the
companion's templates give it), and it is aggravated by item 12: MEJ's shared
detailed header eats ~250 px, leaving roughly 180 px of description-tab body
(a fact the harness itself records at
`CC/tests/e2e/guide-screenshots.spec.mjs:820-827`), so there is very little
room to absorb the mis-sizing.

Confidence: high on the mechanism (every CSS rule and the DOM structure were
read); the one thing not directly verified is a live `getBoundingClientRect`
on `ol.other-recaps-list` — that requires Playwright, which was out of scope.
The verification step in (d) is written to settle it in one run.

**(c) Smallest correct fix**

Companion-side CSS scoped to the Session sheet, in
`CC/styles/campaign-companion.css` beside the existing `.session-container`
rules:

```css
/* MEJ's .editor-parent is `flex:1; height:100%` — correct when it is the only
   editor in a tab. The Session description tab has two, plus a sibling list,
   so pin the recaps block to content size and let the list scroll. */
.session-container .player-recaps-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.session-container .player-recap-self.editor-parent {
  flex: 0 0 auto;
  height: auto;
  min-height: 4.5em;
}
.session-container .player-recap-self .editor.editor-display {
  height: auto;
  min-height: 4.5em;
}
.session-container .other-recaps-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
}
```

Files touched: `CC/styles/campaign-companion.css` only. No template or script
change is needed, and no MEJ change is needed. Fixing item 12 as well
(reclaiming ~250 px) makes the result comfortable rather than merely correct.

**(d) Test seam**

`CC/tests/e2e/06-player-collab.spec.mjs` — the existing recap test already has
a live GM page (`gmPage`) and asserts the flag persisted at `:113-118`. Add,
right after that: open the session on `gmPage` and assert the row is *laid
out*, not merely present —

```js
const other = gmShell.locator('.other-recap');
await expect(other).toHaveCount(1);
await expect(other).toBeVisible();
expect((await other.boundingBox()).height).toBeGreaterThan(0);
```

That is exactly the assertion the current `toHaveCount(1)` at `:125` is too
weak to make, and it fails today under the diagnosis above.

**(e) Risk / coupling**

Medium-low. The rules are scoped to `.session-container`, which only the
companion's `session.hbs` emits, so no other MEJ sheet is touched. The
coupling to watch is `CC/styles/campaign-companion.css:1-17`'s existing
`.session-container .editor-parent { position: relative }` rule — the new
`flex/height` overrides must not disturb the absolute positioning of the two
`.editor-edit` pencils that rule exists to separate (there is an e2e check
for their non-overlap; re-run it). Two committed guide screenshots
(`session-sheet-gm.png`, `session-sheet-player.png`) change and must be
re-captured.

---

## 4. Search snippets show raw `@UUID[…]{…}` enricher markup

**(a) Where**

- `CC/scripts/logic/search-index.mjs:2-4` — `stripHtml()`:
  ```js
  export function stripHtml(html) { return String(html ?? "").replace(/<[^>]*>/g, " "); }
  ```
- `CC/scripts/logic/search-index.mjs:40` — the only normalization applied to
  a field before it is stored: `const text = stripHtml(raw).replace(/\s+/g," ").trim();`
- `CC/scripts/logic/search-index.mjs:70-92` — `snippetFor()` slices
  `rec.texts[f]` verbatim.
- `CC/scripts/logic/search-index.mjs:129` — `matches.push({ field: label,
  snippet: snippetFor(rec.texts[f], terms) })`.

**(b) Root cause**

Foundry's enricher syntax is **plain text**, not markup: a content link is
stored in the page body as `@UUID[JournalEntry.rMYO0mN9F6sSvpxN]{The Missing
Caravan}` and is only turned into an `<a>` at render time by
`TextEditor.enrichHTML` (`FV/client/applications/ux/text-editor.mjs:122-163`).
The index deliberately stores the *raw* body (so the module never has to run
async enrichment to index), and `stripHtml`'s regex only removes `<…>` — it
cannot see `@UUID[…]{…}`. So the raw token survives into `texts[field]`, gets
tokenized (the document id becomes searchable garbage tokens), and
`snippetFor`'s ±40-character window slices through the middle of it. That is
exactly the `…rnalEntry.rMYO0mN9F6sSvpxN]{The Missing Caravan}` string
recorded in `hub-search.png` (archived task-5 report, product bug 4).

**(c) Smallest correct fix**

One pure helper in `CC/scripts/logic/search-index.mjs`, applied at line 40
*before* `stripHtml`, so both the snippet and the token set improve together:

```js
/** Enricher markup is plain text in the stored body: keep the label, drop the ref. */
export function stripEnrichers(text) {
  return String(text ?? "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")   // @UUID[ref]{Label} -> Label
    .replace(/@\w+\[([^\]]*)\]/g, (_, ref) => ref.split(".").pop()); // @UUID[ref] -> tail
}
```

and at `:40`: `const text = stripHtml(stripEnrichers(raw)).replace(/\s+/g," ").trim();`

Files touched: `CC/scripts/logic/search-index.mjs` only. Note this is a
*behavioural* improvement to tokenization as well (document ids stop being
indexed as search terms), which is desirable but should be called out in the
changelog.

**(d) Test seam**

`CC/test/search-index.test.js` — exists, already unit-tests `stripHtml`,
`indexRecord` and `search`. Add cases: a record whose field is
`"met @UUID[JournalEntry.abc123]{Mira Thornwood} at the docks"` must produce
a snippet containing `Mira Thornwood` and *not* containing `@UUID` or
`abc123`, and must not be findable by searching `abc123`.
`CC/test/query-grammar.test.js` covers the `runQuery` path over the same index
if a second assertion is wanted there.

**(e) Risk / coupling**

Low-medium. `indexRecord` feeds the Hub Search tab, the Dashboards
(`runQuery`), the `@CampaignQuery` enricher and the graph's backlink
counts — all read `records`/`tokens`, none read `texts` except
`snippetFor`. The one real behaviour change is that a saved dashboard query
whose free text happened to match a raw uuid will stop matching; that is a
fix, but worth a changelog line. Also confirm the backlink index
(`CC/scripts/search/live-index.mjs`, `outboundRefsForEntry`) parses `@UUID`
from its *own* source and does not consume `texts` — it does not, but it must
not be switched to.

---

## 5. Natively-revealed ("Everyone") secret shows core's Hide toggle to a player

**(a) Where**

- Injector: `FV/client/applications/elements/secret-block.mjs:60-62`
  (`connectedCallback() { if (!this.#button) this.#addRevealButton(); }`) and
  `:82-89` (`#addRevealButton` — `button.hidden = !this.#revealable`, label
  `EDITOR.Hide` when the section carries `revealed`).
- The only gate: `#revealable = true` by default (`:56`); the sole writer is
  `FV/client/applications/api/document-sheet.mjs:230-231`
  (`_toggleDisabled(disabled) { …querySelectorAll("secret-block").forEach(b => b.revealable = !disabled) }`),
  invoked from `:269-272` (`_onRender` → `if (!this.isEditable) this._toggleDisabled(true)`).
- MEJ's shell re-invokes it by hand: `MEJ/apps/enhanced-journal.js:640-642`
  `if (!this.isEditable) { subsheet._toggleDisabled.call(subsheet, true); }`,
  where `this.isEditable` is the **shell's** (`MEJ/apps/enhanced-journal.js:340-357`
  → `!!this.options["editable"] && document.isOwner`, resolved against the
  parent `JournalEntry`).
- MEJ CSS backstop: `MEJ/css/monks-journal-sheet.css:338-340`
  `.monks-journal-sheet.sheet .journal-subsheet:not([editable="true"]) section.secret button.reveal { display:none }`
  and `:20-22` `.monks-journal-sheet.sheet.standard-form .not-owner button.reveal { display:none }`.
- Companion side: `CC/scripts/hooks/secrets-ui.mjs` — `injectPlayerSecrets()`
  (the `mine.length` early return, the `DOMParser` parse, and
  `container.replaceChildren(...root.childNodes)` at the end).

**(b) Root cause**

Core adds the toggle unconditionally on element upgrade — there is **no
permission check at all** inside `HTMLSecretBlockElement`. The only
suppression in the platform is `DocumentSheetV2._toggleDisabled(true)`,
which core runs from `_onRender`. MEJ's shell never runs `_onRender` for a
mounted subsheet (documented in `CC/scripts/sheets/SessionSheet.mjs:5-12`) and
substitutes its own hand call at `enhanced-journal.js:641` — passing
`subsheet` as `this`, so `_toggleDisabled` looks at `subsheet.element`, not
at the `subsheetElement` the shell just rendered into.

The GM/player asymmetry follows from *which enrichment path* a section takes:

- **Native "Everyone"** — the section carries Foundry's own `revealed` class
  in the stored body (confirmed in the audit at
  `CC/docs/superpowers/plans/2026-08-29-sweep-round5-ui-audit.md:733-742`).
  `enrichHTML` with `secrets:false` keeps it (`FV/…/text-editor.mjs:133` only
  removes `section.secret:not(.revealed)`) and then wraps it in
  `<secret-block>` (`:369-377`). That string is inserted into the live
  document by MEJ's `_replaceHTML`, so the custom element upgrades,
  `connectedCallback` fires, and the button is created with `revealable`
  still `true`.
- **Group-only reveal** — the same `:133` strips it from the base render.
  The companion re-inserts it from `injectPlayerSecrets`, which parses the
  re-enriched HTML in an **inert `DOMParser` document** and then
  `replaceChildren`s it in. Those `<secret-block>` wrappers do not come from
  the live parser, which is why no core button appears on them (this is the
  observed behaviour; it is also why they instead carry the companion's own
  `.mej-cc-revealed-to-you` marker).

**Honest caveat on severity.** The audit's evidence for "renders on a
player's screen" is a *textContent* reading — "the section's text begins with
the word **Hide**"
(`…sweep-round5-ui-audit.md:751-757`). MEJ's CSS rule at
`monks-journal-sheet.css:338-340` should be `display:none`-ing that button for
any non-owner (`editable="false"` on `.journal-subsheet`), which would leave
it in the DOM and in `textContent` but unpainted. I could not distinguish the
two without a live browser. Either way the control should not be in a
player's DOM at all, and the fix below is correct under both readings.
Also note the button is not a privilege escalation: `#onReveal` only
dispatches `change` (`secret-block.mjs:96-98`); the write goes through
`HTMLSecret._onToggleSecret` → the sheet's update callback, which the server
refuses for a non-owner. The harm is a confusing control and a permission
error, not data loss.

**(c) Smallest correct fix**

Use core's own API, in the companion's existing inject path
(`CC/scripts/hooks/secrets-ui.mjs`, inside the `inject` closure registered at
the bottom of `registerSecretsUi`, so it runs on both render hooks and after
`injectPlayerSecrets`):

```js
/** Core adds a Reveal/Hide toggle to every secret-block on upgrade and only
 *  DocumentSheetV2._toggleDisabled turns it off — which MEJ's shell never
 *  reaches for a mounted subsheet. Do it ourselves for anyone who can't write. */
function suppressCoreRevealToggles(sheet, element) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  if (page.parent?.isOwner) return;              // GM / owner keeps the control
  for (const block of element.querySelectorAll("secret-block")) {
    if ("revealable" in block) block.revealable = false;
    else block.querySelector(":scope > .secret > button.reveal")?.remove();
  }
}
```

The `else` branch covers a not-yet-upgraded wrapper. Call it last in
`inject`, and also from the `MutationObserver`-free path by re-running it at
the end of `injectPlayerSecrets` (the sections it inserts are added after the
hook body has already walked the element).

Files touched: `CC/scripts/hooks/secrets-ui.mjs` only. No MEJ change; no CSS
required (a CSS-only variant —
`.mej-cc-hub, #MonksEnhancedJournal .journal-subsheet:not([editable="true"]) secret-block button.reveal { display: none !important }`
— would work too but duplicates a rule MEJ already has and does not remove
the control from the DOM).

**(d) Test seam**

`CC/tests/e2e/09-secrets.spec.mjs` — it already has the exact fixture: a GM
reveals a block, a player context opens the same entry, and
`contentPreview(shell)` locates `.editor-display[data-key="text.content"]`.
Add to the "Everyone" reveal case (the natively-revealed path):

```js
await expect(p1Shell.locator('section.secret.revealed button.reveal')).toHaveCount(0);
```

and the symmetric assertion for the group-reveal case so the two paths are
pinned to the same behaviour. There is no vitest seam — the logic is DOM
manipulation against a live custom element.

**(e) Risk / coupling**

Low-medium. The check keys on `page.parent?.isOwner`, matching MEJ's own
`editable` derivation (`MEJ/sheets/EnhancedJournalSheet.js:357-362`), so a GM
and a genuine document owner keep the toggle. Two couplings: (1) if MEJ's
`_toggleDisabled` hand call at `enhanced-journal.js:641` is ever fixed
upstream, this becomes redundant but harmless; (2) `revealable` is a Foundry
v13+/v14 property — the `"revealable" in block` guard keeps it safe if the
element ever ships un-upgraded.

---

## 6. Campaign portal page renders the Knowledge panel below the Hub

**(a) Where**

- `CC/scripts/hooks/knowledge-ui.mjs:22-29` — the injection predicate:
  ```js
  function mejPageOf(sheet) {
    const doc = sheet?.document;
    if (!(doc instanceof JournalEntryPage)) return null;
    if (mejType(doc)) return doc;
    const bare = String(doc.type ?? "").split(".").pop();
    return MEDIA_PAGE_TYPES.includes(bare) ? doc : null;
  }
  ```
- `CC/scripts/logic/campaign-portal-data.mjs:15-24` — `buildCampaignPortalData`
  stamps `flags["monks-enhanced-journal"].type = CAMPAIGN_TYPE` ("campaign")
  alongside the native subtype `mej-campaign-companion.campaign`.
- `CC/scripts/logic/mej-type.mjs:37-40` — `mejTypeWith` falls through to
  `game.MonksEnhancedJournal.getMEJType(doc)`, which validates that flag
  against MEJ's registry (the companion registers `campaign` through the
  extension API).
- `CC/scripts/hooks/knowledge-ui.mjs:94-123` — `injectPanel` ends with
  `element.appendChild(panel)`, i.e. the panel is appended to the shell root
  *after* whatever the page's sheet rendered.

**(b) Root cause**

The portal page is deliberately given the MEJ interop flag so that search,
the Hub index, auto-link and export machinery treat it as a first-class MEJ
page (the doc comment at `campaign-portal-data.mjs:7-14` says exactly that).
`mejPageOf` uses that same flag as its "does the companion own this page's
presentation?" test, so it says yes for the portal — even though the portal's
whole body is the Campaign Hub, which has no tags, no attributes and no
meaningful backlinks. The predicate has no notion of a *shell* page: it
knows "MEJ-typed" and "native media page", and the portal is a third kind.
Result: `Tags / Attributes / Mentioned in` is appended under the Hub, exactly
as recorded in `CC/docs/images/portal.png` (archived task-5 report, product
bug 6).

**(c) Smallest correct fix**

Exclude companion shell pages in the predicate. In
`CC/scripts/hooks/knowledge-ui.mjs`, import `CAMPAIGN_DOCUMENT_TYPE` (and,
for the Hub page, `HUB_PAGE_ID`) from `../constants.mjs` and add one line:

```js
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  if (doc.type === CAMPAIGN_DOCUMENT_TYPE) return null; // shell page: the Hub is its whole body
  if (mejType(doc)) return doc;
  …
}
```

Better still, extract the whole decision into a pure, exported predicate so
it can be unit-tested and so `secrets-ui.mjs`'s near-identical `mejPageOf`
(`CC/scripts/hooks/secrets-ui.mjs:22-26`) can share it — the secrets overlay
has the same blind spot today, it simply never finds a `section.secret` on
the portal so nothing shows.

Files touched: `CC/scripts/hooks/knowledge-ui.mjs` (+ optionally a new
`CC/scripts/logic/panel-eligibility.mjs` and `CC/scripts/hooks/secrets-ui.mjs`).

**(d) Test seam**

- e2e (direct): `CC/tests/e2e/15-campaign-portal.spec.mjs` — it already opens
  a portal entry as GM and as a player and asserts
  `.mej-cc-hub-container` count 1. Add
  `await expect(portalShell.locator('.mej-cc-knowledge')).toHaveCount(0)`.
- vitest (if the predicate is extracted): needs new —
  `CC/test/panel-eligibility.test.js`, alongside the existing
  `CC/test/campaign-portal-data.test.js` which already exercises
  `buildCampaignPortalData`'s flag shape.

**(e) Risk / coupling**

Low. Guard on the native subtype (`doc.type`), never on the MEJ flag — the
flag is load-bearing for search/Hub/export and must keep its value. Verify
that filtering by `doc.type` does not accidentally exclude a *user-created*
`Campaign` page made through MEJ's New Entry dialog; if such pages should
keep a knowledge panel, gate on `isCampaignPortal(page)`
(`CC/scripts/logic/campaigns.mjs:188-192`, which keys on the companion's own
`campaignPortal` flag) instead of on the type string.

---

## 7. Zero-campaign world: dead filing/capture controls, and "1 sections"

### 7a. Silent `promptCampaignChoice()` short-circuit

**(a) Where**

- `CC/scripts/apps/CampaignHubPage.mjs:1298-1300`:
  ```js
  static async promptCampaignChoice(title, { alwaysPrompt = false } = {}) {
    const campaigns = getCampaigns();
    if (!campaigns.length) return null;
  ```
- Callers that then `return` with no feedback:
  - `:1237-1246` `onFileIntoCampaign` — `if (!campaign) return;` at `:1243`
  - `:1260-1274` `onFileAllShown` — `if (!campaign) return;` at `:1269`
  - `:1073-1079` `onSetCaptureCampaign` — `if (!campaign) return;` at `:1076`
- The controls that stay rendered: `CC/templates/hub.hbs` Index toolbar
  (`fileAllShown`) and per-row (`fileIntoCampaign`), both gated only on
  GM + Unfiled scope; Tools menu `setCaptureCampaign`, gated only on GM.

**(b) Root cause**

`promptCampaignChoice` conflates two outcomes into one `null`: "the GM
cancelled the dialog" (`:1317`, `rejectClose:false` → `result` undefined) and
"there was no dialog to show because the world has no campaigns" (`:1300`).
Every caller treats `null` as "user declined" and returns silently — correct
for the first case, wrong for the second. Rendering is not gated on campaign
count either, so in a zero-campaign world three GM controls are drawn,
enabled, and inert. Observed live and recorded in the round-5 audit
(`…sweep-round5-ui-audit.md`, Hub header and Campaigns sections) and as
"Likely bug" in the archived task-1 report.

**(c) Smallest correct fix**

Fix it in the one place all three callers share
(`CC/scripts/apps/CampaignHubPage.mjs:1298-1301`):

```js
if (!campaigns.length) {
  ui.notifications.warn(game.i18n.localize(`${I18N}.hub.noCampaignsYet`));
  return null;
}
```

with a new `MEJCampaignCompanion.hub.noCampaignsYet` string in
`CC/lang/en.json` (near `hub.fileInto` at `:117`), e.g.
`"No campaigns yet — create one from the campaign picker first."`
Optionally also hide the three controls when there are no campaigns by
adding a `hasCampaigns` boolean to the Hub context and wrapping the buttons
in `{{#if hasCampaigns}}` in `CC/templates/hub.hbs` — but the notification
alone removes the silence, and keeping the controls visible keeps the
affordance discoverable.

Files touched: `CC/scripts/apps/CampaignHubPage.mjs`, `CC/lang/en.json`
(+ `CC/templates/hub.hbs` if the render gate is taken too).

**(d) Test seam**

`CC/tests/e2e/14-campaigns.spec.mjs` — the campaigns spec already drives
Unfiled scope and `fileAllShown` end to end at `:748-770`. Add a
zero-campaign case there (delete all campaign folders first, then click
`button.mej-cc-file-all` and assert `#notifications .warning` appears). A
vitest seam does not exist for `promptCampaignChoice` (it is a static on an
`ApplicationV2` subclass and calls `DialogV2`); if a unit test is wanted,
`getCampaigns()`'s zero case is already covered in
`CC/test/campaigns.test.js`.

### 7b. "1 sections detected as sessions"

**(a) Where**

- `CC/lang/en.json:289` —
  `"sessionsDetected": "{count} sections detected as sessions — their type and timepoint are pre-set."`
- Producer: `CC/scripts/apps/import-wizard.mjs:144` —
  `context.sessionsDetected = this.state.sections.filter((s) => s.isSession).length;`
- Consumer: `CC/templates/import-wizard.hbs:39-41` —
  `{{localize "MEJCampaignCompanion.import.sessionsDetected" count=sessionsDetected}}`

**(b) Root cause**

Foundry's `game.i18n.localize`/`format` does simple `{token}` substitution
with no plural selection, and the string is written only in the plural form.
With one detected section it renders "1 sections detected as sessions".

**(c) Smallest correct fix**

Two keys plus a boolean in the context. In `CC/lang/en.json`:

```json
"sessionsDetected": "{count} sections detected as sessions — their type and timepoint are pre-set.",
"sessionsDetectedOne": "1 section detected as a session — its type and timepoint are pre-set.",
```

and in `CC/templates/import-wizard.hbs`:

```hbs
{{#if sessionsDetected}}
<p class="hint mej-cc-import-sessions-detected">
  {{#if sessionsDetectedOne}}{{localize "MEJCampaignCompanion.import.sessionsDetectedOne"}}
  {{else}}{{localize "MEJCampaignCompanion.import.sessionsDetected" count=sessionsDetected}}{{/if}}
</p>
{{/if}}
```

with `context.sessionsDetectedOne = context.sessionsDetected === 1;` at
`CC/scripts/apps/import-wizard.mjs:144`.

Files touched: `CC/lang/en.json`, `CC/templates/import-wizard.hbs`,
`CC/scripts/apps/import-wizard.mjs`.

**(d) Test seam**

`CC/tests/e2e/05-docx-import.spec.mjs` — drives the wizard's review screen
against a fixture; assert the exact hint text for a one-session fixture. A
vitest seam for the count itself would fit in `CC/test/doc-import.test.js`
(which already tests section detection), but the defect is in the string, so
the e2e assertion is the one that catches it.

**(e) Risk / coupling (7a + 7b)**

Low. 7a's only coupling is `onFileAllShown`'s Unfiled re-check
(`CampaignHubPage.mjs:1262`), which must stay in front of the notification —
it is the guard that stops All scope collapsing every campaign into one.
7b touches a translated string; any other locale files (none today) would
need the second key.

---

## 8. C16 — `#promptDashboard`'s bad-query branch is unreachable

**(a) Where**

- `CC/scripts/apps/CampaignHubPage.mjs:804-807` — the standing comment
  ("recorded not fixed") and `:809-827` — `#promptDashboard`:
  ```js
  if (!typed.name || !typed.query) { …incomplete…; continue; }
  try { parseQuery(typed.query); } catch { …badQuery…; continue; }   // :819-824
  ```
- `CC/scripts/logic/query-grammar.mjs:16-41` — `parseQuery`, whose only
  `throw` is `:37-39`:
  ```js
  if (!parsed.text && !parsed.types.length && !parsed.tags.length && !parsed.attrs.length)
    throw new Error("empty-query");
  ```
- String: `CC/lang/en.json:216` `"badQuery": "That query can't be parsed."`

**(b) Root cause**

`parseQuery` is a *total* parser by construction: it splits on whitespace,
tries `/^(type|tag|attr):(.+)$/i` against each token, and anything that does
not match becomes free text (`:20-23`). There is no syntax that can fail —
the sole throw fires only when the result is completely empty, which requires
an empty/whitespace-only string, which `#promptDashboard`'s own
`!typed.query` check at `:815` (on an already-`.trim()`ed value, `:784`) has
already rejected. So the `catch` at `:821` is dead.

**What the four probe inputs actually parse to** (traced through
`query-grammar.mjs:16-41`; none throws):

| Input | `parseQuery` result | Then `runQuery` does |
|---|---|---|
| `attr:=:=broken` | regex matches, `prefix="attr"`, `rest="=:=broken"`; `rest.indexOf("=") === 0` → `{types:[], tags:[], attrs:[{key:"", value:":=broken"}], text:""}` | no free text → walks every record; `matchesMeta` needs an attribute whose key lowercases to `""`, which cannot exist → **0 results, silently** |
| `attr:` | regex requires `(.+)` after the colon → no match → free text → `{attrs:[], text:"attr:"}` | free-text `search()` for the token `attr` |
| `((` | no match → free text → `{text:"(("}` | `search()` → `tokenize("((")` → `[]` → `search` returns `[]` → **0 results** |
| `"unclosed` | no match → free text → `{text:"\"unclosed"}` | free-text search for `unclosed` — matches normally |

**(c) Decision and smallest correct fix**

**Make `parseQuery` strict, and keep the branch.** Removing the branch would
be smaller but wrong: three of the four probes above are user mistakes that
currently fail *silently* as an empty dashboard, which is the worst possible
feedback — and `parseQuery` is shared with the `@CampaignQuery` enricher,
which has its own `badQuery` string already wired
(`CC/lang/en.json:224` `"Invalid @CampaignQuery."`), i.e. a second consumer
already assumes throwing is meaningful.

Reject exactly what cannot mean anything, and nothing more:

```js
// in query-grammar.mjs, per token, after the prefix split
if (prefix === "type" && !/^[\w.-]+$/.test(rest)) throw new Error("bad-type");
if (prefix === "tag" && !rest.trim()) throw new Error("bad-tag");
if (prefix === "attr") {
  const eq = rest.indexOf("=");
  const key = eq === -1 ? rest : rest.slice(0, eq);
  if (!key.trim()) throw new Error("bad-attr-key");   // catches `attr:=:=broken`
  …
}
```

That rejects `attr:=:=broken` (empty key) and leaves `attr:`, `((` and
`"unclosed` as free text — which is correct: they are legitimate, if
unproductive, full-text searches, and the grammar's documented contract
(`query-grammar.mjs:5-12`) is "anything else → free text". Do **not** try to
validate balanced parentheses or quotes; the grammar has no such syntax and
inventing one would break real searches. Update the doc comment at
`CampaignHubPage.mjs:804-807` to say the branch is now live.

Files touched: `CC/scripts/logic/query-grammar.mjs`,
`CC/scripts/apps/CampaignHubPage.mjs` (comment only).

**(d) Test seam**

`CC/test/query-grammar.test.js` — exists and already unit-tests `parseQuery`,
`matchesMeta` and `runQuery`. Add the four probe inputs as explicit cases:
`attr:=:=broken` throws; `attr:`, `((`, `"unclosed` parse to the free-text
shapes tabulated above and do not throw. The Hub-side branch can be pinned in
`CC/tests/e2e/08-query-graph.spec.mjs` (which drives the dashboard dialog) by
typing `attr:=:=broken` and asserting the dialog re-opens pre-filled with a
`badQuery` warning.

**(e) Risk / coupling**

Medium — this is the one item that changes shared behaviour. `parseQuery` has
three consumers: `#promptDashboard`, `runQuery` (Dashboards + Hub Search
spillover), and the `@CampaignQuery` enricher
(`CC/scripts/hooks/query-enricher.mjs`, which localizes
`MEJCampaignCompanion.…badQuery`). Making it strict means an **already-saved**
dashboard whose query contains `attr:=…` will start throwing where it
previously returned zero rows — so `runQuery`'s callers must catch and render
the error state rather than let it escape into a render. Check
`CC/scripts/apps/CampaignHubPage.mjs`'s dashboard-results path and the
enricher both wrap `runQuery` in a try/catch before shipping this.

---

## 9. S5 — the vendored `mammoth.browser.min.js` version

**(a) Where**

- `CC/vendor/mammoth.browser.min.js` — 635 882 bytes, sha256
  `5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9`
- `CC/vendor/checksums.txt:3` records that hash.
- `CC/vendor/README.md` — "## Known gap: the current versions are
  unidentified", asserting the file "was checked by SHA-256 against every
  published `mammoth` release from 1.6.0 through 1.12.1 and matches **none**
  of them".
- `CC/tests/vendor/check-vendor.mjs:5-11` — the script's own header repeats
  "it does not tell you WHICH version a bundle is (see vendor/README.md —
  currently unknown, and unrecoverable by checksum against published
  releases)".

**(b) Finding — the version is `mammoth@1.12.0`, and the README's claim is wrong**

I re-ran the comparison properly. `npm pack mammoth@<v>` for every release
1.6.0 → 1.12.2, extracted `package/mammoth.browser.min.js` from each, and
hashed:

```
pkg-1.9.0    634129  2a0c24d419b8b6b3
pkg-1.9.1    634142  78afc1f7bd087923
pkg-1.10.0   634734  6a6bc85249d79325
pkg-1.11.0   635562  62773d3b21c71303
pkg-1.12.0   635882  5d4c0e7c9165d70b   <-- exact match
pkg-1.12.1   636199  0180991546a6dab1
pkg-1.12.2   636579  e660d427ddb9aaf5
```

Full verification:

```
5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9  pkg-1.12.0/mammoth.browser.min.js
5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9  vendor/mammoth.browser.min.js
cmp → BYTE IDENTICAL
```

So the bundle is **not** a local build: it is the prebuilt browser bundle
shipped in the npm tarball for **mammoth 1.12.0**, copied verbatim — exactly
the procedure `vendor/README.md`'s "Regenerating" section already prescribes.
(The two `version="3.4.7"` / `version="3.7.1"` strings inside the bundle are
bluebird's, a transitive dependency, not mammoth's; mammoth's own version is
not embedded, which is why a string search finds nothing and a hash
comparison is the only route.)

Artifacts left in the job tmp dir for re-verification:
`/Users/danbularzik/.claude/jobs/4378f1d9/tmp/mm/pkg-1.12.0/`.

Latest published is **1.12.2**, so the vendored copy is two patch releases
behind. That is a separate decision (upgrading changes docx-import behaviour
and needs `05-docx-import` re-run) — but "are we affected by a mammoth CVE?"
is now answerable, which was the whole point of S5.

**(c) Smallest correct fix — how `check:vendor` should pin it**

Extend the manifest from `<sha256>  <file>` to `<sha256>  <file>  <name>@<version>`
and have `check-vendor.mjs` verify the version claim against the registry
when asked, so the record cannot silently rot:

1. `CC/vendor/checksums.txt` — append a third field:
   ```
   5d4c0e7c9165d70b…a3b9  mammoth.browser.min.js  mammoth@1.12.0
   ```
   Widen `parseManifest`'s regex at `CC/tests/vendor/check-vendor.mjs:26-33`
   from `/^([0-9a-f]{64})\s+(.+)$/` to
   `/^([0-9a-f]{64})\s+(\S+)(?:\s+(\S+@\S+))?$/` and carry `pkg` through.
2. Keep the default run **offline** (it is in CI beside the unit suite and
   must not need the network): the third field is recorded and printed, not
   fetched.
3. Add an opt-in verification mode — `node tests/vendor/check-vendor.mjs --verify-upstream`
   (or `npm run check:vendor:upstream`) — which, for each entry carrying a
   `pkg` field, runs `npm pack <pkg>` into a temp dir, hashes the recorded
   source path, and fails if it differs. The source path inside the tarball
   differs per package, so record it too or keep a small map in the script
   (`mammoth` → `package/mammoth.browser.min.js`, `docx` →
   `package/build/index.iife.js`, `d3-force` → locally bundled, no upstream
   file to compare).
4. Rewrite `CC/vendor/README.md`: delete the "Known gap: the current versions
   are unidentified" section, put `1.12.0` in the Inventory table, and note
   the drift to 1.12.2. Fix the same stale claim in
   `CC/tests/vendor/check-vendor.mjs:5-11`.

Files touched: `CC/vendor/checksums.txt`, `CC/vendor/README.md`,
`CC/tests/vendor/check-vendor.mjs`, `CC/package.json` (one script entry).

**Still open:** `docx.iife.js` (1 123 332 bytes, sha256 `d5ec4f5a…`) and
`d3-force.esm.js` were not identified. `docx@9.1.0`'s
`package/build/index.iife.js` is 776 004 bytes, so it is not that release;
further `npm pack docx@<v>` calls failed in this session (registry
throttling), so the same size/hash sweep across `docx` 9.x should be repeated
when the network cooperates. `d3-force.esm.js` is genuinely a local esbuild
bundle (its own first-line provenance comment says so) and cannot be matched
by hash — it needs its source version recorded at regeneration time instead.

**(d) Test seam**

`CC/tests/vendor/check-vendor.mjs` itself is the seam and already runs in CI
via `npm run check:vendor`. There is no vitest file for it; if one is wanted,
`CC/test/` has no precedent for testing a CLI script — extracting
`parseManifest` into an exported function and adding
`CC/test/check-vendor-manifest.test.js` is the natural minimum.

**(e) Risk / coupling**

Very low for the *recording* work — no shipped bytes change, so `check:vendor`
stays green and no e2e is affected. The `--verify-upstream` mode must remain
opt-in: making it the default would put a network fetch on the CI critical
path and break offline runs. Do not bundle the 1.12.0 → 1.12.2 upgrade into
this change; `CC/vendor/README.md` already argues (correctly) that swapping
the bundle needs `05-docx-import` run against it.

---

## 10. Harness — id-tracked replacement for `cleanupTimelineJournal()`

**(a) Where**

- `CC/tests/e2e/helpers/foundry.mjs:371-387` — the helper. Line `:373` is the
  defect:
  ```js
  const candidates = game.journal.filter((e) => e.name === "Campaign Timeline" && !excludeIds.includes(e.id));
  ```
- Its own doc comment (`:340-370`) already documents two consequences of
  name-keying: a world can hold several journals with that exact name, and a
  caller must hand-maintain `excludeIds` to avoid deleting pre-existing ones.
- Callers: `02-hub-timeline.spec.mjs:50` (via `cleanupAsGm`),
  `04-auto-capture.spec.mjs:60`, `05-docx-import.spec.mjs:70`,
  `14-campaigns.spec.mjs:244` (the only one passing `excludeIds`),
  `16-multi-timeline.spec.mjs:131`, `17-media-routing.spec.mjs:280`.
- What actually creates them: `CC/scripts/data/timeline-journal.mjs:79-92`
  `ensureTimelineJournal()` — fired as a *side effect* of a GM Hub render,
  not by any spec; `:60-70` `createTimeline()` — the picker's
  "➕ New timeline…" path, campaign-owned, named `<Campaign> — Timeline`.

**(b) Root cause / why the name key is wrong**

Two independent problems.

1. **It over-deletes.** `"Campaign Timeline"` is the *default name* of the
   world singleton, and it is also a perfectly plausible name for a user's
   real journal — which is exactly the situation in World A today (the audit
   found a pre-existing, empty `Campaign Timeline` with zero timepoints). The
   "no non-`TT-` timepoints ⇒ safe to delete" heuristic at `:376-381` is the
   only thing standing between the suite and a user document, and an empty
   user journal defeats it. `14-campaigns` already has to hand-carry
   `excludeIds: prior.campaignTimelineIds` to work around this.
2. **It under-deletes.** Campaign-owned timelines are named
   `${campaign.name} — Timeline` (`timeline-journal.mjs:85`) and *never* match
   the name filter, so every campaign timeline a spec induces leaks unless
   its campaign folder is deleted with `deleteContents`.

The real identity is the flag, not the name: `isTimelineJournal()`
(`CC/scripts/logic/campaigns.mjs`) keys on `flags[MODULE_ID].timeline`, which
both creation paths stamp (`timeline-journal.mjs:64` and `:87`).

**(c) Design of the id-tracked replacement**

Registration cannot happen at creation time inside the spec, because the spec
does not create these — the module does, from a Hub render. So invert it:
**register what already existed, delete only what appeared.** The ledger
lives Node-side, so it survives `page.reload()`, new contexts and the
per-worker restarts Playwright does after a failure (see the archived task-5
report's note that a mid-file failure re-runs `beforeAll`).

Two new helpers in `CC/tests/e2e/helpers/foundry.mjs`:

```js
/** Ids of every timeline journal that exists RIGHT NOW. Call in beforeAll/beforeEach. */
export async function timelineJournalIds(page) {
  return page.evaluate((id) =>
    game.journal.filter((e) => !!e.getFlag(id, "timeline")).map((e) => e.id), MODULE_ID);
}

/**
 * Delete every timeline journal created since `preexisting` was taken, provided
 * it carries no non-TT timepoints. Identity is the module's own flag, never the
 * name; anything in `preexisting` is untouchable by construction.
 */
export async function cleanupTimelineJournals(page, preexisting = [], { prefix = TT_PREFIX } = {}) {
  await page.evaluate(async ({ id, TT, keep }) => {
    const keepSet = new Set(keep);
    const doomed = game.journal.filter((e) => !!e.getFlag(id, "timeline") && !keepSet.has(e.id));
    for (const j of doomed) {
      const tps = j.getFlag(id, "timeline")?.timepoints ?? [];
      const real = tps.filter((t) => !t.label?.startsWith(TT));
      if (real.length) { await j.setFlag(id, "timeline", { timepoints: real }); continue; }
      await JournalEntry.implementation.deleteDocuments([j.id]);
      if (game.settings.get(id, "timelineJournalId") === j.id) await game.settings.set(id, "timelineJournalId", "");
      if (game.settings.get(id, "hubTimelineSelection") === j.id) await game.settings.set(id, "hubTimelineSelection", "");
    }
  }, { id: MODULE_ID, TT: prefix, keep: preexisting });
}
```

Two behaviour changes worth naming: it now also reclaims **campaign-owned**
timelines (closing the leak in (b)2), and it clears the
`hubTimelineSelection` client setting, which the current helper leaves
dangling at a deleted id.

**How each caller registers:**

| Caller | Change |
|---|---|
| `02-hub-timeline.spec.mjs:50` | add `let preexisting; test.beforeAll(async ({browser}) => withGmPage(browser, async p => { preexisting = await timelineJournalIds(p); }))`; pass it in the `cleanupAsGm` callback |
| `04-auto-capture.spec.mjs:60` | same pattern; it already has a GM `page` in scope at snapshot time |
| `05-docx-import.spec.mjs:70` | same |
| `16-multi-timeline.spec.mjs:131` | same — and this is the spec that most needs the campaign-timeline reclamation |
| `17-media-routing.spec.mjs:280` | same |
| `14-campaigns.spec.mjs:244` | **simplifies**: `prior.campaignTimelineIds` becomes the `preexisting` argument directly and the bespoke `excludeIds` option disappears |

Keep `cleanupTimelineJournal` (singular) as a thin deprecated wrapper for one
release if you want a staged migration, or delete it and update all six
callers in the same commit — six sites, all mechanical.

**(d) Test seam**

Needs new, and it can be a real one:
`CC/tests/e2e/18-harness-cleanup.spec.mjs` — as GM, snapshot ids, create a
journal named `Campaign Timeline` *without* the module flag plus one
flagged timeline, run `cleanupTimelineJournals(page, preexisting)`, and assert
the unflagged look-alike and every pre-existing id survive while the new
flagged one is gone. That is precisely the World-A hazard the current helper
cannot express. `CC/test/timelines.test.js` and
`CC/test/timeline-sort.test.js` cover the pure side and are unaffected.

**(e) Risk / coupling**

Medium. This helper deletes documents in the user's real world, so the
snapshot must be taken **before** anything opens a GM Hub — `ensureTimelineJournal`
fires on the first GM Hub render, and a snapshot taken after it would
"bless" a journal the run itself created (leaking it, which is safe) or,
worse, a snapshot taken too late in a `beforeEach` would blesss per-test
churn. Also note `worldTimelineJournalId()` (`foundry.mjs:407-428`) resolves
through the `timelineJournalId` setting and will start throwing if cleanup
clears a setting a later test depends on — order the snapshot/cleanup pair
around it. Finally, `MODULE_ID` must be passed into `page.evaluate` (it is a
Node-side import, not available in the browser context) — the current helper
hardcodes the string, the replacement should keep passing it explicitly.

---

## 11. Harness — nine spec-side `goto('/game')` / `reload()` + bare `game.ready` waits

**(a) Where**

The predicate the helper already has:
`CC/tests/e2e/helpers/foundry.mjs:139-140`

```js
const SESSION_BOUND = () =>
  globalThis.game?.ready === true && !!globalThis.game?.socket?.session?.userId;
```

with a 20-line comment (`:118-138`) explaining that a cookie fast-path login
produces **two** `/game` navigations and that `game.ready` can flip on the
doomed first document. It is used at `:155`, `:204`, `:277`, `:294` — all
inside the helper module. Every spec-side navigation still uses the bare
`game.ready`:

| # | Site | Navigation | Wait | Post-load wait to preserve |
|---|---|---|---|---|
| 1 | `00-mej-api.spec.mjs:139-140` | `page.goto("http://localhost:30000/game")` (hardcoded, not `BASE_URL`) | `game.ready`, 60 s | `settle(page, 500)`; runs with the **companion module disabled** |
| 2 | `01-session.spec.mjs:141-142` | `goto(\`${BASE_URL}/game\`)` | `game.ready`, 60 s | `settle(page, 300)` |
| 3 | `02-hub-timeline.spec.mjs:70-71` | `goto` | `game.ready`, 60 s | `settle(page, 500)` |
| 4 | `12-native-mode.spec.mjs:13-14` | `page.reload()` after a settings write | `game.ready`, 60 s | **`settle(page, 2500)`** — Foundry rebuilds `CONFIG.JournalEntryPage.sheetClasses` async after ready |
| 5 | `12-native-mode.spec.mjs:106-108` | `page.reload()` | `game.ready`, 60 s | **`settle(page, 2500)`** — same, plus the ready-hook sweep |
| 6 | `13-stock-smoke.spec.mjs:62-63` | `page.reload()` (conditional) | `game.ready`, 60 s | **`settle(page, 2500)`** — same |
| 7 | `14-campaigns.spec.mjs:336-337` | `goto` | `game.ready`, 60 s | `settle(page, 500)` |
| 8 | `14-campaigns.spec.mjs:694-695` | `playerPage.goto` | `game.ready`, 60 s | `settle(playerPage, 500)` |
| 9 | `15-campaign-portal.spec.mjs:354-355` | `page.reload()` after rewinding `dataVersion` | `game.ready`, 60 s | **`waitForFunction` polling `dataVersion === CURRENT_DATA_VERSION`, 30 s** — a real condition, not a settle |

**A tenth site the brief did not list:** `09-secrets.spec.mjs:593-594` —
`await page.reload(); await settle(page, 3000);` with **no ready wait at
all**. The 3 s settle is standing in for both the ready wait and the
migration poll. It should get `reloadGame(page)` plus the same
`dataVersion` poll that `15-campaign-portal:356-370` uses (both tests rewind
`dataVersion` to re-run a migration).

**(b) Root cause**

`SESSION_BOUND` was introduced during round 5 to fix a real, measured race
(`login()` returning onto a document about to be replaced by core's
`/join` → `/game` redirect; the archived task-7 report shows
`navsAtLoginReturn=2`). The helper module was converted; the specs were not.
Every spec-side navigation therefore reproduces the original hazard —
`game.ready` can be observed on the first, doomed document, and the next
`page.evaluate` dies with "Execution context was destroyed". The bare wait is
also duplicated verbatim nine times, so the next fix has nine places to
reach.

**(c) Smallest correct fix — yes, one shared helper covers all nine**

Add to `CC/tests/e2e/helpers/foundry.mjs`, right after `SESSION_BOUND`:

```js
/** Navigate to /game and wait for a session-bound document (never a bare game.ready). */
export async function gotoGame(page, { timeout = 60_000 } = {}) {
  await page.goto(`${BASE_URL}/game`);
  await waitSessionBound(page, timeout);
}

/** Reload the current /game document and wait for it to rebind. */
export async function reloadGame(page, { timeout = 60_000 } = {}) {
  await page.reload();
  await waitSessionBound(page, timeout);
}

async function waitSessionBound(page, timeout) {
  try {
    await page.waitForFunction(SESSION_BOUND, null, { timeout });
  } catch {
    // A reload that lands on /join (expired session) would otherwise hang the
    // full timeout with no clue; name what we actually landed on.
    throw new Error(`no session-bound /game document after ${timeout}ms (url=${page.url()})`);
  }
}
```

Each call site becomes one line and **keeps its own trailing wait**:

- sites 1, 2, 3, 7, 8 → `await gotoGame(page); await settle(page, N);`
- sites 4, 5, 6 → `await reloadGame(page); await settle(page, 2500);`
- site 9 → `await reloadGame(page);` then the existing `dataVersion` poll,
  unchanged.
- site 10 (`09-secrets:593`) → `await reloadGame(page);` + the `dataVersion`
  poll copied from site 9, replacing the blind `settle(page, 3000)`.

Site 1 also gets `BASE_URL` instead of the hardcoded
`http://localhost:30000/game`.

Files touched: `CC/tests/e2e/helpers/foundry.mjs` and the seven spec files.

**Sites with a different post-load wait that must be preserved** — the direct
answer to the brief's question:

1. `12-native-mode:13`, `12-native-mode:106`, `13-stock-smoke:62` — the
   **2500 ms** settle, not 500. It is not padding: `12-native-mode.spec.mjs:15-19`
   records that `DocumentSheetConfig` throws when constructing a sheet for the
   synthetic Hub type if queried too soon after ready, because Foundry rebuilds
   `CONFIG.JournalEntryPage.sheetClasses` asynchronously *after* `game.ready`.
   `SESSION_BOUND` does not cover that; do not collapse it.
2. `15-campaign-portal:354` — a **condition poll**, not a settle: it waits for
   `dataVersion` to reach `CURRENT_DATA_VERSION`, and that target is read from
   the served module rather than hardcoded (`:363-369`, after being pinned to
   a literal `2` once broke it). Keep it verbatim.
3. `00-mej-api:139` runs in a world where the **companion is disabled**.
   `SESSION_BOUND` only touches `game.ready` and `game.socket.session.userId`,
   both core, so it is safe there — but any future strengthening of the
   predicate must not reference module state.

**(d) Test seam**

The harness is its own seam; there is no vitest for it. The convincing check
is the flake-pairing protocol the round-5 work already used: run the affected
specs N× back-to-back and compare "Execution context was destroyed" /
"navigation" failures before and after. If a regression test is wanted, the
`18-harness-cleanup.spec.mjs` file proposed in item 10 can also assert
`gotoGame`/`reloadGame` return with `game.socket.session.userId` set.

**(e) Risk / coupling**

Low, but not zero. `SESSION_BOUND` is strictly *stronger* than `game.ready`,
so it can only wait longer, never less — the one new failure mode is a reload
that lands somewhere other than `/game` (expired session), which today fails
fast at the first `evaluate` and would now burn the full 60 s timeout; the
`waitSessionBound` wrapper above turns that into an immediate, labelled error
instead. Second coupling: `gotoGame` hardcodes `BASE_URL`, so site 1 changes
target host if `BASE_URL` is ever overridden by env — that is the intended
behaviour but it is a behaviour change for that one spec.

---

## 12. MEJ workaround — the shared detailed-header partial on a Session sheet

**(a) Where**

- Partial: `MEJ/templates/sheets/partials/sheet-detailed-header.hbs` — the
  `<img class="profile">` at line 3-4 and the `{{#each fields as |field|}}`
  loop at lines 25-49.
- Included by the companion: `CC/templates/session.hbs:4` and registered as a
  sub-template at `CC/scripts/sheets/SessionSheet.mjs:66`.
- The context key that leaks: `FV/client/applications/api/document-sheet.mjs:172-184`
  ```js
  return Object.assign(context, { document, model: document, source: document._source,
    fields: document.schema.fields, editable: this.isEditable, user: game.user, rootId: … });
  ```
- What MEJ's own sheets do instead: every built-in sheet **overwrites**
  `context.fields` before the partial runs — `MEJ/sheets/PlaceSheet.js:168`,
  `PersonSheet.js:125`, `EventSheet.js:63`, `OrganizationSheet.js:80`,
  `PointOfInterestSheet.js:63`, `ShopSheet.js:176`, `QuestSheet.js:242-256`
  (all `context.fields = await this.enrichFields([...])`).
- `CC/scripts/sheets/SessionSheet.mjs:104-206` (`_prepareBodyContext`) sets
  `monthOptions`, `relationships`, `has`, `placeholder`, `secrets`, `session`,
  `attendeeDetails`, `enrichedRecap`, `enrichedGmNotes`, recap context — and
  **never sets `context.fields`**.

**(b) Root cause — and it is companion-side, not an MEJ defect**

`DocumentSheetV2._prepareContext` puts `document.schema.fields` — the raw
`JournalEntryPage` **schema**, an object of `DataField` instances — on
`context.fields`. MEJ's shared header partial iterates `{{#each fields}}`
expecting *its* field shape (`{id, name, value, full, playerHidden}` from
`fieldlist()`, `MEJ/sheets/EnhancedJournalSheet.js:365-381`). Every MEJ sheet
shadows the core value; the companion's `SessionSheet` does not, so the
partial iterates the schema instead. Each `DataField` has a `label` but no
`id`, so the partial takes the `{{else}}` branch at line 44-46 and renders
`<label>{{localize field.label}}</label><div>{{{field.value}}}</div>` — a
localized schema label over an empty div.

The five labels observed are exactly the schema fields that carry a label:
`name` → `JOURNALENTRYPAGE.FIELDS.name.label` = **"Page Name"**, `type` →
**"Type"**, `src` → `…src.label` = **"File Path"**, `category` →
`…category.label` = **"Page Category"**, `sort` →
`DOCUMENT.FIELDS.sort.label` = **"Sort Order"**
(`FV/public/lang/en.json:975` and `:1571-1576`).

The broken image is the same class of gap: the partial renders
`<img class="profile" src="{{data.src}}" onerror="…this.src =
'modules/monks-enhanced-journal/assets/{{type}}.png'">`. A Session page has
`src = null`, so the `src` attribute is empty; the `onerror` fallback then
asks for `modules/monks-enhanced-journal/assets/session.png`, and
`MEJ/assets/` contains `encounter/event/journalentry/list/loot/organization/
person/place/poi/quest/shop/slideshow` — **no `session.png`**. Both loads
fail, leaving the browser's broken-image placeholder.

Confirmed visually in `CC/docs/images/session-sheet-gm.png`: a broken-image
box top-left and five labels with nothing beside them, consuming the top
~250 px. The harness itself already records the consequence at
`CC/tests/e2e/guide-screenshots.spec.mjs:820-827`.

**What we would be hiding if we suppressed the partial wholesale:** the
window's `<h1>` with the type icon and the editable page-name `<input>`
(so the sheet loses its title and inline rename), MEJ's "Generate Name"
roll-table button, the "Grant Player Permission" toggle, the play-sound
button (moot — `SessionSheet.canPlaySound` returns `false`,
`SessionSheet.mjs:100-102`), and the linked-actor thumbnail. Those are worth
keeping, which argues against CSS suppression.

**(c) Smallest correct fix — set the context, do not suppress the partial**

Two lines in `CC/scripts/sheets/SessionSheet.mjs:_prepareBodyContext`:

```js
// MEJ's shared header partial iterates `fields` expecting fieldlist()'s shape.
// DocumentSheetV2 puts the raw JournalEntryPage SCHEMA there, so without this
// the header renders five empty schema-labelled rows. Every MEJ sheet shadows
// it the same way (PlaceSheet.js:168, PersonSheet.js:125, …).
context.fields = [];

// The partial's onerror fallback resolves to assets/session.png, which MEJ
// does not ship; give it a real image so it never 404s.
context.data.src ||= "icons/svg/book.svg";
```

`context.fields = []` collapses ~200 px of the header immediately and keeps
the title row, the rename input and the permission/actor controls. If Session
pages should eventually show real header fields (session number, campaign
date), populate the array in `fieldlist()`'s shape instead of emptying it —
that is a follow-up, not part of this fix.

Files touched: `CC/scripts/sheets/SessionSheet.mjs` only. Nothing in MEJ, no
CSS, no render hook. (A CSS fallback —
`.session-container .journal-sheet-header .form-group { display: none }`
scoped to `.session-container`, which only `session.hbs` emits — exists but is
strictly worse: it hides the rows rather than not generating them, and it
would also hide real fields if any are ever added.)

Also check `CC/scripts/sheets/MediaPageSheet.mjs`: it does not include this
partial today (`grep` confirms `session.hbs` is the only companion template
that does), so it is unaffected — but any future companion sheet that includes
it inherits the same trap. Worth a one-line note in `API.md`.

**(d) Test seam**

`CC/tests/e2e/01-session.spec.mjs` — open a Session and assert
`sessionShell.locator('.journal-sheet-header .form-group')` has count 0, and
that `.journal-sheet-header img.profile` resolves (`naturalWidth > 0`). Both
fail today. `CC/tests/e2e/guide-screenshots.spec.mjs` must re-capture
`session-sheet-gm.png` / `session-sheet-player.png`, which will also make
item 3's fix legible in the same shot. No vitest seam —
`_prepareBodyContext` needs Foundry globals.

**(e) Risk / coupling**

Low. `context.fields` is read by exactly one thing in the companion's render
path — MEJ's header partial — and the companion never reads
`document.schema.fields` itself, so blanking it cannot break form binding
(the `<prose-mirror name="…">` and `<input name="…">` elements bind by `name`
attribute, not through `context.fields`). Two things to verify: (1)
`MEJ/templates/sheets/partials/sheet-relationships.hbs` and `sheet-notes.hbs`,
also included by `session.hbs` (`SessionSheet.mjs:67-68`), do not read
`fields` — they receive explicit named arguments, so they do not; (2) setting
`context.data.src` mutates the deep clone from `document.toObject(false)`
(`MEJ/sheets/EnhancedJournalSheet.js:252`), which is safe to mutate, but it
must **not** be written back on submit — confirm the header's
`<img data-edit="src">` does not enter the form payload for a Session page,
or the default icon will be persisted onto the document.

---

## 13. MEJ workaround — enriched preview wrapper at `clientHeight` 0

**(a) Where**

- The CSS that produces it: `MEJ/css/monks-journal-sheet.css:606-610`
  ```css
  .monks-journal-sheet.sheet .editor-parent { flex: 1; height: 100%; overflow: hidden; }
  ```
  and `:612-619`
  ```css
  .monks-journal-sheet.sheet .editor.editor-display {
      min-height: 100%; padding: 0 8px; user-select: text;
      width: 100%; overflow-y: auto; height: 100%;
  }
  ```
  with the enclosing chain `:5-9` `.journal-subsheet { overflow: hidden }`,
  `:24-26` `.journal-subsheet:not(.blank-body) { height: 100% }`,
  `:40-45` `.sheet-container { flex:1; height:100%; overflow:hidden }`,
  `:331-336` `.sheet-body { height:100%; overflow:hidden; position:relative; flex:1 }`.
- The scroll-position restore that makes it sticky: the wrapper carries the
  `scrollable` class, and both MEJ's sheets and
  `CC/scripts/sheets/SessionSheet.mjs:71-76` (`PARTS.main.scrollable`) list
  `.editor-display`, so ApplicationV2 saves and re-applies `scrollTop` across
  renders.
- Symptom and measurement: `CC/tests/e2e/09-secrets.spec.mjs:83` and the
  diagnostic wrapper `CC/tests/e2e/helpers/foundry.mjs:430-482`
  (`clickWithHitDiagnostics`), whose comment at `:435-441` records the live
  capture:
  ```
  scroller=<div class="editor editor-display wrapper scrollable">
           scrollTop=62  clientH=0  scrollH=73
  topmost=<a> inside <nav class="sheet-tabs tabs">
  ```

**(b) Root cause**

`height: 100%` on `.editor.editor-display` resolves against `.editor-parent`,
whose own `height: 100%` resolves against a chain that, for the tab layouts
the companion's and MEJ's templates build, is not definite at that point —
so both collapse to 0 while `min-height: 100%` also resolves to 0. `overflow-y:
auto` keeps the box scrollable even at zero height, giving the measured
`clientHeight 0 / scrollHeight 73`.

That state is harmless while `scrollTop === 0`: the element painted at a
child's coordinates is the wrapper (or an ancestor), which Playwright's hit
check accepts. But Playwright's click always scrolls the target into view,
and nothing can be "in view" inside a 0 px viewport, so it scrolls anyway;
every child's box then shifts up by `scrollTop`, and the
`.mej-cc-secret-audience` button's rectangle lands over the tab strip *above*
the content — which is exactly the alternating
`nav.sheet-tabs a[data-tab="notes"]` / `section.place` /
`div.sheet-container` interceptors in the failure log. The scroll position
does not reset, because ApplicationV2 restores it for `scrollable` parts, so
no retry recovers.

The archived task-7 report records that two harness-side attempts failed and
were reverted: gating the click on topmost-ness (strictly weaker than
Playwright's own retry loop; it turned a healthy transient into a hard
failure of `09-secrets:438`), and waiting for non-zero height (the premise
was wrong — `clientHeight 0` is the wrapper's *normal* state today, so the
guard failed 2 runs out of 2). Both confirm that the fix has to make the
height real, not work around it in the harness.

**(c) Smallest correct fix — companion CSS scoped to companion-injected content**

Scope by `:has()` to preview wrappers that actually contain a
companion-injected control, so no MEJ sheet without companion content changes
layout at all. In `CC/styles/campaign-companion.css`:

```css
/* MEJ lays its enriched preview wrapper out at clientHeight 0 while it holds
   content (.editor-parent/.editor-display both `height:100%` against an
   indefinite chain — css/monks-journal-sheet.css:606-619), and `overflow-y:auto`
   keeps a 0px box scrollable. Anything scrolled into view inside it then lands
   above the content, over the tab strip. Only relax it where WE injected a
   control into the preview. */
.monks-journal-sheet .editor-parent:has(.mej-cc-secret-audience) {
  height: auto;
  min-height: 8em;
  overflow: visible;
}
.monks-journal-sheet .editor.editor-display:has(.mej-cc-secret-audience) {
  height: auto;
  min-height: 8em;
  overflow-y: visible;   /* a box that cannot scroll cannot mis-scroll */
}
```

`overflow-y: visible` is the load-bearing half: it removes the scroll
container entirely for these wrappers, so `scrollIntoView` has nothing to
move. The `height/min-height` pair keeps the box from collapsing so the
content is painted where its rectangle says it is. `:has()` is Chrome 105+,
comfortably inside Foundry v14's Electron/Chromium baseline.

If the team prefers not to depend on `:has()`, the equivalent is a class the
companion adds in `CC/scripts/hooks/secrets-ui.mjs`'s `injectGmOverlay`
(`section.closest(".editor-display")?.classList.add("mej-cc-has-overlay")`)
and plain descendant selectors — one extra line of JS, no selector-support
question.

Files touched: `CC/styles/campaign-companion.css` (+ optionally
`CC/scripts/hooks/secrets-ui.mjs` for the class variant).

**(d) How to verify it removes the pointer-intercept**

Three checks, in increasing strength:

1. **Direct state assertion** in `CC/tests/e2e/09-secrets.spec.mjs`, just
   before the `:83` click — the exact probe that was reverted as `awaitLaidOut`
   becomes valid *once the fix lands*, because `clientHeight 0` stops being the
   normal state:
   ```js
   const scroller = gmShell.locator('.editor-display[data-key="text.content"]');
   expect(await scroller.evaluate(el => el.clientHeight)).toBeGreaterThan(0);
   expect(await scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
   ```
   The second line is the real one: no scrollable overflow means no
   mis-scroll is possible.
2. **Hit test.** After the click resolves, assert the button was topmost:
   ```js
   const onTop = await btn.evaluate(el => {
     const r = el.getBoundingClientRect();
     const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
     return el === top || el.contains(top);
   });
   expect(onTop).toBe(true);
   ```
   Keep this as an *assertion after* the click, never as a pre-click gate —
   that is precisely the `clickWhenOnTop` mistake the task-7 report documents.
3. **Flake pairing.** `09-secrets:83` reproduced 1/5 in the round-5 baseline
   and twice more during the round. Run the spec ≥10× and require 0 failures;
   `clickWithHitDiagnostics` stays in place and will print the same
   `scrollTop / clientH / scrollH` triple if it ever recurs, so a regression is
   self-diagnosing.

**(e) Risk / coupling**

Medium. `overflow-y: visible` on a preview wrapper means long secret-bearing
content no longer scrolls *within* the preview; it will grow the pane instead
and be clipped by `.sheet-body { overflow: hidden }` unless the ancestor can
scroll. Verify against a genuinely long Place/Quest body with a secret — if
clipping appears, use `overflow-y: clip` plus a definite `max-height` instead,
which still cannot scroll but does bound the box. Second coupling: the
`scrollable` PARTS entry for `.editor-display` in
`CC/scripts/sheets/SessionSheet.mjs:71-76` (and MEJ's equivalents) will keep
saving a `scrollTop` for these wrappers; harmless once they cannot scroll,
but if the class variant is used, make sure it is applied before the first
scroll restore. Third: item 3's fix touches the same `.editor-parent` cascade
on the Session sheet — land them together and re-run both
`09-secrets` and `06-player-collab`.

---

## Cross-cutting notes

- **Items 3, 12 and 13 are one cluster.** All three are MEJ's shared sheet
  chrome (`.editor-parent`/`.editor-display` `height:100%`, and the
  `sheet-detailed-header` partial's `fields` contract) meeting companion
  templates that MEJ's own sheets never have to satisfy. Fixing 12 first is
  the cheapest — it is two lines and returns ~250 px, which makes 3 and 13
  easier to see and to verify.
- **Items 5 and 6 are one cluster too:** both `knowledge-ui.mjs` and
  `secrets-ui.mjs` carry a near-identical `mejPageOf()` and both make
  assumptions about what the shell did before the render hook fired.
  Extracting one shared eligibility predicate would fix 6 and give 5 a
  natural home.
- **Every item except 9 (partly) and 10/11 (harness) is fixable
  companion-side.** No MEJ commit is required for any of the thirteen, which
  is consistent with the standing "companion features never patch MEJ" rule.
