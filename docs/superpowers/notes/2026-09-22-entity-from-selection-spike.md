# Spike: Foundry socket sender id and ContextMenu API (2026-09-22)

Throwaway probe for the entity-from-selection feature (Task 1). Scratch Playwright
scripts ran against the already-running test servers — Foundry 14.368 (`world-a`,
http://localhost:30000) and Foundry 13.351 (`world-b`, http://localhost:30013) —
via `tests/e2e/helpers/foundry.mjs`'s `login()`. Scripts lived under the session
scratchpad, never in `tests/`, and are not part of this commit. No persistent
documents were created; probe (d) reused pre-existing MEJ "person" pages that
User 1 can already observe (World A: "Barnaby"; world-b: "Omnipresence Test
Journal"). All browser contexts were closed at the end of every run.

## (a) Socket sender id — `game.socket.on(SOCKET, …)`

Probe: GM registers a listener on `module.mej-campaign-companion`; User 1 emits
`{ action: "__probe" }`; GM records `(...args)`.

**Foundry 14.368:**
```
args = [ '{"action":"__probe"}', "m3JcZcHUYV78DC0D" ]
game.user.id (User 1) = "m3JcZcHUYV78DC0D"
```

**Foundry 13.351:**
```
args = [ '{"action":"__probe"}', "pB7fn9jrf9IMwDdc" ]
game.user.id (User 1) = "pB7fn9jrf9IMwDdc"
```

On both versions, `args[1]` is the emitting user's id, supplied by Foundry's own
socket layer — not from the payload the client sent.

### Fix round 1: is `args[1]` actually spoof-resistant?

The original draft asserted this without evidence beyond the normal-path probe
above. Verified two ways.

**Empirical (from the User 1 seat, forging extra arguments):**
```js
game.socket.emit("module.mej-campaign-companion", { action: "__probe2" }, "FORGED_ID");
game.socket.emit("module.mej-campaign-companion", { action: "__probe3" }, "FORGED_ID", "X");
// also tried the lower-level manager socket (game.socket.io) and an explicit
// .call() through game.socket itself, with a third distinct forged id
game.socket.io.emit.call(game.socket.io, "module.mej-campaign-companion", { action: "__probe3-raw" }, "FORGED_ID_RAW");
game.socket.emit.call(game.socket, "module.mej-campaign-companion", { action: "__probe3-raw" }, "FORGED_ID_RAW");
```
GM's handler received, on **both** 14.368 and 13.351, for every one of these
attempts:
```
argCount: 2
args: [ "<payload JSON>", "<real User 1 id>" ]
```
`"FORGED_ID"`, `"FORGED_ID_RAW"`, and `"X"` never appeared anywhere in what the
GM received, regardless of how many extra arguments the client attached or
which client-side socket object was used to send them. `game.socket.io.emit`
(the lower-level manager) produced no event on the GM side at all — it does not
reach module socket handlers.

**Source (server-side, both 14.368 and 13.351 — identical logic, only variable
names differ under minification):**

`dist/packages/package.mjs`, `registerCustomSocket`:
```js
registerCustomSocket(e) {
  if (!this.socket) return;
  const t = `${this.constructor.type}.${this.id}`;   // "module.mej-campaign-companion"
  e.on(t, handleCustomSocket.bind(e, t))
}
```

`dist/server/sockets.mjs`, `handleCustomSocket` (14.368; 13.351 is the same
modulo minified variable names):
```js
export function handleCustomSocket(e, t, { recipients: o } = {}, s) {
  if (Array.isArray(o))
    for (let s of o) {
      const o = game.users.find(e => e.id === s);
      if (o) for (let s of o.sockets) s.emit(e, t, this.user.id)
    }
  else this.broadcast.emit(e, t, this.user.id);
  "function" == typeof s && s()
}
```
`e` (event name) and the handler itself are bound server-side at registration
time — the client cannot change what function runs. The handler's own
parameter list only ever reads the CLIENT's first argument (`t`, the payload)
and, if shaped like `{recipients: [...]}`, its second argument as delivery
options; any further client-supplied arguments (our forged strings) are never
bound to a parameter and are silently discarded — JavaScript doesn't expose
extra call arguments unless the function opts in with `arguments`/rest params,
and this one doesn't. The id appended to the broadcast, `this.user.id`, is the
**server's own socket-connection `.user`**, resolved once during the socket
handshake from the session cookie (`dist/server/sockets.mjs`, `activate()`:
`sessions.sessions.get(...)` → `e.user = s`) — never read from the emitted
message at all. There is no code path by which client-supplied data reaches
that position.

**Verdict: sender id: arg index 1 (last argument), both 13.351 and 14.368 —
CONFIRMED SPOOF-RESISTANT, empirically and from source.** A client cannot make
a forged value occupy that index: the server discards every argument past the
payload and always appends its own session-derived `user.id` as the final
argument. **Robust reading rule for Task 7: read the sender id as the LAST
argument of the handler call (`args[args.length - 1]`), not a hardcoded index
1** — in this relay, index 1 and "last argument" coincide today (exactly 2 args
are ever delivered: payload, then id), but reading it as "last" is the rule
that stays correct if a future Foundry version's `handleCustomSocket` ever
changes its own arity, since the id is always appended after whatever the
handler itself forwards. PASS. The gate condition in the task brief ("STOP if
the socket does not supply a trustworthy sender id") does not apply; proceeding
to Task 7 is safe on this front.

## (b) ContextMenu `visible`/`condition` and `onClick` signature

Probe: a detached host div with a `.probe-target` child, `new
foundry.applications.ux.ContextMenu(host, ".probe-target", [...], { fixed: true,
jQuery: false })`, right-click, then click the rendered menu item.

**Foundry 14.368** (`visible` as a function):
```
visibleArgs (t.className passed to visible(t)): "probe-target"
visibleCalled: true
onClick(e, t): e.type = "click", t.className = "probe-target context"
```
`visible` as a function works, and it is called with the target element (an
HTMLElement, since `jQuery: false`). `onClick(event, target)` receives both a
real click `Event` and the target element. Source-confirmed
(`client/applications/ux/context-menu.mjs`, 14.368): entries can use either
`visible` (current) or `condition` (deprecated, logs a compatibility warning);
either `onClick(event, target)` (current) or `callback(target, event)`
(deprecated). Menu item text is read from `"label" in item ? item.label :
item.name` — either key works.

**Foundry 13.351** (`visible` as a function is silently ignored — confirmed via
source, `client/applications/ux/context-menu.mjs` 13.351: the render loop only
ever reads `entry.condition`, never `entry.visible`):
```
visibleCalled: false          // "visible" function form never invoked
```
Retried with `condition`:
```
conditionArgs (t.className passed to condition(t)): "probe-target2"
conditionCalled: true
callback(t): t.className = "probe-target2"   // single argument, NO event
```
`condition` (function or boolean) works. `callback(target)` receives ONLY the
target element — confirmed from source
(`#onClickItem(event) { ... item?.callback(... this.#target); }`, no second
argument at all; v13 has no `onClick` support whatsoever, deprecated or
otherwise).

**Also discovered (matters for Task 6/7 entry definitions):** 13.351's menu-item
renderer reads `game.i18n.localize(item.name)` — `item.name`, never
`item.label`. An entry with only `label` renders with **blank/undefined menu
text** on 13.351 (confirmed live: the click-by-text-match failed until `name`
was added to the probe entry). **Any entry object built for both versions must
set both `label` and `name` to the same string** (harmless duplication on
14.368, required on 13.351).

**Verdict:**
- **visible: function (14.368) | condition (13.351)** — supply both keys
  (`visible` + `condition`, identical function) for cross-version safety, same
  pattern as `label`/`name`.
- **onClick signature: `onClick(event, target)` (14.368, current) |
  `callback(target)` (13.351, single arg, no event)** — supply both `onClick`
  and `callback` keys; write `callback` as `(target) => …` and don't rely on a
  second argument being present.

## (c) Does `window.getSelection()` survive a right-click?

Tested two ways on 14.368: (1) clicking the center of the `.probe-target` div's
bounding box, (2) clicking the exact center of the **selection's own** rendered
client rect (`getSelection().getRangeAt(0).getClientRects()[0]`) — to rule out
the click landing outside the glyph's actual paint area within a larger div.
Both gave the same result:
```
selAtVisible: ""   (14.368, both click-targeting strategies)
selAtCondition: "" (13.351)
```

**Verdict: selection survives: no (both versions, as exercised by Playwright's
synthetic mouse events).** `window.getSelection()` is empty by the time
`visible`/`condition` runs. Caveat: this was exercised via Playwright's
`locator.click({ button: "right" })`, which drives real mousedown → mouseup →
contextmenu through Chromium; a real user's physical right-click may behave
differently in some browsers (Chromium's own default is to preserve a selection
when the mousedown lands inside it), and this probe did not isolate whether the
loss happens at Playwright's mousedown simulation specifically or is genuine
Chromium behavior for this markup. **Task 7 must not assume the live selection
is readable inside `visible`/`condition`/`onClick`** — any text the entry needs
must be captured on an earlier, definitely-live event (e.g. `mousedown` or
`contextmenu` capture-phase, before the menu's own handler runs) rather than
inside the ContextMenu entry's own callbacks.

## (d) Does MEJ's description ContextMenu open for a non-GM user when only our entry is visible?

Probe: as User 1 (non-GM), opened an MEJ "person" page's sheet, then in the
console patched `EnhancedJournalSheet.prototype._getDescriptionContextOptions`
to append one extra entry (`visible: () => true` / `condition: () => true`,
both `onClick`/`callback` set), closed and reopened the sheet (see gotcha
below), then right-clicked `.editor-parent[data-editor-id="description"]`.

**Two gotchas hit while building this probe (not present in the brief, recorded
for Task 6/7):**
1. `page.sheet.render(true)` alone opens Foundry's **core**
   `JournalEntryPageProseMirrorSheet` for a "person"/"place"/… page whose MEJ
   type lives in `flags["monks-enhanced-journal"].type` (this world's pages are
   on the legacy flag-based typing, not `page.type`) — no `.editor-parent`
   markup at all. MEJ's own open path
   (`EnhancedJournalSheet.js` ~1707) calls
   `game.MonksEnhancedJournal.fixType(page)` first, which patches the in-memory
   type so the correct MEJ sheet class resolves. **Any code that opens a page
   sheet programmatically (Task 6/7 included) must call `fixType()` first.**
2. Patching the prototype **after** a sheet is already open and then merely
   re-rendering it in place (`sheet.render(true)`) leaves a **stale**
   `ContextMenu` instance bound to the same delegated root alongside the fresh
   one (each `_onRender` calls `_contextMenu(html)` again without tearing down
   the previous binding). The two raced on the ContextMenu class's own
   open/close toggle (it adds a `context` class to the target while open and
   treats a second right-click on an already-`context`-classed target as a
   close): the *first* (stale, unpatched) instance opened/closed first and left
   the target's `context` class set, so the *second* (patched) instance's
   handler saw that class and immediately called `close()` instead of ever
   rendering — net effect, right-click did nothing observable. **Fix used:**
   `await sheet.close()` then reopen fresh, so exactly one `ContextMenu`
   instance is ever bound. This is purely a probe-methodology artifact — Task
   6/7's wrap will patch the prototype once, before any sheet is ever
   constructed, so it won't hit this.

With that fixed, on **both** 14.368 and 13.351:
```
openInfo.isGM: false
directCheck (options returned): ["Show in Chat" (hidden, GM-only),
                                  "Extract to Journal Entry" (hidden, GM-only),
                                  "Probe" (visible)]
menuState: { menuPresent: true, items: ["Probe"] }
probeClicked: true
```

**Verdict: player menu opens: yes (both versions)** — MEJ's built-in description
entries are already GM-gated (`visible`/`condition: game.user.isGM`), so a
non-GM client sees *only* whatever additional entries an injected/wrapped
`_getDescriptionContextOptions()` marks visible for them. The menu renders and
the injected entry's `onClick`/`callback` fires correctly for a non-GM user.

## (e) `.editor-parent` edit-mode marker

Probe: as GM, opened an MEJ text-entry ("person") sheet, recorded
`.editor-parent[data-editor-id="description"]`'s class/attributes and whether a
`<prose-mirror>` child exists/has a distinguishing class, clicked
`.editor-parent .editor-edit`, recorded again, then closed the sheet without
saving.

**Foundry 14.368:**
```
before: class="flexcol editor-parent"          (no "editing")
after:  class="flexcol editor-parent editing"  ("editing" added)
<prose-mirror> present before AND after, class "editor prosemirror active" unchanged both times
```

**Foundry 13.351:** identical —
```
before: class="flexcol editor-parent"
after:  class="flexcol editor-parent editing"
<prose-mirror> present before and after, class unchanged
```

Source-confirmed in `EnhancedJournalSheet.js` (`onEditDescription`, both
versions): `$(".editor-parent[data-editor-id='description']", ...)
.toggleClass("editing", !editing)`.

**Verdict: edit-mode marker: `.editor-parent.editing` (both 13.06 and 14.x)** —
Task 6's `displayFor` assumption (`.editing`) is correct as written; no change
needed. The `<prose-mirror>` element itself is present regardless of edit state
and does not gain/lose a class on toggle, so it is not a usable edit-mode signal
on its own.

## Summary verdict lines

- **sender id:** arg index 1, i.e. the LAST argument (both 13.351 and 14.368) —
  confirmed spoof-resistant empirically (forged extra client args never reach
  the handler; discarded server-side) AND from source
  (`handleCustomSocket`/`registerCustomSocket` in `dist/server/sockets.mjs` and
  `dist/packages/package.mjs`: the id appended is the server's own
  session-derived `socket.user.id`, never read from the client message). Read
  it as `args[args.length - 1]`, not a hardcoded index, for forward safety. Gate
  PASSES; no need to stop before Task 7.
- **visible:** function (14.368, current) | `condition` (13.351, deprecated-but-
  only-supported-form) — entries for Task 6/7 must set both.
- **onClick signature:** `onClick(event, target)` (14.368) | `callback(target)`
  — no event arg (13.351) — entries for Task 6/7 must set both `onClick` and
  `callback`, and `callback` must not assume a second argument.
- **selection survives:** no (both versions, as exercised by Playwright's
  synthetic right-click) — do not read `window.getSelection()` inside
  `visible`/`condition`/`onClick`/`callback`; capture any needed text earlier
  (e.g. on `contextmenu` capture-phase or `mousedown`).
- **player menu opens:** yes (both versions) — a non-GM client sees only the
  entries whose `visible`/`condition` evaluates true for them; MEJ's own
  entries are already GM-gated, so an injected always-visible entry renders
  alone.
- **edit-mode marker:** `.editor-parent.editing` (both 13.06 and 14.x) — Task
  6's `displayFor` assumption is correct, unchanged.

## Additional cross-version gotchas for Task 6/7 (not asked for explicitly, but load-bearing)

- Menu item text: set both `label` and `name` (13.351 only reads `name`;
  14.368 accepts either).
- Opening a page's MEJ-typed sheet programmatically requires
  `game.MonksEnhancedJournal.fixType(page)` before `page.sheet.render(true)` —
  otherwise the core ProseMirror sheet opens instead (no MEJ markup at all).
