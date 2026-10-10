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
- Field parity with MEJ relationships (spec review, 2026-10-09): each side
  of a connection has its own label and secret, like MEJ's two reciprocal
  rows; secrets are visible to their writer and the GM until the writer
  reveals them; the block reuses MEJ's row markup and classes.
- Each side holds **one note per player** (option C): the connection
  author's note is the row's main label, other players' notes list beneath
  it.

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
    id,                        // foundry.utils.randomID()
    to: "JournalEntry.<id>",   // target entry uuid
    authorId: "<userId>",      // who created the connection
    authorName: "Dana",        // kept for worlds where authorId doesn't exist
    shared: true,              // default true; false = author + GM only
    created: 1760000000000,
    sides: {
      from: { notes: { [userId]: Note } },   // shown on the "from" entry
      to:   { notes: { [userId]: Note } }    // shown on the "to" entry
    }
  }
}

// Note
{ authorName: "Dana",
  label: "Sister of",    // plain text, trimmed, 0–200 chars
  secret: "",            // plain text, trimmed, 0–500 chars
  revealed: false,       // writer has revealed the secret to whoever sees the connection
  updated: 1760000000000 }
```

- The **row label** on a side is the connection author's note on that side
  (empty if they wrote none). Other players' notes on that side render
  beneath the row, each attributed.
- A note with both `label` and `secret` empty is deleted rather than stored.
- Creating a connection writes the author's `from` note (label required)
  and, optionally, their `to` note.
- Absent flag = no connections. No data migration, no dataVersion bump.
- Readers parse defensively: rows without a string `id` and `to` are
  skipped; notes that aren't objects are skipped; `label`, `secret`,
  `authorName` are coerced to strings; `shared` is `true` unless strictly
  `false`; `revealed` is `false` unless strictly `true`.
- Only the "from" end stores the record. The "to" end is found through an
  in-memory reverse index (§4.3).
- **Foreign author** (after an Omnipresence sync, a note's or the
  connection's user id matches no user in this world): a private connection
  is GM-only; a shared one stays party-visible, attributed to the stored
  `authorName`; foreign notes are read-only except for GM delete.
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

Within a visible connection:
- Every note's `label` is visible to everyone who sees the connection.
- A note's `secret` is visible to its writer and the GM; to others only
  when the writer has set `revealed`.
- Who may **write a note** on a side: the connection is visible to them,
  they have OBSERVER+ on that side's entry, and `playerConnectionsEnabled`
  is on. On a private connection only the author qualifies (plus the GM).
- A note is edited only by its writer. The GM may delete any note, and any
  connection.
- The connection author may toggle `shared` and delete the connection;
  deleting removes every player's notes on it, behind a confirmation that
  says how many notes by other players will go.
- Making a shared connection private keeps other players' notes stored but
  hides them (and the connection) from their writers until it is shared
  again; the share toggle confirms first when such notes exist.

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
  (GM-side checks, §5). Ops: `add`, `setShared`, `delete` (connection);
  `setNote`, `deleteNote`, `setRevealed` (a note on one side).
- `visibleNote(note, writerId, viewer)` → the note with `secret` blanked
  when the viewer may not see it (§3).
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
`{ action, requestId, op, fromUuid, connectionId, side, payload }` on the
companion socket; only `game.users.activeGM` handles it; the sender id comes
from the socket, never the payload; the reply is correlated by `requestId`;
the player side times out (same timeout as the existing relay). A GM writes
directly through the same `applyConnectionOp()` with no socket hop.

### 4.5 UI — `hooks/player-connections-ui.mjs`
Registered alongside `relationships-ui.mjs` on `renderEnhancedJournalSheet`
and `renderJournalPageSheet`. Appends a "Player connections" block to the
Relationships tab, built with MEJ's own relationship row markup and classes
(`.items-list` / `.item-list`, type-group headers, `.item-image.large`,
`.item-relationship` fields, `.item-controls`) so it reads as native:
- Rows grouped by target type under headers, like MEJ's list.
- Each row: target image and name (click opens it); the side's main label
  (the connection author's note) and, where visible, its secret with a
  Reveal/Hide button for its writer; a lock (private) or party (shared)
  icon; "by <author>" when it isn't the viewer's; reverse rows read
  "← Ilva".
- Beneath the row, other players' notes on this side: writer name, label,
  secret where visible, the writer's own Reveal/Hide, edit and delete.
- Inline fields are editable only by the note's writer and save on change
  (debounced) through the relay; everyone else sees text, not inputs.
- **Add a note** link on a row when the viewer may write one on this side
  and hasn't yet.
- Controls: the author gets the share toggle and delete; the GM gets delete
  on connections and notes.
- **Add connection** button (when §3 rule 3 holds).
- Drop listener on the block for non-GM viewers: accepts a JournalEntry
  (sidebar drag or content link); opens the dialog with the target filled in.
- All client-writable text (`label`, `secret`, `authorName`) is set via
  `textContent` or escaped, never parsed as HTML.
- Styling uses the readability ink tokens (`--mej-cc-ink`,
  `--mej-cc-ink-muted`, `--mej-cc-chip-bg`, …) on top of MEJ's classes.

### 4.6 Dialog — `apps/player-connection-dialog.mjs`
DialogV2 with: a search box filtering a list of eligible targets
(MEJ-typed entries the user sees at LIMITED+, type in the source sheet's
`allowedRelationships`, excluding the source entry and targets this author
already connected it to), the label for this side (required), an optional
label for the other side, an optional secret for each, and **Share with
party** (checked by default). Modelled on `actor-picker-dialog.mjs`. Later
edits happen inline in the block (§4.5), not in the dialog.

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
create connections"). Off hides Add connection, Add a note and the drop
target, and makes notes read-only; existing connections and notes still
display, and their writers can still delete them.

## 5. GM-side validation

`validateRequest` rejects, with a reason code returned to the player:
- `no-entry` — `fromUuid` doesn't resolve to a MEJ-typed page.
- `disabled` — `playerConnectionsEnabled` is off (`add`, `setNote`,
  `setRevealed`).
- `no-access` — sender lacks OBSERVER on the source entry, or LIMITED on the
  target.
- `type-not-allowed` — target type not in the source sheet's
  `allowedRelationships`.
- `self` — target is the source entry.
- `duplicate` — this author already has a connection from source to target.
- `bad-label` — label not a string or over 200 characters after trimming,
  or empty on `add`; secret over 500 characters.
- `no-access` also covers `setNote` when the sender may not see the
  connection, or lacks OBSERVER on that side's entry.
- `not-author` — `setShared`/`delete` by someone other than the connection
  author; `setNote`/`deleteNote`/`setRevealed` on a note the sender didn't
  write. The GM is excepted for `delete` and `deleteNote` only.
- `gone` — an op on a connection or note that no longer exists (treated as
  success for `delete`/`deleteNote`).
- `locked` — the source entry is in a locked compendium.

Writes use keyed paths — `"flags.mej-campaign-companion.playerConnections.<id>"`
for a new connection, `"….<id>.sides.<side>.notes.<userId>"` for a note,
`"….<id>.shared"`, and `-=` keys for deletes — never a whole-object
`setFlag`, so two players writing at once cannot overwrite each other.

## 6. Graph, doc export, Omnipresence

### 6.1 Graph
- `graphRowsFor` adds `playerConnections` (both directions, §3-filtered) to
  each row as a separate list.
- `buildGraph` emits `kind: "player"` edges. One line per pair of entries,
  with precedence GM relationship > player connection > link. A GM edge
  hidden from this viewer is not in their rows, so their player edge shows
  instead. Several player connections on one pair collapse into one edge.
  The tooltip lists, per connection, the author and both sides' main
  labels; other players' notes and all secrets stay out of the graph.
- `hub-graph-pane.mjs` styles `.mej-cc-graph-edge.player` (dotted, distinct
  colour) and adds a **Player connections** toggle beside the links toggle,
  default on. Applies to the Hub graph tab and the standalone graph.

### 6.2 Doc export
After the Relationships list, each entry's export gets a "Player
connections" list, `Mara — Sister of (by Dana)`, using this entry's side.
Other players' notes on that side are nested beneath it (`Jo: "half-sister,
actually"`); secrets follow as `Secret: …`.
- GM export with "include GM content": every connection, note and secret;
  private connections marked "(private)", unrevealed secrets included.
