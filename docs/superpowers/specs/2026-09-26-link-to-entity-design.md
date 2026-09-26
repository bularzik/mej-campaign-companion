# Link to Entity from Selection — design

Date: 2026-09-26. Status: approved in chat (matching = auto-link's rules
exactly, option 2; several matches = picker, option 1; one match = link
immediately, no dialog, no retro pass, option 1), for `writing-plans`.
Target release: 0.23.0.

Extends "Create Entity from Selection" (spec
`2026-09-22-entity-from-selection-design.md`); everything that spec says
about eligibility, selection capture, the source-HTML linker, the contributor
relay and outcome reporting still applies unless this spec says otherwise.

## 1. Problem

"Create Entity from Selection" always creates a new entity, even when the
selected text is already the name of one. A GM who selects "Vex" on a page
where the Person "Vex" already exists gets a second "Vex" — the wrong result —
when what they wanted was the selection linked to the existing entity.

## 2. User-facing behavior

1. Eligibility for the selection is unchanged (display mode, one block,
   1–80 trimmed characters, a linkable field, GM with an editable sheet or a
   campaign contributor with a GM connected).
2. The companion then looks for **matching entities** (§3).
   - **No match:** the menu shows "Create Entity from Selection", unchanged.
   - **One or more matches:** the menu shows **"Link to Entity"** (icon
     `fas fa-link`) **instead**; "Create Entity from Selection" is not shown.
3. Clicking "Link to Entity":
   - **One match:** links immediately, no dialog.
   - **Two or more matches:** opens a picker (§4.4) listing each match as
     `name — type label — folder name` (folder omitted when unfiled), in the
     order of §3's candidate list. Cancel or close does nothing.
4. Linking wraps the selected occurrence in the stored field HTML as
   `@UUID[<entity uuid>]{<raw selected source text>}` — the same edit Create
   makes, so the selection keeps its own casing. No entity is created, and
   no retro pass runs.
