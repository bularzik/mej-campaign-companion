# Session Page Redesign (0.29.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Session page as a native-looking MEJ entry — compact header with thumbnail, attendee chips and a session button; Recap with a Table talk drawer that opens while live and folds afterwards; Details / Relationships / My Notes tabs; always-editable autosaving text; a one-click attendee checklist; and the knowledge rail reduced to a "Links (n)" folder tab — and ship it as 0.29.0.

**Architecture:** The module's existing split: pure decision modules under `scripts/logic/` (vitest-loadable, no Foundry imports) and thin Foundry glue in `scripts/sheets/SessionSheet.mjs`, `scripts/hooks/` and `scripts/apps/`. `templates/session.hbs` is split into partials (`session-header.hbs`, `table-talk.hbs`) so live changes (a new Table talk note, an attendee, the session state) patch those regions in place instead of re-rendering the sheet — that is what lets editors stay open permanently. Nothing patches MEJ; My Notes is saved through MEJ's own `saveUserData` socket action.

**Tech Stack:** Foundry VTT 14.368 (World A, port 30000) and 14.369 (World B, port 30001) with fork MEJ in api mode; Foundry 13.351 World B (port 30013) with stock MEJ 13.06 in native mode. Vitest unit tests in `test/*.test.js` (`npx vitest run`). Playwright e2e in `tests/e2e/` (`npx playwright test tests/e2e/<spec> --trace off`; v13: `FOUNDRY_TARGET=v13 …`). Handlebars templates, plain CSS with `--mej-cc-*` tokens.

**Spec:** `docs/superpowers/specs/2026-10-19-session-page-redesign-design.md` (same branch, `feat/session-page-redesign`). Section numbers below (§4.2 …) are that document's.

## Global Constraints

- Foundry 13.351 and 14.368/14.369; stock MEJ 13.06 (native mode) and the fork in api mode. `npm run e2e:stock:v13` must pass before release.
- Companion CSS is scoped under `.monks-enhanced-journal` and uses the `--mej-cc-*` tokens; 4.5:1 on all 16 MEJ backgrounds in both schemes (spec 29 is the floor; update selectors, never thresholds).
- The companion never patches MEJ. Companion-side wraps, DOM insertion, and MEJ's public socket action `saveUserData` only.
- Test documents are `TT-` prefixed and swept by the spec that creates them. Live e2e runs are time-boxed (one spec at a time, at most ~10 minutes each), never two Playwright invocations at once, always `--trace off`. Never touch module symlinks, the e2e lock file or the Foundry server by hand; never delete the owner's Radiant Citadel folder or timeline.
- No data migration and no `dataVersion` bump: new session flags (`startedAt`, `endedAt`) are optional and read with fallbacks (§4.2).
- One running session per campaign (`currentSession` on the campaign flag); never two.
- User-facing names, exactly: **Table talk**, **Recap**, **Details**, **Relationships**, **My Notes**, **GM Prep**, **Secrets & clues**, **Links**, **Notes that mention this**. No other visible string on the Session page or the rail may say "Notes" alone or "Knowledge".
- Hints, exactly: My Notes — "These notes can only be seen by you." ; no-GM save state — "Can't save until a GM connects".
- No Claude attribution in PR bodies or comments; no `git add -A`.

## Review Focus

