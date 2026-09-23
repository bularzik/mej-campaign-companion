# Create Entity from Selection — design

Date: 2026-09-22. Status: approved in chat (placement A = companion, linking
option 1 = reuse the retro pass, approach B = separate menu item, design
sections 1–4), for `writing-plans`. Target release: 0.21.0.

## 1. Problem

MEJ's "Extract to Journal Entry" (description context menu, and the Extract
header button on text pages; both end in the static
`EnhancedJournalSheet.splitJournal`) cuts the selected HTML out of the page
and moves it into a new plain `journalentry` titled from its first heading.
That suits extracting a passage. It is the wrong tool for the far more common
GM gesture of "this name I just typed should be an entity": the GM wants a
typed entity (Person, Place, …) named after the selection, the selection left
in place and turned into a link, and the other mentions of that name linked
too.

## 2. Scope and placement

- Lives entirely in mej-campaign-companion, per the standing rule that
  companion features never patch MEJ. MEJ's Extract item and header button
  are untouched and keep their behavior for every selection.
- A **new, separate** context-menu item, "Create Entity from Selection",
  added to MEJ's description context menu. The Extract header button gets no
  new behavior.
- Out of scope: edit mode (ProseMirror open), selections spanning blocks,
  selections containing or inside a link, a folder picker, seeding the new
  entity's body, the `session` type.

## 3. User-facing behavior

1. The GM selects 1–80 characters (after trimming) of text inside a single
   block of a page in **display mode**, right-clicks, and sees
   "Create Entity from Selection" beside MEJ's existing items. For any other
   selection the item is hidden.
2. A dialog shows:
   - **Type** — `<select>` in the import wizard's order minus `session`:
     journalentry, person, place, organization, quest, encounter, event, poi,
     shop, loot, list; labels from `game.MonksEnhancedJournal.getTypeLabels()`.
     Preselects the type chosen last time (client setting), else `person`.
   - **Name** — prefilled with the trimmed selection, editable, required
     (Create is refused on an empty trimmed name).
   - **Link other mentions** — checkbox, default checked.
3. On Create:
   - the entity is created in the **source entry's folder** (unfiled if the
     source is unfiled), with an empty body;
   - the selected text stays in place and becomes `@UUID[<new entry uuid>]{<selected text>}`
     — the label is always the original selected text, even if the name was
     edited;
   - if the box was checked, the retro-link pass runs for the new entity,
     honoring the `retroLinkMode` world setting (auto writes, confirm shows
     the usual review dialog, off does nothing);
   - the new entity opens as a **background tab** in the MEJ browser; the
     current page keeps focus. If the sheet has no `enhancedjournal` host,
     nothing is opened;
   - a toast confirms, e.g. "Created Person "Elara" and linked the selection."
4. Cancel/close: nothing is created or written.

## 4. Architecture

| Unit | Kind | Responsibility |
|---|---|---|
| `scripts/logic/entity-from-selection.mjs` | pure, no Foundry globals | `qualifySelection(text)` → trimmed name or `null`. `occurrenceIndex(textSegments, text, rangeStartOffset)` → zero-based index of the selection among eligible rendered matches. `linkSelectionInSource(sourceHtml, { text, occurrence, uuid })` → new HTML or `null`. |
| `scripts/apps/entity-from-selection-dialog.mjs` | `DialogV2` form | Renders type/name/checkbox; resolves `{ type, name, linkOthers }` or `null`. |
| `scripts/hooks/entity-from-selection.mjs` | glue | Installs the wrap, captures the selection, runs dialog → create → link → retro → open → toast. |
| constants + settings | config | `ENTITY_FROM_SELECTION_LAST_TYPE_SETTING` (client, string, default `"person"`), `SKIP_RETRO_LINK_OPTION`, i18n keys under `${I18N}.entityFromSelection.*` (en.json). |
| `scripts/data/mej-entry.mjs` | change | `createMejEntry` gains an optional trailing `createOptions = {}` passed to `JournalEntry.create(data, createOptions)`. Existing callers unchanged. |
| `scripts/hooks/retro-link.mjs` | change | The `preCreateJournalEntry` stamp handler takes `(entry, data, options)` and returns early when `options?.[MODULE_ID]?.skipRetroLink` is true. |

