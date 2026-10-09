# Player Connections — design

Date: 2026-10-09. Status: sections 1–3 approved in chat; section 4 (errors
and testing, §7–§8 here) folded in for spec review. For `writing-plans`.
Target release: 0.25.0.

Decisions taken in chat:
- Visibility of a player's connection: shared with the party **by default**;
  the author may make it private (author + GM only).
- UI: a separate "Player connections" block in the Relationships tab, with
  an Add button **and** drag-and-drop (option A + drop).
- A connection shows from **both** ends, stored once.
- Storage travels with the journal entry (Omnipresence sync, doc export), so
  it lives in the "from" entry's flags, written through a GM relay.
- Allowed target types follow MEJ's per-sheet `allowedRelationships`.
- Player connections appear in the relationship graph.

Rule carried over: companion features never patch MEJ — every MEJ touch is a
companion-side wrap (`logic/mej-wraps.mjs`) or a render-hook injection.

## 1. Problem

Only a GM (or entry owner) can add relationships to an MEJ entry: MEJ binds
its relationship drop zone to `game.user.isGM || document.isOwner`
(`EnhancedJournalSheet.js:835-838`) and writes the entry's flag directly.
Players have no way to record what their characters believe connects people,
places and factions. Separately, MEJ removes the Relationships tab for a
non-GM only when the raw `relationships` flag is empty
(`EnhancedJournalSheet.js:228-232`), so a player whose every row is hidden
sees an empty tab, while a player who could contribute sees no tab at all.

GM relationships keep working exactly as today: hidden rows stay invisible to
players unless revealed (MEJ's toggle or the companion's `relReveals`
overlay).

## 2. Data model

On the "from" entry's MEJ-typed page (the page that carries MEJ's
`relationships` flag):

```js
flags["mej-campaign-companion"].playerConnections = {
  [id]: {
    id,                  // foundry.utils.randomID()
    to: "JournalEntry.<id>",   // target entry uuid
    label: "Sister of",  // plain text, trimmed, 1–200 chars
    authorId: "<userId>",
    authorName: "Dana",  // kept for worlds where authorId doesn't exist
    shared: true,        // default true; false = author + GM only
    created: 1760000000000
  }
}
```

- Absent flag = no connections. No data migration, no dataVersion bump.
- Readers parse defensively: rows without a string `id` and `to` are skipped;
  `label`/`authorName` are coerced to strings; `shared` is `true` unless
  strictly `false`.
- Only the "from" end stores the record. The "to" end is found through an
  in-memory reverse index (§4.3).
- **Foreign author** (after an Omnipresence sync, `authorId` matches no user
  in this world): a private row is GM-only; a shared row stays
  party-visible, attributed to `authorName`.
- **Unresolved target** (the `to` entry was deleted or never synced): the
  row renders for the GM only, marked unresolved, with delete — mirroring
  MEJ's defunct rows. Deleting the "from" entry removes its connections with
  it.

## 3. Visibility rules

A viewer sees a connection when all of:
1. They can see the entry the row is displayed on (LIMITED+ — MEJ already
   gates the sheet), and they have LIMITED+ on the other endpoint.
2. They are the GM, **or** the author (`authorId === user.id`), **or** the
   row is `shared`.

The GM sees every row with its author. Players see "by <author>" on others'
rows and no author line on their own.

### Relationships tab visibility (non-GM)

A companion wrap of `EnhancedJournalSheet.prototype._prepareTabs` replaces
MEJ's raw-row check for non-GMs. After MEJ's own logic (including its
per-sheet-type `shown: false` setting, which still wins), the tab is present
when any of:
1. the viewer can see ≥1 GM row (`visibleRelRows` with `relReveals`
   applied, target resolvable at LIMITED+);
2. the viewer can see ≥1 player connection, from either end;
3. the viewer **can add**: OBSERVER+ on the entry, the entry's type has a
   non-empty `allowedRelationships`, and the world setting **Players can
   create connections** (`playerConnectionsEnabled`, default `true`) is on.

Otherwise the tab is removed. This also fixes the "empty tab" case: a
LIMITED viewer, or any player when the setting is off, gets the tab only when
it has something they can see.

## 4. Components

