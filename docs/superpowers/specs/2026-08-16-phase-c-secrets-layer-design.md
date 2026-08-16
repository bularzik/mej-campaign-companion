# MEJ Campaign Companion — Phase C: Secrets Layer (design)

**Date:** 2026-08-16 · **Ships as:** `mej-campaign-companion` 0.3.0
**Predecessors:** Phase A (0.1.0), Phase B knowledge layer (0.2.0, `docs/superpowers/specs/2026-08-16-phase-b-knowledge-layer-design.md`)

## 1. Goal

Give the GM per-player and per-group control over what campaign knowledge each player has seen, and the tools to run a session from that knowledge: block-level secrets in journal content with targeted reveal, per-player reveal of hidden/secret relationships plus labeled graph edges, a campaign-wide secrets tracker, and a session prep board.

## 2. Constraints (binding)

- **Zero MEJ changes.** No new MEJ API surface, no libWrapper, no patches. Everything rides hooks the companion already consumes (`renderJournalPageSheet` shell hook, `renderEnhancedJournalSheet` for popped-out sheets, `updateJournalEntry`/`deleteJournalEntry`).
- **No circular imports:** MEJ modules are only ever dynamically imported inside the `setupMonksEnhancedJournal` handler, never from the static import graph of `campaign-companion.mjs`.
- **Soft-hidden trust model.** Secret text and reveal state live in document content/flags that replicate to any client that can see the document; hiding is client-side filtering, consistent with Foundry native secret blocks, MEJ GM notes, and the Phase A/B `gm:` conventions. Documented as a limitation in README (same posture as the media-relay senderId disclaimer). No server-enforced secrecy is claimed anywhere in UI or docs.
- **One audience semantics.** A single pure module defines the audience record and visibility resolution; secrets, relationships, tracker, prep board, and graph all consume it. No feature re-implements membership logic.
- **GM-only writes.** All reveal state is written by GM clients that own the documents; players never write reveal state and no new socket message types are added.
- **Reveal always whispers.** Every reveal action (block, checklist item, relationship) sends a chat whisper to the recipients with the revealed text and a content link. No setting to disable (YAGNI). Un-reveal updates state silently.

## 3. The reveal engine

`scripts/logic/reveal-state.mjs` (pure, unit-tested). The audience record, used everywhere:

```js
{ users: ["userId", …], groups: ["groupId", …], all: false, revealedAt: <ms> }
```

- `canSee(audience, userId, groups)` — true if `audience.all`, `userId ∈ audience.users`, or `userId` is a member of any group in `audience.groups`. Group membership resolves **live** against the current `playerGroups` setting: joining a group grants everything previously revealed to it; leaving revokes it. (Per-player multi-select is the tool for snapshot-style reveals.)
- Immutable add/remove helpers for users, groups, and `all`.
- `pruneReveals(revealMap, liveIds)` — drops records whose key is not in `liveIds` (orphan cleanup after content edits).

**Player groups:** world setting `playerGroups` = `[{id, name, members: [userId]}]`, GM-writable, managed from the Hub Secrets tab. Unknown group ids in an audience resolve to no members.

## 4. Storage

Companion-namespace flags on the owning JournalEntry (GM-written):

- `flags.mej-campaign-companion.secretReveals` — `{[sectionId]: audience}`, keyed by the native secret section's DOM id (ProseMirror assigns `secret-xxxx` on creation).
- `flags.mej-campaign-companion.relReveals` — `{[relationshipId]: {row?: audience, secret?: audience}}`. `row` reveals a `hidden` relationship row; `secret` reveals the relationship's secret label.
- Session checklist items (Phase A `{id, text, revealed, revealedAt}`) gain an optional `audience` field. `revealed: true` continues to mean revealed-to-all (backward compatible; no migration). An item with an `audience` and `revealed: false` is visible exactly to that audience; if both are set, `revealed: true` wins (everyone).
- Session entries gain a `prepNotes` flag (GM scratch text for the prep board), rendered to players never.

## 5. Block-level secrets

Authored with Foundry's **native secret blocks** (`<section class="secret" id="secret-…">`) — no new syntax; the editor's existing Secret button works unchanged, and Foundry's native all-or-nothing Reveal (`revealed` class) still means "everyone".

**Mechanics (verified against Foundry v14 client, `text-editor.mjs:133`):** `enrichHTML` with `secrets: false` *removes* `section.secret:not(.revealed)` from output, so players' rendered sheets never contain unrevealed blocks. Therefore:

- **GM render path** (knowledge-ui hook, all MEJ subsheets + popped-out sheets): overlay an audience button on each `section.secret` showing chips of who currently knows it; clicking opens the reveal dialog (player checkboxes, group checkboxes, "everyone" — the latter applies the native `revealed` class via the normal content update). A section without an id (hand-authored HTML) gets a disabled button with an explanatory tooltip.
- **Player render path:** only when this user has ≥1 reveal on the entry — take raw `page.text.content`, `enrichHTML(…, {secrets: true})`, remove every `section.secret` that is neither `.revealed` nor `canSee`-visible to this user, and swap the result into the sheet's content element. Otherwise native rendering stands untouched. Re-enrichment cost is paid only by users with reveals on that entry.
- **Live update:** the flag write fires `updateJournalEntry` on every client; the Phase B re-render wiring refreshes open sheets (GM chips and player content both).
- **Hygiene:** on entry update, `pruneReveals` drops records whose section id no longer appears in the content.

