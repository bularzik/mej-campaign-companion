# GM notes commit on Foundry 13 — design

Date: 2026-09-20. Status: approved in chat (approach 1, design section), for
`writing-plans`. Parent: the 0.20.0 branch `feat/native-shell-shim`; this is
follow-up 7 of `docs/superpowers/triage/2026-09-19-v13-companion-sweep.md`
(cause I there).

## 1. Problem

`SessionSheet.onEditGmNotes` (`scripts/sheets/SessionSheet.mjs`) commits the
GM-notes editor by calling `editor?.save()` on the `<prose-mirror
name="system.gmNotes">` element when the pencil closes. That method is public
on Foundry 14.368 (`HTMLProseMirrorElement#save`, `foundry.mjs:97515`) and
private on Foundry 13.351 (`#save`, `foundry.mjs:72881`). On 13 the call
throws `TypeError: editor.save is not a function`, the `.editing` class is
never removed, and `system.gmNotes` never receives the text. The GM-notes
editor is **not** `toggled` (unlike the recap editor), so nothing else ever
saves it: the pencil is its only commit point. Reproduced by
`tests/e2e/06-player-collab.spec.mjs:328` on Foundry 13 + stock MEJ 13.06 in
every run; passes on Foundry 14 in api mode.

User decision (2026-09-20): keep the always-live editor (no `toggled`
conversion) and give the companion a commit that works on both generations.

## 2. Facts the design rests on (verified in both bundles)

| fact | Foundry 13.351 | Foundry 14.368 |
|---|---|---|
| `AbstractFormInputElement` `get value()` returns `this._getValue()` | `foundry.mjs:70325` | `:41252` |
| `set value(v)` calls `this._setValue(v)`, dispatches bubbling `input` then `change`, then `this._refresh()` | `:70329-70333` | `:41256-41260` |
| `HTMLProseMirrorElement._getValue()` returns the live serialized document while active, else the stored `_value` | `:72762-72765` | `:97393-97398` (also honours a `.source-editor` if one is open) |
| `_refresh()` returns early while the editor is active | `:72739` | `:97369` |
| `open` is always `true` for a non-toggled editor; `set open(false)` returns early for it | `:72678-72684` | `:97306-97312` |
| MEJ's form is submit-on-change; `SessionSheet._prepareSubmitData` derives the target field from `event.target.closest("prose-mirror").name` and `fieldsToStrip` (`scripts/logic/session-submit.mjs`) keeps that field | companion code, unchanged | same |

So assigning the live value back through the public setter reproduces exactly
what core's private save does for a non-toggled editor (`_setValue` +
`change`), with no private or protected access and no generation branch.

## 3. Design

### 3.1 Decision (pure)

New module `scripts/logic/gm-notes-commit.mjs`:

```js
/**
 * Whether the GM-notes editor's current value must be written back.
 * @param {unknown} live   the editor element's `value` (live content while active)
 * @param {unknown} stored the document's `system.gmNotes`
 * @returns {boolean} true only when `live` is a string that differs from `stored` (a
 *   missing/undefined `stored` counts as "")
 */
export function shouldCommitGmNotes(live, stored) {
  if (typeof live !== "string") return false;
  return live !== (stored ?? "");
}
```

### 3.2 Sheet handler

`SessionSheet.onEditGmNotes` replaces the `editor?.save()` line with:

```js
if (editing) {
  const editor = this.trueElement?.querySelector?.("prose-mirror[name='system.gmNotes']");
  commitGmNotes(editor, this.document?.system?.gmNotes);
}
```

where, in the same file:

```js
// Commit through the element's PUBLIC value property. `get value` is the
// live editor content while active (core's own _getValue), and `set value`
// stores it and fires the bubbling "change" that MEJ's submit-on-change
// form turns into a submit with this element as event.target - the same
// two steps core's private save() performs for a non-toggled editor. Public
// on both Foundry 13 and 14; save() itself is private on 13 (cause I).
function commitGmNotes(editor, stored) {
  if (!editor) return;
  try {
    const live = editor.value;
    if (shouldCommitGmNotes(live, stored)) editor.value = live;
  } catch (err) {
    console.error(`${MODULE_ID} | GM notes could not be saved`, err);
    ui.notifications.error(game.i18n.localize(`${I18N}.session.gmNotesSaveFailed`));
  }
}
```

The `.editing` toggle that follows is unchanged and runs regardless, so a
failure never leaves the editor hidden.

Doc comment on `onEditGmNotes` updated: it no longer says "call save()".

Note (final review, 2026-09-20): the comparison basis is the document's stored value, not the element's own `_value` as core's `save()` uses. They diverge only when the document is fresher than the rendered element (MEJ subsheets get no automatic re-render on document update), and then an idle pencil open/close writes the rendered HTML back where core would have been a no-op. Accepted: the field is GM-only, the stale-field guard already resubmits this always-active field on every other submit, and reading `_value` would mean a protected member.

### 3.3 Strings

`lang/en.json`, under `session`: `"gmNotesSaveFailed": "GM notes could not be
saved. See the console for details."`

### 3.4 Out of scope

- Converting the editor to `toggled` (user chose not to).
- The recap editor and `onEditRecap` (unchanged; it is toggled and commits
  through `open = false`).
- Ctrl+S / the editor's own save button on 13: those already reach core's
  private save through the keymap and remain as they are.

## 4. Behaviour on each generation

- Foundry 13: pencil close → live value read → differs → setter → `change` →
  submit → `system.gmNotes` written → re-render. Editor unchanged and inactive
  case: value equals stored → no write.
- Foundry 14: identical path. Previously `save()` also dispatched a `save`
  event first; nothing in the companion or MEJ listens to it. The setter also
  dispatches `input`; ApplicationV2 forms react to `change` only, so there is
  one submit, not two.

## 5. Testing and acceptance

Unit (`test/gm-notes-commit.test.js`): changed → true; unchanged → false;
stored undefined and live "" → false; stored undefined and live "x" → true;
live undefined/null → false.

E2E, both required green:

- Foundry 13, native mode, stock MEJ 13.06, world-b:
  `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off`
  — `:328` "GM notes commit on pencil close" passes; the file's only permitted
  failure is the known one-in-three `:231` teardown residual (sweep report,
  follow-up wave gates), which must not be masked by this change.
- Foundry 14, api mode, fork line, world-a:
  `npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off` — all
  tests pass (baseline).

`npm test`, `npm run check:links` clean.

## 6. Docs

- `CHANGELOG.md` 0.20.0: `**Fixed:** GM notes typed on Foundry 13 were never
  saved (the pencil's commit used a method that is private there).`
- Sweep report: cause I marked fixed with the commit; follow-up 7 closed.
