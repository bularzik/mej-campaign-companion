# Shared session recap + collapsible knowledge panel — design

**Date:** 2026-09-04
**Target release:** 0.17.0 (dataVersion 6)
**Base:** main @ ce8486e (0.16.0)

## Problem

1. The session sheet's Recap tab stacks two editors: the GM recap
   (`system.recap`) and a "Player Recaps" section holding the current
   user's own per-player recap
   (`flags.mej-campaign-companion.playerRecaps.<userId>`) plus every other
   player's recap read-only. The two pencils look identical and the GM is
   shown an empty personal editor they never use. More fundamentally, the
   per-player model was never the intent: the campaign record is meant to
   be **one session document the table edits together**, not parallel
   per-author recaps.
2. The knowledge panel (tags / attributes / mentioned-in,
   `templates/knowledge-panel.hbs`, injected by `hooks/knowledge-ui.mjs`
   onto every MEJ-typed sheet) cannot be hidden. Its three `<details>`
   collapse individually but the panel still occupies the bottom of every
   sheet.

## Decisions (made in brainstorming)

- One shared recap; the per-player recap feature is removed.
- Players edit through document **ownership** only (Foundry's native
  collaborative ProseMirror). No relay path for the shared body — a relay
  is whole-document last-writer-wins and would clobber concurrent edits.
- `playersWriteSessions` also grants ownership to **existing** session
  entries when switched on (after a confirm dialog). Switching it off
  changes nothing.
- Existing per-player recaps are **folded into** the shared recap by a
  one-time migration (dataVersion 6) as attributed blocks, then the flag
  is removed.
- The knowledge panel collapses to a one-line bar; collapsed state is a
  per-client setting that applies to all sheets. No tab-strip changes.

## A. One shared recap

### Sheet

`templates/session.hbs` Description tab keeps exactly one editor parent,
`data-editor-id="recap"` bound to `system.recap`, with MEJ's stock
pencil (`data-action="editRecap"`). Removed from the template: the
`.player-recaps-section` block (heading, `recapNoGM` warning,
`player-recap-self` editor, `other-recaps-list`).

`scripts/sheets/SessionSheet.mjs`:

- Remove `onEditPlayerRecap`, the `editPlayerRecap` action, `myRecapFlag`,
  the `playerRecaps`/`recapEntries`/`myRecap`/`enrichedMyRecap`/
  `otherRecaps` context in `_prepareBodyContext`, the player-recap branch
  in `_processSubmitData`, and the `_disableFields`/`subRender` overrides
  whose only purpose was to force-enable the self editor for non-owners.
- `_ingestRecapImage(file)` keeps its validation and its upload branch
  (direct `uploadCompanionFile` when the user holds `FILES_UPLOAD`, else
  `relayUploadMedia` through the active GM — `hooks/media-relay.mjs` is
  unchanged). The result is appended to the **shared** recap:
  `await this.document.update({ "system.recap": `${current}<p>${img.outerHTML}</p>` })`
  where `current = this.document.system.recap ?? ""`. Guard: if
  `!this.document.isOwner` the drop/paste is ignored (no upload is
  started) — the editor is read-only for that user anyway.
- Drop/paste listeners bind to the recap editor parent (they were bound
  to the self editor).

Editability is plain document ownership: owners (GM, and players who own
the entry) edit; everyone else sees the enriched recap read-only, exactly
as non-owners saw the GM recap before.

### Removed

- `scripts/hooks/player-recap.mjs`, `scripts/logic/player-recap.mjs`,
  `test/player-recap.test.js`, `test/player-recap-hooks.test.js`.
- `SAVE_RECAP_ACTION` and `MAX_RECAP_HTML_LENGTH` from `constants.mjs`;
  the `SAVE_RECAP_ACTION` handler and `GM_ACTIONS` entry in
  `hooks/socket.mjs` (dispatcher keeps only the upload relay actions).
- CSS: `.player-recap-self` rules in `styles/campaign-companion.css`
  (lines 38 and 48 region) and the `.player-recaps-section` comment.
- i18n (`lang/en.json` `session.*`): `playerRecaps`, `editMyRecap`,
  `recapNoGM`. `recapImage*` keys stay.