- Any other export: shared connections plus the exporting player's own
  private ones; secrets only when revealed or written by the exporter.

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
- `validateRequest`: every reason code, for every op.
- `visibleNote`: secret blanked/kept per writer, GM, `revealed`.
- `buildReverseIndex`: add, update, delete patching.
- `buildGraph`: `player` edges, precedence over links, GM edge wins, hidden
  GM edge → player edge for a player, collapse of several connections.
- `exportLines`: GM-include vs player perspective, per-side labels,
  nested notes, secret gating.

End-to-end (`tests/e2e/32-player-connections.spec.mjs`, v13 and v14), as
User 1 with a GM connected:
1. Add a connection via the dialog with both side labels and a secret: it
   appears on both ends with each side's label; User 2 sees the labels
   (shared default) but not the secret; the graph shows a `player` edge.
2. User 1 reveals the secret: User 2 now sees it.
3. User 2 adds a note on the "to" side: User 1 sees it under the row;
   User 2 can edit it and User 1 cannot.
4. Make it private: User 2 no longer sees it on either end or in the graph;
   the GM still does, with the author.
5. Drop an entry onto the block: dialog opens with the target filled in.
6. Tab visibility: an entry with only hidden GM rows and the setting off →
   no tab for User 1; setting on and OBSERVER → tab with the block.
7. Rejections: duplicate; a type not in `allowedRelationships`; User 2
   editing User 1's note.
8. GM deletes User 2's note, then the connection; both disappear for both
   players.
9. No GM connected: toast, nothing written.

`29-readability` extended to the new block and dialog in both schemes.

## 9. Out of scope

- Converting a player connection into a GM relationship.
- Revealing a note's secret to specific players or groups (reveal is
  all-or-nothing to whoever sees the connection).
- Notes on GM relationships (player notes attach to player connections
  only).
- Players editing or seeing GM rows beyond today's reveal rules.
- Doc **import** of player connections (doc import doesn't read
  relationships today).

## 10. Docs and release

README feature section, player guide section ("Recording connections"), GM
guide note (setting, moderation), CHANGELOG `## 0.25.0`. Released through
the tag-triggered `release.yml`.
