# Party Relationships — design

Date: 2026-10-10. Status: sections 1–3 approved in chat. For `writing-plans`.
Replaces Player Connections (spec 2026-10-09, released in 0.25.0).

Decisions taken in chat:
- One Relationships list. MEJ's own list stays the UI; the separate
  "Player connections" block, its dialog and its GM relay are removed.
- A player-made relationship models the **party's belief**. GM rows are
  canon and never overwrite it; a GM reveal never overwrites it; players
  never edit GM rows.
- **One party row per entity pair**, editable by every writer (not one per
  player). No secrets, no private/shared toggle.
- Any writer may **delete** a party row (option A); re-adding is the
  recovery.
- **A label per side**, like MEJ's reciprocal rows (option A).
- Where a GM row and a party row exist for the same pair, they share **one
  line**: the GM label as today, the party label beneath it (option A).
- Adding: drop an entry on the tab, **or** an Add button whose picker asks
  for the target only. Every label is edited inline afterwards; nothing but
  the target is required.
- Writers are the campaign's **Contributors** (users and player groups, spec
  2026-09-22 §4.5), behind a seam the future membership feature replaces.
- No GM needs to be connected for any player action.
- No migration effort: 0.25.0 Player Connections data was test-only.

Rule carried over: companion features never patch MEJ — every MEJ touch is a
companion-side wrap (`logic/mej-wraps.mjs`) or a render-hook injection.

## 1. Problem

Players can't add to an MEJ entry's relationships: MEJ binds the drop zone
to `game.user.isGM || document.isOwner` (`EnhancedJournalSheet.js:835-838`),
and Foundry refuses a player's write to an entry they don't own. 0.25.0
answered this with a second UI fed by a GM relay. In use it read as a worse
copy of MEJ's list, required fields that shouldn't be required, and failed
outright with no GM online.

Making campaign members owners of the campaign's entries was considered and
rejected: an owner sees every secret block (`secrets: this.document.isOwner`,
`EnhancedJournalSheet.js:276`), can edit or delete entry text and GM rows,
and still has no per-pair party row.

The fix: store party rows in a document the party owns, and render them
inside MEJ's own list.

## 2. Storage

### 2.1 The party notebook
- One hidden JournalEntry per campaign, in the campaign's root folder,
  flagged `flags.mej-campaign-companion.partyNotebook = true`. Created on
  demand by the first party-row write (§2.4); existing campaigns need no
  migration.
- Skipped, like the portal and timeline documents, by: the campaign
  sidebar, auto-link candidates, link targets, doc export entry lists, doc
  import, the graph's entity nodes, the Hub index.