### 4.1 The wrap

`installWraps` (logic/mej-wraps.mjs) wraps
`EnhancedJournalSheet.prototype._getDescriptionContextOptions`
(libWrapper path `…EnhancedJournalSheet.prototype._getDescriptionContextOptions`
when libWrapper is active, manual patch otherwise). The wrapper calls the
original and appends one entry:

```js
{
  label: game.i18n.localize(`${I18N}.entityFromSelection.menu`),
  icon: '<i class="fas fa-user-plus"></i>',
  visible: (target) => canOfferFor(this, target),   // evaluated on each open
  onClick: (event, target) => startFromSelection(this, target)
}
```

MEJ builds the menu once per render and passes `visible` as a boolean; the
companion's entry uses the function form so eligibility is re-evaluated on
every open. The plan must confirm the function form (and the `onClick`
signature) on Foundry 13.351 and 14.x ContextMenu; if 13 needs `condition`,
supply both.

The class is reached the same way `scripts/sheets/SessionSheet.mjs` already
does (static import of MEJ's `sheets/EnhancedJournalSheet.js`). If the target
is not a function, `installWraps` warns and the feature is simply absent.
Because the companion's `SessionSheet` extends `EnhancedJournalSheet`, its
recap editor gets the item too; that is intended (recaps are a linkable
region).

### 4.2 `canOfferFor(sheet, target)`

True only when all hold:
- `game.user.isGM` and `sheet.isEditable`;
- the `.editor-parent` under the pointer is **not** in edit mode (no
  `.editing` class, no open `prose-mirror` inside it);
- `window.getSelection()` has exactly one non-collapsed range whose common
  ancestor is inside that `.editor-parent`'s display element;
- the range does not start or end inside an `a` element and contains none;
- the range's closest block ancestors (p, li, h1–h6, td, blockquote, div) of
  start and end are the same element;
- `qualifySelection(range.toString())` is non-null;
- the editor's field key (from the editor element's `data-editor-id` /
  name attribute mapped to a document path) is one of
  `linkableRegions(page).map(r => r.key)`.

### 4.3 Data flow on click

1. **Capture** `{ page, fieldKey, text, occurrence }` synchronously before
   the dialog steals focus. `text` is `range.toString()` trimmed; it is the
   default name, the link label, and the match text (see 4.4). `occurrence` is the zero-based index
   of this match among eligible matches in the rendered field: walk text
   nodes of the display element in document order, skipping text inside
   `a`, `code`, `pre`, and elements with `data-*` enricher output (inline
   rolls, content links); count case-sensitive occurrences of the trimmed
   text that start before the trimmed selection's start (the capture code
   collects the eligible text segments; the pure `occurrenceIndex` counts).
   The rendered skip set must mirror what `tokenizeHtml` treats as opaque in
   source (content links ↔ `@UUID[…]{…}`, `code`/`pre` ↔ same, inline rolls
   ↔ `[[…]]`); the plan verifies each pair against `tokenizeHtml` and the
   Foundry enrichers, and anything that cannot be mirrored is a mismatch
   (section 5), never a guess.
2. **Dialog** → `{ type, name, linkOthers }` or stop on null. Persist `type`
   to the client setting.
3. **Create**:
   `createMejEntry(type, name, "", {}, null, sourceEntry.folder?.id ?? null,
   { [MODULE_ID]: { skipRetroLink: true } })`. The stamp is always skipped
   here; step 5 decides whether the pass runs, so it can never race step 4.