- `hasGM` is no longer read by the session sheet or template.

### Not changed

MEJ's per-user **Notes** tab (`sheet-notes.hbs`) stays — that is MEJ's own
private-notes feature and is unrelated.

## B. `playersWriteSessions` reaches existing sessions

Registration (`campaign-companion.mjs`) gains `onChange`. Because
`onChange` fires on every client for a world setting, the handler acts
only when `game.user.isGM && value === true`.

Flow on the GM client when the setting turns on:

1. `const entries = sessionEntriesNeedingOwnership(game.journal.contents)`.
2. If empty → nothing (no dialog).
3. Otherwise `DialogV2.confirm` with
   `MEJCampaignCompanion.settings.playersWriteSessions.applyExisting`
   ("Grant all players ownership of {count} existing session entries?
   Sessions created from now on are already covered."). On confirm:
   `JournalEntry.updateDocuments(entries.map((e) => ({ _id: e.id, "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER })))`,
   then `ui.notifications.info` with the count. On cancel: nothing; the
   setting stays on and only new sessions are affected (today's
   behaviour).

Pure predicate, `scripts/logic/session-ownership.mjs`:

```js
export function sessionEntriesNeedingOwnership(entries, { sessionDocumentType, ownerLevel }) {
  return entries.filter((e) =>
    (e.ownership?.default ?? 0) < ownerLevel
    && e.pages?.contents?.some((p) => p.type === sessionDocumentType));
}
```

The existing `preCreateJournalEntry` stamping is unchanged. Setting hint
rewritten: "New Session entries are owned by all players, so any player
can edit the shared recap. Turning this on also offers to grant ownership
of existing sessions."

Trust model unchanged: an owning player can read the page's data
(including `system.gmNotes`) through the console. That is already true of
every session created with the setting on and is inherent to Foundry
ownership; the GM guide states it in the Player collaboration section.

## C. Migration — dataVersion 6

`CURRENT_DATA_VERSION = 6`. Appended to the ready-time migration block in
`campaign-companion.mjs` after the v5 step, GM-only like the rest.

For every JournalEntryPage of type `SESSION_DOCUMENT_TYPE` in
`game.journal` whose `flags.mej-campaign-companion.playerRecaps` is
present:

1. `const { recap, folded } = foldPlayerRecaps(page.system.recap ?? "", entries)`
   where `entries = Object.entries(flag).map(([userId, html]) => ({ name: game.users.get(userId)?.name ?? userId, html }))`.
2. `await page.update({ "system.recap": recap, "flags.mej-campaign-companion.-=playerRecaps": null })`
   (a single update; if `folded === 0` the recap value is unchanged and
   only the flag is removed).
3. Per-page failures: `console.error` and continue. Final
   `console.log` with pages written and recaps folded. The version bump
   happens regardless.

Pure function, `scripts/logic/recap-migration.mjs`:

```js
/** @returns {{ recap: string, folded: number }} */
export function foldPlayerRecaps(recapHtml, entries) {
  const kept = entries
    .filter((e) => typeof e.html === "string" && e.html.replace(/<[^>]*>/g, "").trim().length)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!kept.length) return { recap: recapHtml, folded: 0 };
  const blocks = kept.map((e) => `<h3>Recap — ${escapeHtml(e.name)}</h3>${e.html}`);
  return { recap: `${recapHtml}${blocks.join("")}`, folded: kept.length };
}
```

`escapeHtml` is the same local helper `logic/doc-export-snapshot.mjs:40`
uses (extract it to `logic/html-escape.mjs` and import it from both
places); no Foundry import in `logic/`. The heading text is a fixed
English string baked into content, the same way imported docx headings
are; it is not localized at migration time. Stored player-recap HTML is
safe to append: every write passed the ProseMirror-schema sanitizer.

Whitespace-only or tag-only recaps are dropped, not folded.

## D. Knowledge panel collapses to a bar

`templates/knowledge-panel.hbs` gains, as the first child of
`section.mej-cc-knowledge`, a `header.mej-cc-knowledge-bar` containing a
chevron icon, the label `MEJCampaignCompanion.knowledge.title`
("Knowledge"), and a `span.mej-cc-knowledge-summary` rendering the
`summary` string `injectPanel` computes via
`knowledgeSummary({ tags: tags.length, attributes: attributes.length, backlinks: backlinks.length }, game.i18n.format.bind(game.i18n))`
(or the `empty` label when it is ""). The section carries
`class="mej-cc-knowledge collapsed"` when the client setting is true; CSS
hides `.mej-cc-knowledge.collapsed > details` and rotates the chevron.

Clicking the bar toggles the class and writes the setting. The three
inner `<details>` keep their own open/closed behaviour.

Client setting (`campaign-companion.mjs`):
`KNOWLEDGE_COLLAPSED_SETTING = "knowledgePanelCollapsed"`, `scope: "client"`,
`config: false`, `type: Boolean`, `default: false`. `injectPanel` reads
it on every render, so a re-render or reload keeps the state on every
sheet.

Pure function, `scripts/logic/knowledge-summary.mjs`:

```js
/**
 * Parts for the bar, in fixed order tags → attributes → mentions, zero
 * counts omitted. `format(key, count)` is the localizer (game.i18n.format
 * in production). Returns "" when every count is zero.
 * e.g. "3 tags · 1 attribute · 5 mentions"
 */
export function knowledgeSummary({ tags = 0, attributes = 0, backlinks = 0 }, format) {
  const parts = [
    [tags, "tags"], [attributes, "attributes"], [backlinks, "mentions"]
  ].filter(([n]) => n > 0)
   .map(([n, key]) => format(`${I18N}.knowledge.summary.${key}${n === 1 ? "One" : ""}`, { count: n }));
  return parts.join(" · ");
}
```

i18n follows the existing `sessionsDetected` / `sessionsDetectedOne`
convention (`lang/en.json:296-297`): `knowledge.summary.tags` =
"{count} tags", `knowledge.summary.tagsOne` = "1 tag", likewise
`attributes`/`attributesOne`, `mentions`/`mentionsOne`, plus
`knowledge.summary.empty` = "empty", which the template shows when the
function returns "". `I18N` is the existing constant from
`constants.mjs`.

Attributes counted are those the current user can see (the
`playerHidden` filter already applied in `injectPanel`).

## E. Verification, docs, release

**Unit (vitest):** `test/session-ownership.test.js` gains
`sessionEntriesNeedingOwnership` cases (below-owner with session page →
kept; already owner → dropped; non-session entry → dropped; missing
ownership → kept). New `test/recap-migration.test.js` (append order by
name; empty/tag-only entries dropped; no entries → unchanged recap,
folded 0; name escaped). New `test/knowledge-summary.test.js` (all
zero → empty; singular/plural; zero parts omitted). Player-recap tests
deleted.

**e2e (v14, World A, harness as-is):**

- `06-player-collab.spec.mjs` rewritten: (1) with `playersWriteSessions`
  on, a player-owned session's recap is edited by User 1 and the text is
  visible to User 2 and the GM; (2) a non-owner player sees the recap
  read-only (no pencil, no editor); (3) relayed image: a player without
  `FILES_UPLOAD` who owns the session drops an image, the GM relays the
  upload, the `<img>` renders in the shared recap for the GM. Settings
  restored in `afterAll` (pattern from spec 20's player-seat test).
- `19-reveal-migration.spec.mjs`: waits for dataVersion 6; new test seeds
  a session with a `playerRecaps` flag, resets `dataVersion` to 5,
  reloads the GM, asserts the recap contains the `<h3>Recap — <name></h3>`
  block and the flag is gone.
- `07-knowledge.spec.mjs`: new test — collapse the bar on one sheet, open
  another MEJ-typed sheet and assert it is collapsed, reload and assert
  it is still collapsed, expand and assert the setting flips back.
- New test for the setting's apply-existing dialog — see Deviations:
  the dialog is cancelled, the grant is exercised through
  `applySessionOwnership([ttEntry])` directly.
- New concurrent-edit test in `06`: two owning players open the recap
  editor at once, each types a distinct sentence, each saves; the
  persisted recap contains both sentences (fails without `collaborate`).
- Full v14 e2e run and the v13 stock gate (`npm run e2e:stock:v13`) as
  for 0.16.0. All specs `--trace off`; no `retries`/`waitForTimeout`;
  id-tracked cleanup only.

**Docs:** `docs/gm-guide.md` — Recap paragraph (one shared recap; players
edit when they own the entry), Player collaboration section (ownership,
the apply-to-existing dialog, the console-readability caveat), the
setting's description. `docs/player-guide.md` — the "Reading session
pages & writing your recap" section rewritten around editing the shared
recap (pencil appears when you own the session; otherwise ask the GM to
turn on Players Write Sessions). `CHANGELOG.md` 0.17.0 entry, including
the migration note. `docs/manual-test-checklist.md` rows updated if they
mention player recaps. `module.json` → 0.17.0.

## Deviations (found while planning, 2026-09-04)

- **MEJ never used Foundry's collaborative editor.** Core's text page
  editor sets `collaborate` on `<prose-mirror>`; MEJ's sheets (and
  `session.hbs`) do not, so today every recap save is a whole-form submit
  and two owners editing at once are last-writer-wins. To deliver the
  collaborative claim in §A: the recap `<prose-mirror>` carries
  `collaborate` **for owners only** (`{{#if owner}}collaborate{{/if}}` —
  MEJ activates its non-toggled editors at render for every viewer, and a
  non-owner's `pm.editDocument` join would be refused by the server and
  fail the activation). Session id is `${page.uuid}#system.recap`, managed
  by core.
- **Stale-field guard.** MEJ's `submitOnChange` form resubmits every
  field, so a submit triggered by the session-number input (or any
  non-recap control) carries whatever recap HTML was rendered into that
  client's DOM and silently overwrites a fresher recap. New
  `SessionSheet._prepareSubmitData` override: after `super`, delete
  `system.recap` unless the submit event's target is the
  `prose-mirror[name="system.recap"]` element, and delete
  `system.gmNotes` unless the target is
  `prose-mirror[name="system.gmNotes"]`. Pure decision
  `fieldsToStrip(targetName)` in `logic/session-submit.mjs`, unit-tested.
  Other form fields (session number, campaign date) keep MEJ's whole-form
  behaviour — they are not the shared document and two simultaneous
  editors of them is not a supported scenario.
- **Viewers see recap changes live.** MEJ re-renders the shell on
  `text.content`, ownership and its own flag keys, never on `system.*`.
  New `hooks/recap-refresh.mjs` (registered at init, `registerRecapRefresh`):
  on `updateJournalEntryPage` with `changes.system?.recap !== undefined`
  or `changes.system?.gmNotes !== undefined`, if the MEJ shell is
  rendered, its active tab shows that page, and no `.editor-parent.editing`
  exists inside the shell (never yank an editor out from under a local
  edit), call `shell.render({ tempOwnership: shell.tempOwnership, reload: true })`;
  a rendered popped-out sheet (`page._sheet?.rendered`, same editing
  guard on its element) gets `sheet.render(true, { reload: true })`. The
  gate (`shouldRefreshForRecap({ changes, activeEntityId, pageId, editing })`)
  is pure and unit-tested. In native/absent mode the hook is inert (no MEJ
  shell; popped-out branch only fires for MEJ sheets).
- **World A safety for the apply-to-existing dialog.** The e2e never
  confirms the dialog against the user's real world. §B's grant is split:
  `applySessionOwnership(entries)` (exported from
  `logic/session-ownership.mjs`'s Foundry-side sibling
  `hooks/session-ownership-apply.mjs`) does the `updateDocuments`; the
  `onChange` handler calls it after the confirm. The e2e (a) flips the
  setting on, asserts the dialog appears with a count ≥ 1, clicks **No**,
  and asserts a TT session's ownership is unchanged; (b) calls
  `applySessionOwnership([ttEntry])` directly and asserts OWNER. Every
  spec that turns the setting on (06 and the new test) dismisses the
  dialog with **No** immediately after `game.settings.set`.

## Out of scope

- Any change to MEJ (companion features never patch MEJ).
- Per-player private journals (MEJ's Notes tab already exists).
- Showing the knowledge panel as a tab on any sheet.
- Retroactively removing ownership when the setting is turned off.