5. Outcome:
   - Linked: info toast `Linked the selection to {type} "{name}".` (the
     entity's type label and actual name), and the entity is added to the
     MEJ window as a background tab when the user can observe it — the same
     as after Create.
   - Occurrence no longer found (the page was edited while the picker was
     open, or the counts no longer agree): warning toast `Could not link the
     selection to "{name}"; the page text changed.` Nothing is written.
   - Rejected or failed: the existing `Could not create the entity
     ({reason})` error is **not** reused; link failures use
     `Could not link the selection ({reason}).` with the existing reason
     strings plus `bad-entity` ("that entity is not a match for the
     selection") and `link-failed` ("linking failed", used where Create
     would report `create-failed`: an unexpected throw on either path).
   - No GM answers a contributor's relayed request: warning `No GM
     responded; nothing was linked.`

## 3. Matching

A **candidate** is exactly what the typing-path auto-link would consider for
the field the selection is in (`hooks/auto-link.mjs`, `buildCandidates`):

- a JournalEntry for which `isLinkableEntity(entry, mejType)` is true;
- in the page's campaign link scope (`sameLinkScope`);
- passing audience containment: every non-GM user who can view the page's
  entry can also view the candidate (for a `gmOnly` region — session GM
  notes — every entity in scope passes);
- not the page's own entry; name at least 3 characters (`selectCandidates`).

Unlike auto-link, names carried by several candidates are **not** dropped
(`dropAmbiguousNames` is not applied): they are what the picker offers.

A candidate **matches** the selection when its normalised name equals the
normalised selection. Normalise = trim, collapse every whitespace run to one
space, lower-case (`toLowerCase`, no locale folding).

Consequences that are intended:
- A GM-only entity does not match on a player-visible page, so the menu
  shows Create there (auto-link's rule, chosen deliberately).
- For a contributor, every candidate is visible to them (they can view the
  page, so containment includes them), so the menu never reveals a hidden
  entity.

## 4. Components

### 4.1 Shared candidate builder

`buildCandidates(page, region)` moves out of `hooks/auto-link.mjs` into a new
`hooks/link-candidates.mjs` as `linkCandidates(page, region)`, returning the
`selectCandidates` output **before** `dropAmbiguousNames`. Auto-link calls
`dropAmbiguousNames(linkCandidates(page, region)).kept`, so its behavior is
unchanged. Each candidate carries `{ name, uuid }` as today.

### 4.2 Pure logic (`logic/entity-from-selection.mjs`)

- `normalizeEntityName(s)` → the §3 normal form (`""` for non-strings).
- `matchingEntities(text, candidates)` → the candidates (order kept) whose
  normalised name equals `normalizeEntityName(text)`; `[]` when the text
  normalises to `""`.
- `validateSelectionRequest(request, ctx)` accepts two modes. When
  `request.entityUuid` is present it must be a non-empty string, and
  `type`, `name` and `linkOthers` are not required or checked (link mode);
  otherwise the existing create-mode checks apply unchanged. The shared
  checks (requestId, pageUuid, fieldKey, occurrence/total, sender,
  contributor, visibility, region, selection) apply to both.

### 4.3 Writer (`logic/entity-from-selection-run.mjs`)

`runLinkSelection(request, deps)` with `request = { pageUuid, fieldKey,
text, occurrence, total, entityUuid, maskSecrets }` and deps extending
`pipelineDeps()` with `matchesFor(page, fieldKey, text)` → the §3 matches
computed now by the writing client:

1. `page = await deps.fromUuid(pageUuid)`; missing → `{ ok:false,
   reason:"page-missing" }`.
2. `entityUuid` not among `deps.matchesFor(page, fieldKey, text)` →
   `{ ok:false, reason:"bad-entity" }`. This re-check runs on the GM path
   too, not only the relay.
3. `linkSelectionInSource(<current field HTML>, { text, occurrence, total,
   uuid: entityUuid }, { maskSecrets })`; `null` → `{ ok:true, entryUuid,
   linked:false }`.
4. `page.update({ [fieldKey]: html })`; throw → log, `{ ok:true, entryUuid,
   linked:false }`; success → `{ ok:true, entryUuid, linked:true }`.

No `createMejEntry`, no `runRetroPass`.

### 4.4 Menu, picker, outcome (`hooks/entity-from-selection.mjs`, `apps/`)

- MEJ builds its context menu once per sheet, so labels are fixed. The wrap
  pushes **two** entries with complementary visibility: Create is visible
  when eligible and there are no matches; Link is visible when eligible and
  there is at least one match. Both carry the 14.368 and 13.351 spellings
  (`label`/`name`, `visible`/`condition`, `onClick`/`callback`) as today.
- Matches are computed from the stashed capture in `eligibilityFromCapture`,
  which gains a `matches` field (`matchingEntities(capture.text,
  linkCandidates(page, region))`, region = the one whose key is `fieldKey`).
- `startLinkFromSelection(sheet, target)` consumes the capture exactly as
  `startFromSelection` does, picks the single match or awaits the picker,
  then calls `runLinkSelection` (GM) or the relay (contributor) and reports
  with `showLinkOutcome`.
- Picker: `apps/link-to-entity-dialog.mjs`, `promptLinkTarget(matches)` →
  chosen uuid or `null`, a `DialogV2` with one `<select>`; option labels are
  HTML-escaped.

### 4.5 Relay (`hooks/entity-from-selection-relay.mjs`)

- The request payload's picked fields gain `entityUuid`.
- The GM handler, after `validateSelectionRequest` passes, dispatches on
  `entityUuid`: present → `runLinkSelection` (with `maskSecrets` computed as
  today), absent → `runEntityFromSelection`. The GM never trusts the
  payload's uuid: §4.3 step 2 recomputes the matches on the GM client.
- The late-result toast (after the requester's timeout) uses the link or
  create outcome reporter according to the pending request's mode.

### 4.6 Strings (`lang/en.json`, under `entityFromSelection`)

`menuLink` "Link to Entity"; `pickTitle` "Link to Entity"; `pickLabel`
"Entity"; `link` "Link"; `linked`; `linkedNot`; `linkFailed`; `noGmLink`;
`rejected.bad-entity`; `rejected.link-failed` — texts as in §2.

## 5. Out of scope

- Aliases or partial matches (e.g. "Vex's", "the Vex").
- Offering Create alongside Link, or Link alongside Create.
- A retro pass or "link other mentions" for the linked entity.
- Matching entities outside auto-link's scope/audience rules.

## 6. Testing

- **Unit (vitest):**
  - `normalizeEntityName` / `matchingEntities`: case, inner and outer
    whitespace, several matches returned in order, no match, empty text.
  - `validateSelectionRequest` link mode: valid; empty or non-string
    `entityUuid`; type/name not required; shared checks still enforced.
  - `runLinkSelection`: linked; occurrence gone → `linked:false`, no update;
    uuid not a match → `bad-entity`, no update; page missing; update throws
    → `linked:false`; never calls `createMejEntry` or `runRetroPass`.
  - Relay handler: link-mode payload runs the link writer; forged uuid
    → `bad-entity`; create-mode unchanged.
  - Auto-link unchanged: an existing auto-link test still drops ambiguous
    names after the builder move.
- **E2E (Playwright), World A (Foundry 14.368) and World B (13.351),
  `TT-` documents only, cleaned up:**
  - GM selects an existing `TT-` Person's name (different casing) on a
    player-visible page: the menu shows "Link to Entity" and not Create;
    clicking links the occurrence to that Person; the journal entry count is
    unchanged.
  - Two `TT-` entities with the same name: the picker opens; the chosen one
    is linked.
  - Text with no match: Create is shown, Link is not.
  - A GM-only `TT-` entity on a player-visible page: Create is shown.
  - Contributor (player) selects a matching name: Link through the GM relay
    succeeds.

## 7. Docs and release

- README, `docs/gm-guide.md`, `docs/player-guide.md`: the Create Entity from
  Selection section describes Link to Entity.
- `CHANGELOG.md`: `## 0.23.0` with an **Added** entry; `module.json`
  version `0.23.0`.