1. **Typing while Table talk arrives.** A player is mid-sentence in the recap (or GM Prep, or My Notes) when another player's `/notes` lands → the text, caret and focus survive and the new note appears. Test: spec 40 test "typing survives a live note" (Task 7).
2. **Closing the window right after typing**, before any timer fires (the server's collaborative autosave does not save on last-leave) → the text is saved. Test: spec 40 test "close saves" (Task 7); unit `saveTriggers` close case (Task 7).
3. **Start on Session 9 while Session 10 is running** in the same campaign → one confirm; afterwards exactly one `currentSession` (Session 9), and Session 10 is `Ended` with `endedAt` set. Test: spec 40 test "starting a second session ends the first" (Task 2); unit `startStamp`/`sessionStatus` (Task 1).
4. **Reopening the attendee dialog after removing someone** → that character is unchecked, and confirming does not re-add them. Test: unit `attendeeChoices` "existing list wins" (Task 4); spec 40 attendee test step (Task 4).
5. **A player who was not in the audience of a "Showed image" note** → sees no row and no link for it, in Table talk and in the rail. Test: unit `noteLinkTarget` + existing audience filter, spec 40 player test (Task 5).

## Execution waves (owner-approved, 2026-10-20)

The tasks run as one chain in five waves. One implementer per wave works its tasks in order and commits per task; one fresh reviewer checks each wave's diff before the next wave starts.

| Wave | Tasks | Live e2e at the END of the wave only |
|---|---|---|
| 1. Logic | Task 1; the pure modules + unit tests of Tasks 3 (`sheet-ground`), 4 (`attendee-choices`), 5 (`note-link`), 7 (`editor-save`), 9 (`links-count`) | none |
| 2. Page structure | Tasks 2, 3, 6, 8 (remaining steps) | 40, 01, 35, 09, 29 |
| 3. Wiring | Tasks 4, 5, 9 (remaining steps) | 40, 31, 39, 07, 29 |
| 4. Autosave | Task 7 (remaining steps) | 40, 01, 06, 24, 34 |
| 5. Release | Task 10 | full vitest, `e2e:stock:v13` (+ cleanup), v13 spec 40, 29 |

Test policy: unit tests run freely. A task's "Run e2e" steps are **deferred to its wave's end**; there each listed spec runs once, one at a time. After a fix, rerun only the failing spec(s). A spec listed in a task but not in its wave's row still runs in that wave's end pass.

---

## File map

New:
- `scripts/logic/session-state.mjs` — `sessionStatus`, `startStamp`, `endStamp`, `sessionButton`, `elapsedLabel`.
- `scripts/logic/attendee-choices.mjs` — `attendeeChoices`.
- `scripts/logic/note-link.mjs` — `noteLinkTarget`.
- `scripts/logic/links-count.mjs` — `linksCount`.
- `scripts/logic/editor-save.mjs` — `saveTriggers`, `shouldPatchRegions`.
- `scripts/logic/sheet-ground.mjs` — `groundTone`.
- `scripts/apps/attendee-dialog.mjs` — `openAttendeeDialog(sheet)`.
- `scripts/sheets/session-regions.mjs` — `patchSessionRegions(sheet)`.
- `scripts/sheets/session-autosave.mjs` — `bindAutosave(sheet, html)`.
- `templates/session-header.hbs`, `templates/table-talk.hbs`.
- `test/session-state.test.js`, `test/attendee-choices.test.js`, `test/note-link.test.js`, `test/links-count.test.js`, `test/editor-save.test.js`, `test/sheet-ground.test.js`.
- `tests/e2e/40-session-page.spec.mjs`.

Modified: `scripts/sheets/SessionSheet.mjs`, `scripts/sheets/session-data.mjs`, `scripts/hooks/current-session.mjs`, `scripts/hooks/notes-entry.mjs`, `scripts/hooks/recap-refresh.mjs`, `scripts/hooks/knowledge-ui.mjs`, `templates/session.hbs`, `templates/knowledge-panel.hbs`, `styles/campaign-companion.css`, `lang/en.json`, `test/session-template-gates.test.js`, `test/knowledge-summary.test.js` (deleted with the module if unused), specs 01, 06, 07, 24, 29, 31, 34, 35, 39, `guide-screenshots.spec.mjs`, `docs/gm-guide.md`, `docs/player-guide.md`, `README.md`, `CHANGELOG.md`, `module.json`.

---

### Task 1: Session state rules (pure)

**Files:**
- Create: `scripts/logic/session-state.mjs`
- Modify: `scripts/sheets/session-data.mjs` (add `startedAt: null`, `endedAt: null` to `SESSION_DEFAULTS`)
- Test: `test/session-state.test.js`, `test/session-defaults.test.js`

**Interfaces:**
- Produces:
  - `sessionStatus({ startedAt, endedAt, isCurrent, hasTableTalk, recap }) -> "live" | "ended" | "notStarted"` — `isCurrent` wins; then any `startedAt`/`endedAt` → `"ended"`; then (legacy pages) `hasTableTalk || recap has visible text` → `"ended"`; else `"notStarted"`.
  - `startStamp(session, { now, worldDate }) -> object` — flag-path update for `flags.mej-campaign-companion.session.*`: sets `startedAt: now` only when `session.startedAt` is null; sets `campaignDate: worldDate` only when `session.startedAt` is null AND `session.campaignDate` is null AND `worldDate` is non-null; always clears `endedAt` (`null`). Returns `{}`-free object keyed by full flag paths.
  - `endStamp({ now }) -> { "flags.mej-campaign-companion.session.endedAt": now }`.
  - `sessionButton(status, isGM) -> { action: "startSession" | "endSession", labelKey: string } | null` — null when `!isGM`; live → end; ended → start with `labelKey` `…session.restart`; notStarted → start with `…session.start`.
  - `elapsedLabel(ms) -> string` — `"<1m"`, `"42m"`, `"1h 10m"`.

- [ ] **Step 1: Write the failing tests** in `test/session-state.test.js`:

```js
it("current wins over everything", () => expect(sessionStatus({ isCurrent: true, endedAt: 5 })).toBe("live"));
it("stamped pages", () => expect(sessionStatus({ startedAt: 1, endedAt: null, isCurrent: false })).toBe("ended"));
it("legacy page with table talk or recap is ended", () => {
  expect(sessionStatus({ hasTableTalk: true })).toBe("ended");
  expect(sessionStatus({ recap: "<p>Trapped in Vega's cavern</p>" })).toBe("ended");
});
it("empty recap markup is not a recap", () => expect(sessionStatus({ recap: "<p></p>" })).toBe("notStarted"));
it("first start stamps time and world date", () => {
  const u = startStamp({ startedAt: null, campaignDate: null }, { now: 100, worldDate: { year: 1492, month: 5, day: 14, hour: 20, minute: 0 } });
  expect(u["flags.mej-campaign-companion.session.startedAt"]).toBe(100);
  expect(u["flags.mej-campaign-companion.session.campaignDate"]).toEqual({ year: 1492, month: 5, day: 14, hour: 20, minute: 0 });
  expect(u["flags.mej-campaign-companion.session.endedAt"]).toBeNull();
});
it("a hand-entered date is kept", () => {
  const u = startStamp({ startedAt: null, campaignDate: { year: 3 } }, { now: 1, worldDate: { year: 1492 } });
  expect(u).not.toHaveProperty("flags.mej-campaign-companion.session.campaignDate");
});
it("restart changes neither startedAt nor the date", () => {
  const u = startStamp({ startedAt: 50, campaignDate: null }, { now: 100, worldDate: { year: 1492 } });
  expect(Object.keys(u)).toEqual(["flags.mej-campaign-companion.session.endedAt"]);
});
it("no calendar leaves the date alone", () => {
  expect(startStamp({ startedAt: null, campaignDate: null }, { now: 1, worldDate: null })).not.toHaveProperty("flags.mej-campaign-companion.session.campaignDate");
});
it("button", () => {
  expect(sessionButton("live", true)).toEqual({ action: "endSession", labelKey: "MEJCampaignCompanion.session.end" });
  expect(sessionButton("ended", true)).toEqual({ action: "startSession", labelKey: "MEJCampaignCompanion.session.restart" });
  expect(sessionButton("notStarted", false)).toBeNull();
});
it("elapsed", () => { expect(elapsedLabel(30_000)).toBe("<1m"); expect(elapsedLabel(70 * 60_000)).toBe("1h 10m"); });
```

Add to `test/session-defaults.test.js`: `sessionData` of a page with no flag returns `startedAt: null, endedAt: null`.

- [ ] **Step 2: Run** `npx vitest run test/session-state.test.js test/session-defaults.test.js` — expected FAIL (module missing).
- [ ] **Step 3: Implement** `scripts/logic/session-state.mjs` and the two defaults. "Visible text" = recap with tags stripped and whitespace trimmed is non-empty, or it contains an `<img`.
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `git add scripts/logic/session-state.mjs scripts/sheets/session-data.mjs test/session-state.test.js test/session-defaults.test.js && git commit -m "feat(session): pure session state, start/end stamps and first-start date"`

---

### Task 2: Start, restart and end (§4.2)

**Files:**
- Modify: `scripts/hooks/current-session.mjs` (`startSession`, `endSession`), `scripts/sheets/SessionSheet.mjs` (`onStartSession`, `onEndSession`), `lang/en.json`
- Test: `test/current-session.test.js` (if a pure helper is added), `tests/e2e/35-session-notes.spec.mjs`, `tests/e2e/40-session-page.spec.mjs` (create)

**Interfaces:**
- Consumes: `startStamp`, `endStamp` (Task 1); `currentWorldComponents()` from `scripts/logic/campaign-calendar.mjs`.
- Produces: `startSession(campaign, { sessionUuid })` writes `startStamp` onto the started page; `endSession(campaign)` writes `endStamp` onto the ended page and **shows no dialog** (the recap-draft confirm is removed; `recapDraft` stays for Task 6). New i18n keys under `MEJCampaignCompanion.session`: `restart` = "Restart", `replaceTitle` = "Start this session?", `replaceBody` = "End {other} and start {name}?".

- [ ] **Step 1: Write the failing e2e** `tests/e2e/40-session-page.spec.mjs` with `test.describe("40 session page")`, serial, creating `TT-40 Campaign` with two sessions `TT-40 S9`, `TT-40 S10` (follow spec 35's beforeAll/afterAll create-and-sweep pattern), and test **"starting a second session ends the first"**: start S10 from its sheet; start S9 from its sheet; confirm the dialog; assert the campaign flag's `currentSession.uuid` is S9's page uuid, S10's `session.endedAt` is a number, S9's `session.startedAt` is a number and its `campaignDate` equals the world components at start (read `currentWorldComponents` in-page). Then **"end shows no dialog"**: click End on S9; assert no `.dialog` opened within 1s and `currentSession` is unset.
- [ ] **Step 2: Update spec 35** test "End session offers the draft; appending writes the recap" → rename "End session asks nothing; the recap is unchanged" and assert the recap is unchanged after End (the append path moves to Task 6's test).
- [ ] **Step 3: Run** `npx playwright test tests/e2e/40-session-page.spec.mjs --trace off` — expected FAIL.
- [ ] **Step 4: Implement.** `startSession`: after resolving `page`, `await page.update(startStamp(sessionData(page), { now: Date.now(), worldDate: currentWorldComponents() }))` before `campaign.update(currentSessionUpdate…)`. `endSession`: `await page.update(endStamp({ now: Date.now() }))` then clear; delete the draft dialog block. `SessionSheet.onStartSession`: if `currentSession(campaign)` names another page, `DialogV2.confirm` with `replaceTitle`/`replaceBody`; on yes `await endSession(campaign)` then start; on no/close do nothing.
- [ ] **Step 5: Run** spec 40 and spec 35 — expected PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(session): start stamps, restart, one running session per campaign, silent end"` (add the touched files by name).

---

### Task 3: Header, tabs and MEJ ground (§4.1, §4.2, §4.3 tabs, §4.5 rename)

**Files:**
- Create: `templates/session-header.hbs`, `scripts/logic/sheet-ground.mjs`, `test/sheet-ground.test.js`
- Modify: `templates/session.hbs`, `scripts/sheets/SessionSheet.mjs` (`PARTS.templates`, `TABS`, `_prepareBodyContext`, `activateListeners`, `_disableFields`), `styles/campaign-companion.css`, `lang/en.json`, `test/session-template-gates.test.js`
- Test: `test/sheet-ground.test.js`, `test/session-template-gates.test.js`, spec 01, spec 29

**Interfaces:**
- Consumes: `sessionStatus`, `sessionButton`, `elapsedLabel` (Task 1).
- Produces:
  - Context `header = { status, statusLabel, elapsed, button, attendees: [{ uuid, name, img, player }], canManageAttendees, number, src }` built in `_prepareBodyContext`; `templates/session-header.hbs` renders it inside `<header class="mej-cc-session-header" data-cc-region="header">`.
  - `groundTone({ backgroundImage, isDarkScheme }) -> "light" | "dark"` — `"light"` unless `isDarkScheme` and `backgroundImage` contains no `url(`; a `url(...)` containing `parchment` is light.
  - The session root carries `data-mej-cc-ground="light|dark"`, set in `activateListeners` from the computed `background-image` of the nearest ancestor that paints one (walk up from the session root; stop at `.monks-enhanced-journal`).
  - Tab ids unchanged (`description`, `session`, `relationships`, `notes`); labels: `tabs.session` = "Details", `tabs.notes` = "My Notes". `session.gmNotes` = "GM Prep", `session.editGmNotes` removed with its button in Task 7.

- [ ] **Step 1: Write the failing unit tests.** `test/sheet-ground.test.js`: `groundTone({ backgroundImage: 'url("/ui/parchment.jpg")', isDarkScheme: true })` → `"light"`; `("none", true)` → `"dark"`; `("none", false)` → `"light"`. In `test/session-template-gates.test.js` replace the attendee-hint test (the list moves) with: `session.hbs` includes `{{> "modules/mej-campaign-companion/templates/session-header.hbs"}}` and no longer includes `hub-tonight.hbs` or `sheet-detailed-header.hbs`; keep the Secrets and GM-only gates (GM Prep keeps `{{#if @root.isGM}}`).
- [ ] **Step 2: Run** `npx vitest run test/sheet-ground.test.js test/session-template-gates.test.js` — expected FAIL.
- [ ] **Step 3: Implement the header.** One row: 56px thumbnail (`data-action="viewImage"` opens `src` in a local ImagePopout; with no `src`, a dashed `+` with `data-action="addImage"`; owners also get a small corner control with `data-action="addImage"` to change it — keep the existing hidden `img.mej-cc-compact-src[data-edit="src"]` value carrier), the name `<input name="name">` styled as a title, the meta line `#<number>` · attendee chips (Task 4 fills the control) · status chip (`live` green with `elapsed`, `ended` plain "Ended", `notStarted` none), and the GM button from `sessionButton`. Remove the `hub-tonight.hbs` include and `showHeader`/`showCompactHeader` branches; drop the now-unused `sessionHeaderContext` import if nothing else needs it. The elapsed label refreshes every 60s via a `setInterval` cleared when the header element leaves the DOM.
- [ ] **Step 4: Implement the ground and CSS.** Remove `.session-container` from the `background: var(--mej-cc-surface)` rule (other roots keep it). Add ink-token blocks for `.monks-enhanced-journal:not([background-image]) .session-container[data-mej-cc-ground="light"]` (the light-image token values) and `[data-mej-cc-ground="dark"]` (the dark-scheme values). Section headings inside `.session-container` use `font-size: var(--font-size-14)`; header layout per the mockup `a-live-vs-ended.html`.
- [ ] **Step 5: Run** the unit tests — expected PASS. Then update spec 01's "keeps rename + add-image in a compact row" and "an image-bearing Session renders MEJ's header" tests to target `.mej-cc-session-header` (rename input and add-image still work; an image-bearing session shows the 56px thumbnail and no `sheet-detailed-header`), and add `.mej-cc-session-header` and the Details labels to spec 29's in-shell selector list. Run `npx playwright test tests/e2e/01-session.spec.mjs --trace off`, then spec 29 — expected PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(session): MEJ-style header, Details/My Notes/GM Prep names, sheet follows MEJ's ground"`.

---

### Task 4: Attendees — chips, checklist dialog, drop anywhere (§4.6)

**Files:**
- Create: `scripts/logic/attendee-choices.mjs`, `scripts/apps/attendee-dialog.mjs`, `test/attendee-choices.test.js`
- Modify: `templates/session-header.hbs`, `templates/session.hbs` (remove `.attendees-section`), `scripts/sheets/SessionSheet.mjs` (`_dragDrop`, `addActor`, new action `manageAttendees`), `lang/en.json`, spec 31, spec 40
- Test: `test/attendee-choices.test.js`, spec 31, spec 40

**Interfaces:**
- Consumes: `contributorsOf(flag)` from `scripts/logic/campaigns.mjs`; `attendeePlayerName(actor, users)`.
- Produces:
  - `attendeeChoices({ contributorUserIds, users, current, actorOf }) -> { rows: [{ uuid, name, img, player, checked }], source: "contributors" | "allPlayers" | "none" }` where `users` are `{ id, name, isGM, characterUuid }`, `current` is the attendee uuid list, `actorOf(uuid) -> { name, img } | null`. Source = contributors' non-GM users with a `characterUuid`; if none, every non-GM user with one (`"allPlayers"`); if still none, `"none"`. Current attendees not in that list are appended. **Checked:** every row when `current` is empty; otherwise exactly the rows in `current`. Rows de-duplicated by uuid, source order kept.
  - `openAttendeeDialog(sheet) -> Promise<void>` — DialogV2 titled "Who's playing tonight?", checklist + a search input (Actors by name, top 10, picking one appends it checked), confirm label "Add {n} attendees" when `current` was empty else "Save attendees"; on confirm writes `flags.mej-campaign-companion.session.attendees` = checked uuids in row order. For `source: "allPlayers"` shows "No Contributors are set for this campaign, so all players' characters are listed."; for `"none"` shows "No player characters found — use search to add attendees."
  - `addActor(data)` additionally shows `ui.notifications.info("Added {name}")` (key `session.attendeeAdded`) and patches the header region (Task 7's `patchSessionRegions`; until Task 7 lands, `this.render()`).

- [ ] **Step 1: Write the failing tests** in `test/attendee-choices.test.js`:

```js
const users = [
  { id: "gm", name: "GM", isGM: true, characterUuid: null },
  { id: "u1", name: "Jeff", isGM: false, characterUuid: "Actor.a" },
  { id: "u2", name: "Glen", isGM: false, characterUuid: "Actor.b" },
  { id: "u3", name: "Sam", isGM: false, characterUuid: "Actor.c" }];
const actorOf = (u) => ({ name: u.slice(6), img: "x.webp" });
it("first use: contributors' characters, all checked", () => {
  const r = attendeeChoices({ contributorUserIds: ["u1", "u2"], users, current: [], actorOf });
  expect(r.source).toBe("contributors");
  expect(r.rows.map((x) => [x.uuid, x.player, x.checked])).toEqual([["Actor.a", "Jeff", true], ["Actor.b", "Glen", true]]);
});
it("existing list wins: a removed character stays unchecked", () => {
  const r = attendeeChoices({ contributorUserIds: ["u1", "u2"], users, current: ["Actor.a"], actorOf });
  expect(r.rows.find((x) => x.uuid === "Actor.b").checked).toBe(false);
});
it("guests already attending are kept and checked", () => {
  const r = attendeeChoices({ contributorUserIds: ["u1"], users, current: ["Actor.npc"], actorOf });
  expect(r.rows.at(-1)).toMatchObject({ uuid: "Actor.npc", checked: true });
});
it("no contributors falls back to all players", () => {
  expect(attendeeChoices({ contributorUserIds: [], users, current: [], actorOf }).source).toBe("allPlayers");
});
it("nobody has a character", () => {
  expect(attendeeChoices({ contributorUserIds: [], users: [users[0]], current: [], actorOf })).toEqual({ rows: [], source: "none" });
});
```

- [ ] **Step 2: Run** `npx vitest run test/attendee-choices.test.js` — expected FAIL.
- [ ] **Step 3: Implement** `attendeeChoices`, the dialog, and the header chips (portrait + name, remove `×` per chip using the existing `removeAttendee` action and its confirm; trailing control `+ Attendees` when empty, a pencil otherwise, both `data-action="manageAttendees"`, shown when `canManageAttendees` = `game.user.isGM || document.isOwner`). Move the attendee `DragDrop` `dropSelector` from `.attendees-list` to `.mej-cc-session-header, .tab[data-tab='description'], .tab[data-tab='session']`, and in `_onDropAttendee` return early (let the event pass) when `event.target.closest(".editor-parent, prose-mirror, .tab[data-tab='relationships']")`.
- [ ] **Step 4: Run** the unit tests — expected PASS. Update spec 31 to read attendee chips from `.mej-cc-session-header`; add spec 40 test **"attendee checklist"**: with two TT- users as contributors each assigned a TT- actor, open the dialog on an empty session → both checked; uncheck one, confirm → one chip; reopen → that one unchecked; confirm → still one chip; drag a third TT- actor onto the Recap tab's Table talk area → a third chip and an "Added" notification; drag one onto the Relationships tab → no new chip. Run specs 31 and 40 — expected PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(session): attendee chips, checklist dialog and drop-anywhere with feedback"`.

---

### Task 5: Note links (§4.3 reveal/media links, §4.7 session links)

**Files:**
- Create: `scripts/logic/note-link.mjs`, `test/note-link.test.js`
- Modify: `scripts/logic/tonight.mjs` (`streamRows` passes `link`), `scripts/hooks/knowledge-ui.mjs` (rail rows), `templates/knowledge-panel.hbs`, `scripts/sheets/SessionSheet.mjs` (actions `openNoteLink`), `scripts/hooks/knowledge-ui.mjs` click binding
- Test: `test/note-link.test.js`, `test/tonight.test.js`, spec 40

**Interfaces:**
- Produces: `noteLinkTarget(note) -> { kind: "image", src } | { kind: "entry", uuid } | null` — `ref.kind === "media"` with a `src` → image; `note.kind === "reveal"` with `mentions[0]` → entry `mentions[0]` (prefer `ref.pageUuid` when present); otherwise null. `streamRows` rows gain `link` (that value). Rail rows gain `sessionName`, `sessionUuid` (from `note.sessionUuid`'s page, null when unfiled or not visible).
- Template contract: the linked label is an `<a class="mej-cc-note-link" data-action="openNoteLink" data-kind="image|entry" data-target="…">`. Image → `new foundry.applications.apps.ImagePopout({ src }).render({ force: true })` (local; never `shareImage`). Entry → `fromUuid(uuid)` then `game.MonksEnhancedJournal.openJournalEntry` when present, else `doc.sheet.render(true)`. Rail row prefix: `<a data-action="openNoteSession" data-uuid="{{sessionUuid}}">{{sessionName}}</a> · time · author`.

- [ ] **Step 1: Write the failing tests:** `noteLinkTarget({ ref: { src: "a.webp", kind: "media" } })` → `{ kind: "image", src: "a.webp" }`; a reveal note `{ kind: "reveal", mentions: ["JournalEntry.v"], ref: { pageUuid: "JournalEntry.v.JournalEntryPage.p", kind: "block" } }` → entry with the page uuid; a reveal with no `ref.pageUuid` → entry `JournalEntry.v`; a player note → null. In `test/tonight.test.js`: `streamRows` rows carry `link`.
- [ ] **Step 2: Run** `npx vitest run test/note-link.test.js test/tonight.test.js` — expected FAIL.
- [ ] **Step 3: Implement**; the existing audience filter (`listNotes` → `visibleNotes`) stays the only gate, so no new visibility code.
- [ ] **Step 4: Run** the unit tests — expected PASS. Add spec 40 test **"note links"**: as GM in a live TT-40 session, Show Players an image to one TT- player only; the Table talk row's name opens an ImagePopout on the GM client and no `shareImage` socket is sent (spy `game.socket.emit`); as the other TT- player, the row is absent; open the TT-40 S9 rail on an entry the note mentions → its row starts with the session name and clicking it opens S9. Run spec 40 — expected PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(notes): reveal and media notes link to their image or entry; rail notes link to their session"`.

---

### Task 6: Recap tab and the Table talk drawer (§4.3)

**Files:**
- Create: `templates/table-talk.hbs`
- Modify: `templates/session.hbs`, `scripts/sheets/SessionSheet.mjs` (context `tableTalk`, actions `toggleTableTalk`, `addTableTalkToRecap`), `styles/campaign-companion.css`, `lang/en.json`
- Test: spec 35, spec 40, spec 29

**Interfaces:**
- Consumes: `sessionStatus` (Task 1); `recapDraft(notes, { formatTime })` from `scripts/logic/recap-draft.mjs`; `streamRows` rows with `link` (Task 5).
- Produces: context `tableTalk = { open, count, rows, canWrite, canAddToRecap, added }` rendered by `table-talk.hbs` inside `<section class="mej-cc-table-talk" data-cc-region="table-talk">`. `open` defaults to `status === "live"`; a user toggle overrides it for that sheet instance only (not persisted). `canAddToRecap` = recap editable and `count > 0`. `added` = `true` when the session flag `tableTalkAddedAt` ≥ the newest note's `at` (`addTableTalkToRecap` writes `flags.mej-campaign-companion.session.tableTalkAddedAt = Date.now()` after appending) — the link then reads "added ✓" and asks for confirmation before appending again.
- Strings: `notes.streamTitle` = "Table talk"; new `notes.addToRecap` = "add to recap", `notes.addedToRecap` = "added ✓", `notes.addAgainConfirm` = "These notes were already added to the recap. Add them again?", `notes.chatHint` = "players can also type /notes … in chat", `session.noRecap` = "No recap yet. Write one when the session ends, or build it from Table talk.".

- [ ] **Step 1: Write the failing e2e** in spec 40 — **"table talk opens while live, folds when ended"**: live S9 → `.mej-cc-table-talk` has the `open` class and the capture input is visible; End → collapsed, header shows `Table talk · <n>` and "add to recap"; click it → recap contains the first note's text and the link reads "added ✓"; click again → a confirm dialog appears. Move spec 35's draft-append assertions here.
- [ ] **Step 2: Run** spec 40 — expected FAIL.
- [ ] **Step 3: Implement** the partial and actions. Note rows: `time · author` muted (`--mej-cc-ink-muted`) then text at `--mej-cc-ink` (this is the fix for the near-black text), edit/delete per existing `canEdit`. While open and live, the drawer takes the remaining height (`flex: 1`) and the recap shrinks to content; while collapsed, the recap fills.
- [ ] **Step 4: Run** specs 40, 35, 29 (add `.mej-cc-table-talk` rows to 29's in-shell and player selector lists) — expected PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(session): Table talk drawer with permanent add-to-recap"`.

---

### Task 7: Always-editable text with autosave and in-place region updates (§4.4)

**Files:**
- Create: `scripts/logic/editor-save.mjs`, `scripts/sheets/session-autosave.mjs`, `scripts/sheets/session-regions.mjs`, `test/editor-save.test.js`
- Modify: `templates/session.hbs` (recap, GM Prep and My Notes editors: no `toggled`, no edit buttons; My Notes uses a module-owned editor block instead of MEJ's `sheet-notes.hbs` partial), `scripts/sheets/SessionSheet.mjs` (remove `onEditRecap`/`onEditGmNotes` bodies, `_documentControls` "edit" control now switches to Recap and focuses the editor, `_prepareSubmitData` keeps its stale-field guard), `scripts/hooks/notes-entry.mjs` (`refreshForNoteChange`), `scripts/hooks/recap-refresh.mjs`, `lang/en.json`, `styles/campaign-companion.css`
- Test: `test/editor-save.test.js`, `test/recap-refresh.test.js`, specs 01, 06, 24, 34, 40

**Interfaces:**
- Produces:
  - `saveTriggers(event) -> boolean` for the event names `"blur" | "tabchange" | "close" | "interval" | "visibilityhidden"` — true for all five; `"input"` → false. (Pins the trigger list in one place.)
  - `shouldPatchRegions({ isSessionSheet, editorActive }) -> boolean` — true for any Session sheet (its editors are always live), so callers patch instead of re-rendering.
  - `patchSessionRegions(sheet) -> Promise<void>` — re-runs `_prepareBodyContext`, renders `session-header.hbs` and `table-talk.hbs`, and replaces the `[data-cc-region]` elements in `sheet.trueElement`, rebinding their listeners. Never touches `.editor-parent`.
  - `bindAutosave(sheet, html) -> void` — for each editor: Recap (collaborative for owners) commits on the triggers by setting the element's `value` and dispatching its `change` (the path `commitGmNotes` already uses); GM Prep the same plus a periodic save every `game.settings.get("core", "editorAutosaveSecs")` seconds (clamp 30–300) while dirty; My Notes writes `flags.monks-enhanced-journal.<userId>.notes` directly when `sheet.isEditable`, otherwise via `game.MonksEnhancedJournal.emit("saveUserData", { documentId, userId, userdata: { notes } })` when `game.users.activeGM` exists, otherwise keeps the HTML in `NOTE_DRAFTS` under key `mynotes:<pageUuid>` and retries on `userConnected` of a GM. Each editor shows `.mej-cc-save-state` with "Saving…", "Saved", "Can't save until a GM connects" (`session.saveNoGM`) or "Couldn't save" (`session.saveFailed`).
  - The ProseMirror menu shows only while its editor has focus (CSS `:focus-within`).
- Callers: `refreshForNoteChange` and `registerRecapRefresh` call `patchSessionRegions` for a mounted or popped-out SessionSheet instead of `shell.render(...)` / `sheet.render(...)`; non-session views keep today's behaviour. Recap changes from another client arrive through the collaborative session; a GM Prep change from another GM updates `.editor-display` only when that editor is not focused and not dirty.

- [ ] **Step 1: Write the failing unit tests** in `test/editor-save.test.js` (the five triggers true, `"input"` false; `shouldPatchRegions({ isSessionSheet: true })` true, `({ isSessionSheet: false })` false) and update `test/recap-refresh.test.js` so `shouldRefreshForRecap` returns false for a Session page view (patched instead).
- [ ] **Step 2: Run** `npx vitest run test/editor-save.test.js test/recap-refresh.test.js` — expected FAIL.
- [ ] **Step 3: Implement** the three modules and the template/sheet changes. My Notes keeps the hint "These notes can only be seen by you." at full ink above the editor (`session.myNotesHint`). The header toolbar "edit" control keeps its id (MEJ expects it) but now calls a new `focusRecap` action.
- [ ] **Step 4: Run** the unit tests — expected PASS.
- [ ] **Step 5: Write the e2e** in spec 40: **"typing survives a live note"** — GM types into the recap (no click on any pencil), a TT- player client files `/note` into the live session; assert the GM's typed text, `document.activeElement` inside the recap editor, and the new Table talk row are all present. **"close saves"** — type into GM Prep, close the MEJ window immediately; reopen; assert the text persisted. **"My Notes without a GM"** — as a non-owner TT- player with the GM logged out, type into My Notes; assert "Can't save until a GM connects"; log the GM in; assert the flag is saved within 10s. Replace every `data-action="editRecap"` / `editor-edit` / `editGmNotes` step in specs 01, 06, 24, 34 and `guide-screenshots.spec.mjs` with clicking into the editor; the assertions stay.
- [ ] **Step 6: Run** spec 40, then 01, 06, 24, 34 one at a time — expected PASS.
- [ ] **Step 7: Commit** `git commit -m "feat(session): always-editable Recap, GM Prep and My Notes with autosave; live regions patch in place"`.

---

### Task 8: Details tab (§4.5)

**Files:**
- Modify: `templates/session.hbs` (`data-tab="session"` block), `styles/campaign-companion.css`, `lang/en.json`
- Test: `test/session-template-gates.test.js`, spec 01, spec 09, spec 29

**Interfaces:**
- Consumes: the GM Prep editor from Task 7; existing secret actions (`addSecret`, `openPrepBoard`, `secretAudience`, `deleteSecret`).
- Produces: Details tab = session number row; in-game date row (same five inputs, one line); `<details class="mej-cc-section" open>` **Secrets & clues (n)** with `+ add` and the prep-board link on its `<summary>`; `<details class="mej-cc-section" open>` **GM Prep** (GM only). `session.secrets` = "Secrets & clues". Players' gates unchanged.

- [ ] **Step 1: Write the failing template test:** in `test/session-template-gates.test.js`, the Details block contains `<details class="mej-cc-section"` twice for a GM, the Secrets `<summary>` contains `data-action="addSecret"` and `data-action="openPrepBoard"`, and the GM Prep section is inside `{{#if @root.isGM}}`.
- [ ] **Step 2: Run** `npx vitest run test/session-template-gates.test.js` — expected FAIL.
- [ ] **Step 3: Implement** the layout and CSS (summary at section-heading size, actions right-aligned on the summary line, clicks on the actions must not toggle the `<details>`: `event.preventDefault()` is not needed for buttons, but stop propagation to the summary).
- [ ] **Step 4: Run** the unit test, then specs 01, 09 and 29 one at a time — expected PASS (update selectors only where the section markup moved).
- [ ] **Step 5: Commit** `git commit -m "feat(session): compact Details tab with collapsible Secrets & clues and GM Prep"`.

---

### Task 9: Links rail — folder tab and renames (§4.7)

**Files:**
- Create: `scripts/logic/links-count.mjs`, `test/links-count.test.js`
- Modify: `templates/knowledge-panel.hbs`, `scripts/hooks/knowledge-ui.mjs`, `styles/campaign-companion.css`, `lang/en.json`; delete `scripts/logic/knowledge-summary.mjs` and its test if nothing else imports it
- Test: `test/links-count.test.js`, specs 07, 29, 39

**Interfaces:**
- Produces: `linksCount({ notes = 0, tags = 0, attributes = 0, backlinks = 0 }) -> number` (the sum). Tab text: `Links (n)` when n > 0, `Links` when 0 (class `empty` → fainter). Strings: `knowledge.title` = "Links", `knowledge.titleCount` = "Links ({count})", `notes.partyNotes` = "Notes that mention this". The tab keeps class `mej-cc-knowledge-tab`, `aria-expanded`, and the click/keyboard behaviour; the summary span and chevron are removed.
- Geometry: closed rail = a 22px edge (1.5px left border) with a folder tab ~24×96px, rounded on the right (`border-radius: 0 12px 12px 0`), vertical text, vertically centred at ~38% of the rail height. Open = today's widths.

- [ ] **Step 1: Write the failing tests:** `linksCount({ notes: 1, tags: 2, attributes: 0, backlinks: 2 })` → 5; `linksCount({})` → 0.
- [ ] **Step 2: Run** `npx vitest run test/links-count.test.js` — expected FAIL.
- [ ] **Step 3: Implement** and restyle (light and dark: the tab uses `--mej-cc-chip-bg`/`--mej-cc-ink`, and in dark-scheme no-image keeps the existing transparent-on-surface rule).
- [ ] **Step 4: Run** unit tests — PASS. Update spec 39 test 1 to assert the closed rail's bounding width ≤ 26px and the tab text matches `/^Links( \(\d+\))?$/`; spec 07's knowledge title assertions to "Links"; spec 29 already covers `.mej-cc-knowledge-tab`. Run 39, 07, 29 one at a time — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(links): rename Knowledge to Links with a single count and a folder-tab closed state"`.

---

### Task 10: v13 gate, docs, changelog, version, PR

**Files:**
- Modify: `docs/gm-guide.md`, `docs/player-guide.md`, `README.md`, `CHANGELOG.md`, `module.json` (version `0.29.0`, download/manifest unchanged pattern), `tests/e2e/guide-screenshots.spec.mjs` (re-shoot Session and rail shots)

- [ ] **Step 1: Run** `npx vitest run` — expected all PASS. Run `npm run e2e:stock:v13`, then `npm run e2e:stock:v13:cleanup` — expected PASS. Run `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/40-session-page.spec.mjs --trace off` — expected PASS.
- [ ] **Step 2: Update the guides** — every mention of the pencil/save flow for the recap, the "Notes" section, the Session tab, GM Notes, the Knowledge panel, and the end-session draft dialog, using the Global Constraints names. Run `npm run check:links` — expected PASS.
- [ ] **Step 3: CHANGELOG** `## 0.29.0 (<date>)` with Added / Changed / Fixed in the existing voice: Fixed must name the near-invisible Table talk text and the silent attendee drop.
- [ ] **Step 4: Commit** `git commit -m "chore: release 0.29.0"` and open the PR with `gh pr create` (title "Release 0.29.0: Session page redesign", body summarising §4.2–§4.7 and the test runs; no Claude attribution).

---

## Self-review notes

- Spec coverage: §4.1 → Task 3; §4.2 → Tasks 1–3; §4.3 → Tasks 5–6; §4.4 → Task 7; §4.5 → Tasks 3, 8; §4.6 → Task 4; §4.7 → Tasks 5, 9; §6 rules are record-only (no task); date default → Tasks 1–2.
- Ordering: Task 4 calls `this.render()` until Task 7 provides `patchSessionRegions`; Task 7 switches it.