4. **Link the selection**: re-read the page's current field value (not the
   captured one) and call `linkSelectionInSource(current, { text: trimmed,
   occurrence, uuid: entry.uuid })`. Non-null → one
   `page.update({ [fieldKey]: newHtml })`.
5. **Link others**: if `linkOthers`, `runRetroPass([entry])` (exported from
   hooks/retro-link.mjs; serialized with every other pass, mode from the
   setting). The selection is already a link, and auto-link treats existing
   links as opaque, so it is not linked twice.
6. **Open**: `sheet.enhancedjournal?.addTab(entry, { activate: false })`
   then `sheet.enhancedjournal.render()`.
7. **Toast** (info) with type label and name.

### 4.4 `linkSelectionInSource`

Uses `tokenizeHtml` from logic/auto-link.mjs so tags, entities, existing
`@UUID[…]{…}` / `@Type[…]` enricher syntax, and `<code>/<pre>` content are
handled the same way auto-link handles them (opaque, never matched). It
counts case-sensitive occurrences of the trimmed selection text in eligible
text segments, in order, with HTML entities decoded for matching; the Nth
(`occurrence`) is replaced by `@UUID[uuid]{text}` with the original encoded
source substring preserved around it. A match may not span a tag boundary
(the selection-in-one-block rule makes a within-block `<em>` span possible;
v1 returns `null` for that case rather than restructure markup). Returns
`null` when the Nth eligible occurrence does not exist.

## 5. Errors and edge cases

- **Rendered/source mismatch or match spans markup** → `linkSelectionInSource`
  returns `null`: the entity is still created, a warning toast says the
  selection could not be linked automatically, and step 5 still runs.
- **Page edited between click and Create** → step 4 plans against the
  fresh content; a vanished occurrence is the mismatch case.
- **Creation throws** → error toast plus `console.error`; nothing else has
  been written, so there is nothing to roll back.
- **Page update throws** → error toast; the entity remains (it is valid on
  its own) and step 5 is skipped.
- **Retro pass failures** are reported by the retro pass's own existing
  toasts; this feature adds nothing there.
- **Wrap target missing** (older/newer MEJ) → `installWraps` warning, feature
  absent, nothing else affected.
- **Same-named entity already exists** → allowed; the retro pass's existing
  ambiguity handling reports it. The selection link itself is unambiguous
  (it carries the uuid).

## 6. Testing

Unit (vitest, `test/entity-from-selection.test.js`):
- `qualifySelection`: empty, whitespace-only, exactly 80 / 81 trimmed chars,
  surrounding whitespace trimmed, embedded newline rejected, non-ASCII names.
- `linkSelectionInSource`: 1st / 2nd / Nth occurrence; occurrence inside an
  existing `@UUID[…]{…}` skipped; inside `<code>`/`<pre>` skipped;
  case-different match not counted; `&amp;` in the name; match spanning
  `<em>` → null; out-of-range occurrence → null; label is the selected text
  when the entity name differs.
- Retro preCreate hook: no `retroLinkPending` stamp when
  `options[MODULE_ID].skipRetroLink` is true; stamp unchanged otherwise.
- `createMejEntry` forwards `createOptions` to `JournalEntry.create`.

E2E (Playwright, companion `tests/e2e`, Foundry 14 + MEJ 14.x, TT- prefix):
1. Place description, select a short name, choose Person, Create → entity in
   the source folder, selection is a link to it, a mention on another page in
   the same campaign is linked (retro mode auto), background tab added, focus
   unchanged.
2. Checkbox unchecked → only the selection is linked.
3. Selection > 80 chars → item absent; MEJ's Extract still present and works.
4. Page in edit mode → item absent.
5. Last type is preselected on the next open.

Foundry 13.351 + stock MEJ 13.06: smoke case 1, or confirm the wrap target is
missing and the item is cleanly absent (record which).

## 7. Release

0.21.0: CHANGELOG entry, GM guide note (with screenshot of the dialog),
en.json strings. Usual companion ceremony: PR, merge, tag, release asset,
World A restart.