## 6. Relationship reveals and graph labels

MEJ relationships (`flags["monks-enhanced-journal"].relationships`, dict id→`{uuid, relationship, secret, revealed, hidden, …}`) already provide free-text labels, an all-or-nothing secret label, and a binary `hidden` row toggle. Phase C adds per-player/group granularity as a **companion overlay** — MEJ's own data is never modified:

- **Row reveal:** MEJ strips `hidden` rows for players. For rows revealed to this user via `relReveals[id].row`, the companion (reading the raw flag client-side) appends matching rows to the relationships tab list, marked with a "revealed to you" eye icon. If MEJ's list markup is not found (MEJ update changed the template), the rows fall back to a "Known connections" list in the knowledge panel — graceful degradation.
- **Secret-label reveal:** `relReveals[id].secret` shows the relationship's secret text under the row for that player.
- **GM UI:** an audience button per relationship row (same dialog as block secrets), injected next to MEJ's existing hide/reveal controls.
- **Graph edge labels (Phase B graph):** edges render the `relationship` text as a label. Visibility follows the viewer: players see labels only on edges visible to them (non-hidden, or row-revealed to them); secret labels render only for the GM or users the secret is revealed to. GM continues to see hidden edges dashed.

## 7. Secrets tracker (Hub tab)

A GM-only **Secrets** tab on the Campaign Hub (alongside Dashboards):

- Aggregates all three secret kinds: block secrets (from the index, §9), Session checklist items, and hidden/secret relationships.
- Each row: source entry (jump-to-source opens the MEJ tab), preview text, audience chips, quick reveal/unreveal buttons (opening the shared audience dialog).
- Filters: sheet type, revealed/unrevealed/partially revealed, and **"what does player X know"** — pick a player and see exactly the set of secrets visible to them.
- **Group management** lives here: create/rename/delete groups and edit membership (writes `playerGroups`).

## 8. Session prep board

`scripts/apps/prep-board-app.mjs` — an ApplicationV2 floating window bound to one Session entry, opened from a Session sheet header button or from the Hub. GM-only. Four zones:

1. **Attendees** (from the Session flag).
2. **Secrets/clues** — the session's checklist with one-click reveal (audience dialog; Lazy DM run-loop).
3. **Linked entries** — every entry the session's content @UUID-references (outbound refs from the Phase B backlink index), with mention badges; click opens the entry as an MEJ tab.
4. **Scratch notes** — plain textarea persisted to the `prepNotes` flag, 300 ms trailing-debounced autosave (same pattern as Phase B attributes).

Re-renders live on the shared update wiring.

## 9. Index integration

The scan pipeline (`search-index.mjs` / `live-index.mjs` / `field-extractors.mjs`) additionally extracts each entry's secret blocks as `record.meta.secrets = [{id, preview}]` (preview = first ~140 chars of the section's text). Access is GM-gated exactly like `gm:` fields — `meta.secrets` never reaches non-GM consumers through search, queries, badges, or the tracker. The tracker and prep board read from the index (lazy build reused), not by re-walking documents.

## 10. Reveal UX

On every reveal, the acting GM client sends a ChatMessage whispered to the resolved recipients (group audiences resolve to current members at send time): the enriched secret text plus a content link to the source entry. Whisper failure logs and never blocks the state write. Un-reveal is silent (no un-whisper — documented). Sheets update live for affected users via the replicated flag update.

## 11. Error handling

- Reveal UI renders only for GMs; reveal writes come from GM clients that own the documents — no new socket handlers, no new sender-trust surface.
- Orphan reveal records pruned on content update (§5); unknown group ids resolve to no members (§3); missing section ids disable the reveal button (§5).
- Docx export includes unrevealed secret content only under the existing GM-content opt-in; otherwise secret sections are excluded from export output.
- All render-hook work is wrapped observer-style: failures log and never block MEJ's own rendering.

## 12. Testing

- **Unit (vitest):** `reveal-state` (canSee truth table incl. live-group join/leave, add/remove helpers, prune), secret-block extraction into `meta.secrets`, checklist `audience`/`revealed` backward-compat, relationship overlay row/secret visibility, graph edge-label visibility, prep-board data assembly. Suite stays green (408 existing + new).
- **e2e (Playwright, two clients, TT- prefix):** GM reveals a block to player A → A sees block + whisper, player B sees neither; group reveal, then membership change → new member sees previously revealed secret; tracker "what does X know" + quick reveal; prep board checklist reveal round-trip. ~2 new spec files alongside the existing 9.

## 13. Out of scope

- Server-enforced (hard-hidden) secrecy, including per-secret "vault" sidecar documents.
- Preset relationship-type vocabularies and colored graph edges.
- Reveal history/audit log beyond `revealedAt`.
- Un-whisper / retraction messaging on un-reveal.
- Per-player reveal on non-MEJ (core) journal sheets; surfaces are the same as the Phase B knowledge panel.
