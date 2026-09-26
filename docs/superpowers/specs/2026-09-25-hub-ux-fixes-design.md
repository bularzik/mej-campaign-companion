# Hub UX fixes and 0.22.1 deferred minors — design

Date: 2026-09-25
Status: approved in chat, pending written-spec review
Release: 0.22.1 (rides on branch `fix/session-type-label`, PR #38)

## Scope

1. Hub pop-up menus dismiss like real menus.
2. The Hub's Timeline tab scrolls when its content exceeds the pane.
3. The Hub's Graph tab can be panned.
4. The three deferred minors from the session-type-label round:
   a. `sessionFlagPatch` reads the page's source, not the raw create data;
   b. Session pages created embedded in their entry are stamped;
   c. the flaky World A e2e tests (01 player-view, 23 campaign creation).

Out of scope: the 0.21.0 parked item (contributor selections inside
revealed secrets); MEJ-side issues (never patched from the companion).

## 1. Menus

The Hub has three pop-up menus, each rendered by a `{{#if …MenuOpen}}`
block and toggled only by its own button:

| Menu  | Template            | State flag      |
|-------|---------------------|-----------------|
| Tools | `hub-header.hbs`    | `toolsMenuOpen` |
| Type  | `hub.hbs` (Index)   | `typeMenuOpen`  |
| Sort  | `hub.hbs` (Index)   | `sortMenuOpen`  |

Behavior:

- A click anywhere outside an open menu **and** outside its trigger button
  closes it. The trigger button keeps toggling.
- **Escape** closes an open menu.
- Clicks inside a menu keep it open (multi-select Type checkboxes). Sort's
  existing close-on-choose stays.
- **Click-through is preserved.** An outside click that lands on another
  control (a tab, a Hub button) closes the menu and still performs that
  control's action. Therefore dismissal must not re-render the Hub before
  the click is handled: the listener runs on `click` in the bubble phase at
  `document`, clears the state flag(s), and removes the open menu element(s)
  from the DOM and sets the trigger's `aria-expanded="false"` — no
  `render()` call.

Structure:

- `scripts/logic/menu-dismiss.mjs` (pure): `openMenuKeys(state)` returns
  the keys of open menus; `dismissPatch(state, { insideMenuKey })` returns
  the state patch closing every open menu except the one the click was
  inside (`null` when nothing changes).
- Each menu and its trigger share a wrapper carrying `data-cc-menu="<key>"`
  (`tools`, `type`, `sort`), so "inside" is one `closest("[data-cc-menu]")`.
- One document-level `click` and one `keydown` listener, installed once per
  page load, act on the live Hub element and `HUB_STATE`; they no-op when
  no menu is open.

## 2. Timeline scrolling

`.mej-cc-hub .tab-inner` is `overflow: hidden`, and the timeline stacks
have no height bound, so tall content is clipped. Fix (CSS only): the
Timeline pane (`.mej-cc-hub .tab-inner.mej-cc-timeline`) gets
`overflow-y: auto`; its controls row is `position: sticky; top: 0` with an
opaque background so it stays visible. Works for a single long timeline and
for campaign scope with several stacks.

## 3. Graph panning

- Pointer-drag on the SVG **background** (not a node) pans by shifting the
  `viewBox` origin by the drag delta scaled by `viewBox width / clientWidth`,
  so panning tracks the pointer at any zoom.
- Cursor: `grab`, `grabbing` while panning.
- Node drag-to-pin, node click-to-open and wheel zoom are unchanged. A pan
  that ends over a node does not open it.
- `scripts/logic/graph-pan.mjs` (pure): `panViewBox(viewBox, dxPx, dyPx,
  clientWidth, clientHeight)` returns the new `[x, y, w, h]`.
- Listener bound once per SVG (same `dataset` guard pattern as zoom).
- A redraw still resets the view (unchanged behavior).

## 4. Deferred minors

a. `sessionFlagPatch(source)` takes the page's `_source`-shaped data; the
   `preCreateJournalEntryPage` hook passes `page._source`.

b. A `preCreateJournalEntry` hook walks `entry._source.pages` and, for each
   Session page lacking the MEJ type flag, applies the patch through
   `entry.updateSource({ pages })`. Covers `JournalEntry.create({pages})`,
   compendium import and duplication. Shares `sessionFlagPatch`.

c. Flaky tests: diagnose each failure's root cause, replace fixed
   `settle()` waits with waits on the real condition. A cause found in MEJ
   or Foundry is recorded in the report, not patched around.

## Testing

- Unit: `menu-dismiss`, `graph-pan`, `sessionFlagPatch` on `_source`, the
  embedded-pages patch builder.
- E2E (World A and World B): outside click closes each menu; an outside
  click on a tab both closes the menu and switches tab; Escape closes;
  timeline pane scrolls (`scrollHeight > clientHeight`, `scrollTop` moves,
  controls still visible); graph background drag changes the `viewBox` and
  opens nothing; `JournalEntry.create({pages:[session]})` yields the MEJ type
  flag. Flaky tests re-run repeatedly (`--repeat-each`) green.

## Docs and release

GM guide: one line on graph panning and menu dismissal where the Hub's
Graph tab and menus are described. CHANGELOG 0.22.1 gains the new Fixed
lines. Version stays 0.22.1.