- Ownership: `default` = `partyReaders(campaign)` level (today the
  campaign's baseline, `baselineOwnership`); every user in
  `partyWriters(campaign)` gets OWNER; GMs as always.
- Travels with Omnipresence as an ordinary entry in the campaign folder.

### 2.2 Seams for future campaign membership
Membership (per-campaign members; players see only their campaigns) is a
planned future feature. To keep it a one-place change:
- `partyWriters(campaign, users, groups)` → user ids. Today:
  `isContributor` minus GMs.
- `partyReaders(campaign)` → ownership default level. Today: the baseline.
- Nothing else reads Contributors or the baseline for party rows. The
  ownership-sync hook (§4.4) only calls these two.

One notebook per campaign means each future party gets its own notebook by
construction.

### 2.3 A party row
On the notebook entry, `flags.mej-campaign-companion.partyRows`:

```js
partyRows[pairId] = {
  a: "JournalEntry.<id>",       // pairId = stable hash-free key: sorted a + "|" + b,
  b: "JournalEntry.<id>",       //   with "." and "|" replaced for a flag-safe key (§4.1)
  labels: { [uuid]: "Sister of" },  // per side, plain text, trimmed, 0–200, optional
  createdBy: "<userId>", createdName: "Dana",
  editedBy:  "<userId>", editedName:  "Jo",
  updated: 1760000000000
}
```

- One row per unordered pair. Adding Ilva→Mara when Mara↔Ilva exists does
  not create a row (§3.4).
- A row lives in the notebook of the campaign containing the entry it was
  added **from**. Readers merge rows from every notebook they can read.
- Unknown fields are preserved: writes are per-field keyed updates, never a
  whole-row or whole-flag `setFlag`, so later features (e.g. graph tags,
  §5.1) can add fields without this code dropping them.
- Readers parse defensively: rows without string `a` and `b` are skipped;
  labels coerced to strings; non-object labels map = `{}`.

### 2.4 Writes
Straight from the writer's client to the notebook, no relay:
- create row: `update({"flags.mej-campaign-companion.partyRows.<pairId>": row})`
- set label: `…partyRows.<pairId>.labels.<sideKey>` plus `editedBy`,
  `editedName`, `updated`
- delete row: `…partyRows.-=<pairId>`

If the campaign has no notebook yet: a GM creates it directly; a player's
first write asks the active GM through the existing companion socket to
create it (one-time, per campaign), then writes. With no GM online and no
notebook, the toast says the GM must open the world once with this
version; once a notebook exists, no GM is ever needed. The GM seat also
creates notebooks on `ready` for every campaign with at least one writer,
so in practice players never hit the request path.

### 2.5 Read and write rules
- **Read a row:** the viewer can read the notebook (at least OBSERVER, or
  the GM) and has LIMITED or higher on both `a` and `b`.
- **Write (add, edit, delete):** the viewer is GM or in
  `partyWriters(campaign)` of the notebook's campaign;
  `playerConnectionsEnabled` is on; LIMITED or higher on both entities;
  for add, the source entry is inside a campaign and the target's type is
  in the source sheet's `allowedRelationships`, and target ≠ source.
- Foundry enforces the write through notebook ownership; the client check
  only decides which controls render.
- The same pair in two notebooks (cross-campaign entities): both rows show,
  each line marked with its campaign name.

## 3. The single Relationships list

### 3.1 Tab visibility
The 0.25.0 `_prepareTabs` wrap (`hooks/rel-tab-wrap.mjs`) stays, with its
inputs retargeted. For a non-GM the tab is present (after MEJ's own
`shown: false` setting, which still wins) when any of: a visible GM row
(`visibleRelRows` with reveals); a readable party row with this entry on
one side; the viewer may add (§2.5 write rule for this entry).

### 3.2 Rendering
After MEJ renders its list, `hooks/party-relationships-ui.mjs` (registered
on `renderEnhancedJournalSheet` and `renderJournalPageSheet`) augments it:
- **Line with a GM row and a party row** for the same target: beneath MEJ's
  relationship field, a party line — party icon, the party label for **this
  entry's side**, "edited by <name>" in muted ink, delete control for
  writers.
- **Party-only pair:** an extra line in the target's type group (group
  header created if MEJ didn't render it), built with MEJ's row markup and
  classes (`.item-list`, `.item-image.large`, `.item-relationship`,
  `.item-controls`): target image and name (click opens), then the party
  line.
- **GM line without a party row:** writers see an empty party line reading
  "Party: add a label"; typing creates the row.
- Writers get an `<input>` for the label; everyone else gets text. Inputs
  save on change, debounced, straight to the notebook (§2.4). Empty labels
  are allowed.
- GM controls on GM rows are MEJ's, unchanged. The GM also gets writer
  controls on party lines.
- All row text is set via `textContent` or escaped, never parsed as HTML.
- Styling uses the readability ink tokens (`--mej-cc-ink`,
  `--mej-cc-ink-muted`, `--mej-cc-chip-bg`, …) on MEJ's classes.
- An unresolved target (deleted or unsynced) renders for the GM only,
  marked unresolved, with delete.

### 3.3 Adding
- **Drop:** a JournalEntry dropped on the tab by a writer who is not GM or
  owner is intercepted (MEJ would refuse it) and creates the party row. GM
  and owner drops reach MEJ unchanged and create a GM row.
- **Add button** at the foot of the list, for writers: a picker with a
  search box over entries the user sees at LIMITED or higher, whose type is
  in this sheet's `allowedRelationships`, excluding this entry. Choosing
  one creates the row, closes the picker, and focuses the new line's label
  input. Modelled on `actor-picker-dialog.mjs`.

### 3.4 Duplicates
If a party row already exists for the pair (in this campaign's notebook),
no row is created; the existing line is scrolled into view and its input
focused.

### 3.5 Errors
- Foundry permission refusal: toast naming it; no partial state.
- Dropped thing isn't a JournalEntry, or its type isn't allowed: toast
  naming why.
- No notebook and no GM online (§2.4): toast.
- Malformed rows are skipped, never thrown on.

## 4. Components

### 4.1 Pure logic — `logic/party-rows.mjs`
- `pairId(uuidA, uuidB)` → flag-safe key, order-independent.
- `normalizeRows(flagValue)` → row array (§2.3).
- `canReadRow`, `canWriteRow(ctx)` (§2.5).
- `rowsForEntry(uuid, notebooks)` → this entry's lines: `{ target, label,
  otherLabel, editedName, campaign }`.
- `exportLines(rows, uuid)` (§5.2).

### 4.2 `logic/party-access.mjs`
`partyWriters`, `partyReaders` (§2.2).

### 4.3 `logic/rel-tab-visibility.mjs`
Kept; inputs become `visibleGmRows`, `visiblePartyRows`, `canAdd`.

### 4.4 `hooks/party-notebook.mjs`
GM seat: create notebooks on `ready`; handle the one-time create request
over the companion socket; re-sync notebook ownership on campaign flag
updates (Contributors) and player-group setting changes, via §2.2.

### 4.5 `hooks/party-relationships-ui.mjs`, `apps/party-target-picker.mjs`
Per §3.

### 4.6 Removed
`apps/player-connection-dialog.mjs`, `apps/player-connections-block.mjs`,
`hooks/player-connections-ui.mjs`, `hooks/player-connections-relay.mjs`,
`hooks/player-connections-index.mjs`, `logic/player-connections.mjs` and
their tests and socket actions. The old `playerConnections` page flag is
ignored; no migration. The GM seat may delete stray old flags on `ready`
(one keyed `-=` update per page that has one), nothing more.

### 4.7 Setting
`playerConnectionsEnabled` kept as the key; label "Players can add party
relationships". Off: no Add button, no drop interception, no empty party
lines, labels read-only for players; existing rows still display.

## 5. Graph and doc export

### 5.1 Graph
- `graphRowsFor` adds each entry's readable party rows; `buildGraph` emits
  `kind: "party"` edges replacing `kind: "player"`. One line per pair;
  precedence GM relationship > party row > link; a GM edge hidden from the
  viewer yields to the party edge.
- Tooltip: both side labels and "edited by <name>".
- The **Player connections** toggle becomes **Party relationships**
  (default on), Hub graph tab and standalone graph.

Future graph work (planned, out of scope): select one entity to highlight
its neighbourhood; tag entities and relationships and filter the view by
tag. This design keeps that open by:
- giving every edge a stable identity: GM edges by MEJ relationship id,
  party edges by `pairId` plus notebook uuid, carried on the edge object;
- keeping filtering in the data layer (`graphRowsFor`/`buildGraph`), with
  the kind toggles as data filters, not CSS hiding, so tag filters slot in
  beside them;
- preserving unknown party-row fields (§2.3), so tags can be stored on a
  party row later without a schema change here.

### 5.2 Doc export
After each entry's Relationships list, a "Party relationships" list with
this entry's side: `Mara — Sister of (edited by Jo)`. Same for GM and
player exports, filtered by the read rule.

## 6. Testing

Unit (vitest, pure modules): `pairId` order independence and flag safety;
`normalizeRows` malformed input and unknown-field passthrough;
`canReadRow`/`canWriteRow` (GM, writer, non-writer reader, LIMITED gaps,
setting off, entry outside a campaign, disallowed type, self);
`partyWriters` via users and groups; `relationshipsTabVisible` three rules
plus `shown: false`; `rowsForEntry` merging two notebooks and side
selection; `buildGraph` party precedence, hidden-GM fallback, stable edge
ids; `exportLines`.

End-to-end (`tests/e2e/32-party-relationships.spec.mjs` replacing the 0.25.0
spec 32, v13 and v14). Notebook pre-created by the GM in setup; then the GM
disconnects so player steps run with **no GM online**:
1. User 1 drops an entry: line appears with empty label; types a label; it
   shows on both ends with the right side.
2. User 1 adds via the Add button: picker has only a search; row created,
   input focused.
3. User 2 edits User 1's label and sees "edited by" update; deletes the row;
   it is gone for User 1.
4. GM row + party row on one pair: one line, both labels.
5. Duplicate add focuses the existing line.
6. A non-Contributor sees party rows but no add/edit controls.
7. Graph shows a party edge.

`29-readability` retargeted to the party line and picker in both schemes.
Live runs limited to specs 32 and 29.

## 7. Out of scope
- Campaign membership (future; seam in §2.2).
- Graph highlight and tag filtering (future; hooks kept open in §5.1).
- Promoting a party row to a GM row.
- Doc import of party rows.
- Migrating 0.25.0 Player Connections data.

## 8. Docs and release
README feature section rewritten (Party relationships replaces Player
connections), player guide "Recording relationships", GM guide note
(Contributors control who can write; the notebook entry), CHANGELOG
Unreleased. Release through the tag-triggered `release.yml` when the user
says so.