### 4.1 Pure logic — `logic/player-connections.mjs`
- `normalizeConnections(flagValue)` → row array (defensive parse, §2).
- `canSeeConnection(row, { userId, isGM, knownUserIds, canSeeEntry })`.
- `validateRequest(op, payload, ctx)` → `{ ok } | { ok: false, reason }`
  (GM-side checks, §5).
- `buildReverseIndex(pages)` → `Map<toUuid, {fromUuid, row}[]>`.
- `exportLines(rows, perspective)` for doc export (§6.2).

### 4.2 Pure logic — `logic/rel-tab-visibility.mjs`
`relationshipsTabVisible({ isGM, visibleGmRows, visiblePlayerRows, canAdd })`.

### 4.3 Reverse index — `hooks/player-connections-index.mjs`
Built on `ready` from every journal page's `playerConnections`; patched on
`createJournalEntryPage` / `updateJournalEntryPage` /
`deleteJournalEntryPage` / `deleteJournalEntry`. Updates that arrive through
an Omnipresence sync go through the same hooks, so they appear without a
reload.

### 4.4 Relay — `hooks/player-connections-relay.mjs`
Same pattern as `entity-from-selection-relay.mjs`: the player emits
`{ action, requestId, op: "add"|"edit"|"delete", fromUuid, payload }` on the
companion socket; only `game.users.activeGM` handles it; the sender id comes
from the socket, never the payload; the reply is correlated by `requestId`;
the player side times out (same timeout as the existing relay). A GM writes
directly through the same `applyConnectionOp()` with no socket hop.

### 4.5 UI — `hooks/player-connections-ui.mjs`
Registered alongside `relationships-ui.mjs` on `renderEnhancedJournalSheet`
and `renderJournalPageSheet`. Appends the "Player connections" block to the
Relationships tab:
- Each row: target image and name (click opens it), label, direction
  (reverse rows read "← Ilva · Sister of"), lock icon (private) or party
  icon (shared), author (omitted on one's own rows).
- Controls: the author gets edit (label and shared), delete and a share
  toggle; the GM gets delete only. The target is not editable — delete and
  re-add.
- **Add connection** button (when §3 rule 3 holds).
- Drop listener on the block for non-GM viewers: accepts a JournalEntry
  (sidebar drag or content link); opens the dialog with the target filled in.
- All client-writable text (`label`, `authorName`) is set via
  `textContent` or escaped, never parsed as HTML.
- Styling uses the readability ink tokens (`--mej-cc-ink`,
  `--mej-cc-ink-muted`, `--mej-cc-chip-bg`, …).

### 4.6 Dialog — `apps/player-connection-dialog.mjs`
DialogV2 with: a search box filtering a list of eligible targets
(MEJ-typed entries the user sees at LIMITED+, type in the source sheet's
`allowedRelationships`, excluding the source entry and targets this author
already connected it to), a label field, and **Share with party** (checked
by default). Modelled on `actor-picker-dialog.mjs`. Edit mode reuses it with
the target fixed.

### 4.7 MEJ wrap
`_prepareTabs` wrapped through `mej-wraps.mjs` (libWrapper when active,
manual fallback otherwise), per §3. MEJ deletes the tab *inside* the wrapped
method, so the wrap works on its result: for a non-GM and the `primary`
group, it removes `relationships` when §3 says hidden, and when §3 says
visible but MEJ removed it for an empty raw flag, it restores the entry from
the parent class's `_prepareTabs(group).relationships` (the
pre-MEJ-filtering tab object). It never restores a tab the sheet-type
setting hid (`shown: false`). Subclasses that call `super._prepareTabs`
(SessionSheet, CampaignHubPage) inherit the behaviour.

### 4.8 Setting
`playerConnectionsEnabled` (world, boolean, default `true`, "Players can
create connections"). Off hides Add and the drop target; existing
connections still display and their authors can still delete them.

## 5. GM-side validation

`validateRequest` rejects, with a reason code returned to the player:
- `no-entry` — `fromUuid` doesn't resolve to a MEJ-typed page.
- `disabled` — `playerConnectionsEnabled` is off (add/edit only).
- `no-access` — sender lacks OBSERVER on the source entry, or LIMITED on the
  target.
- `type-not-allowed` — target type not in the source sheet's
  `allowedRelationships`.
- `self` — target is the source entry.
- `duplicate` — this author already has a connection from source to target.
- `bad-label` — not a string, or empty/over 200 characters after trimming.
- `not-author` — edit/delete by someone other than the author (GM excepted
  for delete).
- `gone` — edit/delete of an id that no longer exists (treated as success
  for delete).
- `locked` — the source entry is in a locked compendium.

Writes use keyed paths — `page.update({ "flags.mej-campaign-companion.playerConnections.<id>": row })`
and `"…playerConnections.-=<id>"` — never a whole-object `setFlag`, so two
players adding at once cannot overwrite each other.

## 6. Graph, doc export, Omnipresence

### 6.1 Graph
- `graphRowsFor` adds `playerConnections` (both directions, §3-filtered) to
  each row as a separate list.
- `buildGraph` emits `kind: "player"` edges. One line per pair of entries,
  with precedence GM relationship > player connection > link. A GM edge
  hidden from this viewer is not in their rows, so their player edge shows
  instead. Several player connections on one pair collapse into one edge
  whose tooltip lists each label and author.
- `hub-graph-pane.mjs` styles `.mej-cc-graph-edge.player` (dotted, distinct
  colour) and adds a **Player connections** toggle beside the links toggle,
  default on. Applies to the Hub graph tab and the standalone graph.

### 6.2 Doc export
After the Relationships list, each entry's export gets a "Player
connections" list, `Mara — Sister of (by Dana)`, with reverse rows phrased
from that entry's side.
- GM export with "include GM content": every connection; private ones
  marked "(private)".
- Any other export: shared connections plus the exporting player's own
  private ones.

### 6.3 Omnipresence
No Omnipresence change. The flag travels with the page; Omnipresence's link
rewriter localizes entry uuids inside flags, so `to` stays correct; a target
that wasn't synced renders unresolved (§2).

## 7. Error handling (player-facing)

- No active GM: the dialog stays open with its values, and a toast says a GM
  must be connected to save connections. Nothing is written.
- Relay timeout: toast "Couldn't save the connection — try again"; dialog
  stays open.
- Rejection: a localized toast per reason code (§5); dialog stays open on
  add/edit.
- Drop of something that isn't a JournalEntry or isn't eligible: a toast
  naming why, no dialog.
- Malformed flag rows (hand edits, old syncs) are skipped, never thrown on.

## 8. Testing

Unit (vitest, pure modules):
- `normalizeConnections`: malformed rows, defaults (`shared` true unless
  `false`), coercion.
- `canSeeConnection`: GM, author, shared, private, foreign author private vs
  shared, unresolved target.
- `relationshipsTabVisible`: each of the three rules, setting off, LIMITED
  viewer, MEJ `shown: false` still wins.
- `validateRequest`: every reason code.
- `buildReverseIndex`: add, update, delete patching.
- `buildGraph`: `player` edges, precedence over links, GM edge wins, hidden
  GM edge → player edge for a player, collapse of several connections.
- `exportLines`: GM-include vs player perspective, reverse phrasing.

End-to-end (`tests/e2e/32-player-connections.spec.mjs`, v13 and v14), as
User 1 with a GM connected:
1. Add a connection via the dialog: it appears on both ends; User 2 sees it
   (shared default); the graph shows a `player` edge.
2. Make it private: User 2 no longer sees it on either end or in the graph;
   the GM still does, with the author.
3. Drop an entry onto the block: dialog opens with the target filled in.
4. Tab visibility: an entry with only hidden GM rows and the setting off →
   no tab for User 1; setting on and OBSERVER → tab with the block.
5. Rejections: duplicate; a type not in `allowedRelationships`.
6. GM deletes a player's connection; it disappears for both players.
7. No GM connected: toast, nothing written.

`29-readability` extended to the new block and dialog in both schemes.

## 9. Out of scope

- Converting a player connection into a GM relationship.
- Secret labels or per-player reveal on player connections (the share
  toggle is the only visibility control).
- Players editing or seeing GM rows beyond today's reveal rules.
- Doc **import** of player connections (doc import doesn't read
  relationships today).

## 10. Docs and release

README feature section, player guide section ("Recording connections"), GM
guide note (setting, moderation), CHANGELOG `## 0.25.0`. Released through
the tag-triggered `release.yml`.
