# Create Entity from Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Create Entity from Selection" item in MEJ's description context menu that turns a short selection into a new typed MEJ entity, links the selection to it, and optionally links every other mention, available to GMs and to per-campaign contributors (relayed through the active GM).

**Architecture:** Pure logic (selection rules, source-HTML linking, request validation, contributor membership) lives in `scripts/logic/` and is unit-tested with vitest. A DOM capture module turns the live selection into a serialisable request. One pipeline, `runEntityFromSelection(request, deps)`, does every write and is called directly on a GM client or from the socket handler for a contributor. A manual wrap of `EnhancedJournalSheet.prototype._getDescriptionContextOptions` adds the menu item. Nothing in MEJ is modified.

**Tech Stack:** Foundry VTT 13.351 / 14.x, MEJ 13.06 / 14.x, ES modules, vitest (+jsdom), Playwright e2e harness in `tests/e2e`.

**Spec:** `docs/superpowers/specs/2026-09-22-entity-from-selection-design.md`

## Global Constraints

- Repo: mej-campaign-companion only; never commit to monks-enhanced-journal.
- Branch: `feat/entity-from-selection` (already exists, holds the spec).
- Selection limit: 1–80 characters after `trim()`; entity name 1–120 characters after `trim()`.
- Type list, in order: journalentry, person, place, organization, quest, encounter, event, poi, shop, loot, list (no `session`). Default type `person`.
- Link format: `@UUID[<new JournalEntry uuid>]{<selected text>}`; the label is the selected text even if the name was edited.
- New entity goes in the source entry's folder (`null` when unfiled), empty body.
- Retro pass: honour `retroLinkMode`; the creation itself always suppresses the retro stamp.
- Relay timeout: 15 000 ms.
- Sender identity for relayed requests: the socket-supplied sender id only; never a payload field.
- Contributor data: campaign flag `contributors: { userIds: string[], groupIds: string[] }`, absent = none.
- i18n: all new strings under `MEJCampaignCompanion.entityFromSelection.*` in `lang/en.json` (and `hub.contributors*` for the Hub row).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. PR body: no Claude attribution line (user rule).
- Unit tests: `npx vitest run <file>`; full suite `npm test`. E2E: `npx playwright test tests/e2e/<file>` (v14), `FOUNDRY_TARGET=v13 npx playwright test …` (v13).

**Refinement of spec §4.4 (flag at plan review):** a selection whose start and end are in different text nodes (e.g. it crosses `<em>`) hides the menu item instead of creating the entity and then warning "could not link". Same outcome for the markup; better for the user. Also added: the capture records `total` (eligible rendered occurrences) and the source linker refuses when its own count differs, which is how "rendered/source mismatch" (spec §5) is detected.

## Review Focus

1. **Name containing HTML-entity characters** (`Tom & Jerry`, `"Quoted"`): the rendered text is decoded, source is encoded; expected to link correctly. Pinned in Task 2 (`&amp;`, `&quot;`, `&nbsp;` tests).
2. **Selected text also appears inside an inline roll or other enricher** (`[[/r 1d6 Goblin]]`, `@Check[…]`): rendered side never counts it; source must not either, or the Nth occurrence shifts. Pinned in Task 2 (masked-enricher tests) and Task 4 (capture skips `.inline-roll`).
3. **Page edited by someone else between click and Create**: the occurrence may no longer be the same; expected a count mismatch → entity created, selection unlinked, warning. Pinned in Task 5 (pipeline test with changed content).
4. **Forged relay request** (a player emits the socket action with a spoofed `userId`, another page, a bad type, a 5 000-char name): expected rejection with no writes. Pinned in Task 3 (validator) and Task 7 (handler uses socket sender id, ignores payload `userId`).
5. **GM disconnects or never answers**: expected "No GM responded; nothing was created" after 15 s, and a late success still toasts. Pinned in Task 7 (fake-timer tests).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/logic/entity-from-selection.mjs` | create | Pure: `ENTITY_TYPES`, `MAX_SELECTION_LENGTH`, `MAX_NAME_LENGTH`, `qualifySelection`, `countOccurrences`, `linkSelectionInSource`, `validateSelectionRequest`. |
| `scripts/logic/selection-capture.mjs` | create | DOM-only (no Foundry): `captureSelection(displayEl, selection)` → `{ text, occurrence, total }` or null. |
| `scripts/logic/entity-from-selection-run.mjs` | create | `runEntityFromSelection(request, deps)`: the only writer; deps injected. |
| `scripts/logic/campaigns.mjs` | modify | `contributorsOf(flag)`, `isContributor(user, flag, groups)`. |
| `scripts/logic/retro-link.mjs` | modify | Pure `shouldStampRetro({ mode, isCandidate, options })`. |
| `scripts/hooks/retro-link.mjs` | modify | preCreate handler uses `shouldStampRetro` with the create `options`. |
| `scripts/data/mej-entry.mjs` | modify | `createMejEntry(..., folder = null, createOptions = {})`. |
| `scripts/apps/entity-from-selection-dialog.mjs` | create | `typeOptions(labels, selected)`, `readDialogResult(form)`, `promptEntityFromSelection({ name, lastType })`. |
| `scripts/hooks/entity-from-selection.mjs` | create | Wrap install, eligibility, GM path, contributor request/timeout, result UI. |
| `scripts/hooks/entity-from-selection-relay.mjs` | create | Socket handlers `handleEntityRequest(payload, senderId)` / `handleEntityResult(payload)`, pending map. |
| `scripts/hooks/socket.mjs` | modify | Register the two actions; pass the sender id to handlers. |
| `scripts/constants.mjs` | modify | Setting + action names. |
| `scripts/campaign-companion.mjs` | modify | Register the client setting; call `registerEntityFromSelection()` in `ready`. |
| `scripts/apps/CampaignHubPage.mjs` | modify | Contributors fieldset in `onEditCampaign`. |
| `lang/en.json` | modify | Strings. |
| `test/entity-from-selection.test.js`, `test/selection-capture.test.js`, `test/entity-from-selection-run.test.js`, `test/entity-from-selection-relay.test.js`, `test/entity-dialog.test.js` | create | Unit tests. |
| `test/campaigns.test.js`, `test/retro-link.test.js`, `test/socket-dispatcher.test.js` | modify | Added cases. |
| `tests/e2e/24-entity-from-selection.spec.mjs` | create | E2E cases 1–7. |
| `CHANGELOG.md`, `docs/gm-guide.md`, `docs/player-guide.md`, `module.json` | modify | Release 0.21.0. |

---

### Task 1: Spike — Foundry socket sender id and ContextMenu API (gate)

Throwaway probe; nothing from it is committed except the findings note. **If the socket does not supply a trustworthy sender id on 14.x, STOP after this task and report to the human partner before Task 7** (the spec would reduce contributors to GM-only; that is their call, not the implementer's).

**Files:**
- Create: `docs/superpowers/notes/2026-09-22-entity-from-selection-spike.md`

**Interfaces:**
- Produces: the recorded facts Tasks 6 and 7 rely on: (a) sender-id argument position for `game.socket.on(SOCKET, …)` on 13.351 and 14.x; (b) whether ContextMenu entries accept `visible` as a function `(target) => boolean` and call `onClick(event, target)` on both; (c) whether `window.getSelection()` still holds the selection when `visible` is evaluated after a right-click; (d) whether MEJ's description context menu opens for a non-GM user when only our entry is visible; (e) which class/attribute marks an `.editor-parent` in edit mode on MEJ 13.06 and 14.x (Task 6 `displayFor` assumes `.editing`).

- [ ] **Step 1: Start the v14 world and log in two seats.** Use the harness (`tests/e2e/helpers/foundry.mjs` `login`) in a scratch Playwright script under the session scratchpad (not in `tests/`), seats "Gamemaster" and "User 1".

- [ ] **Step 2: Probe the socket sender.** On the GM seat:

```js
await gmPage.evaluate(() => {
  window.__probe = null;
  game.socket.on("module.mej-campaign-companion", (...args) => {
    if (args[0]?.action === "__probe") window.__probe = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : a));
  });
});
await userPage.evaluate(() => game.socket.emit("module.mej-campaign-companion", { action: "__probe" }));
await gmPage.waitForFunction(() => window.__probe !== null);
console.log(await gmPage.evaluate(() => window.__probe), await userPage.evaluate(() => game.user.id));
```

Expected: record the args array. PASS criterion: some argument equals User 1's id and is not taken from the payload.

- [ ] **Step 3: Probe the ContextMenu API.** On the GM seat:

```js
await gmPage.evaluate(() => {
  const host = document.createElement("div");
  host.innerHTML = '<div class="probe-target" style="position:fixed;top:10px;left:10px;width:50px;height:50px">x</div>';
  document.body.append(host);
  window.__cm = { visibleArgs: null, clickArgs: null, selAtVisible: null };
  new foundry.applications.ux.ContextMenu(host, ".probe-target", [{
    label: "Probe", icon: "<i class='fas fa-flask'></i>",
    visible: (t) => { window.__cm.visibleArgs = t?.className; window.__cm.selAtVisible = String(window.getSelection()); return true; },
    onClick: (e, t) => { window.__cm.clickArgs = [e?.type, t?.className]; }
  }], { fixed: true, jQuery: false });
  const r = document.createRange(); r.selectNodeContents(host.querySelector(".probe-target"));
  getSelection().removeAllRanges(); getSelection().addRange(r);
});
await gmPage.locator(".probe-target").click({ button: "right" });
await gmPage.locator("#context-menu li", { hasText: "Probe" }).click();
console.log(await gmPage.evaluate(() => window.__cm));
```

Expected: record `visibleArgs` ("probe-target" means function form works), `selAtVisible` ("x" means the selection survived the right-click), `clickArgs`.

- [ ] **Step 4: Repeat Steps 2–3 on v13** (`FOUNDRY_TARGET=v13`). If `visible` as a function is ignored on 13, retry with `condition: (t) => …` and record which works.

- [ ] **Step 5: Probe (d).** As User 1, open any MEJ text entry they can observe, and in the console add a temporary wrap: `const C = (await import("/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js")).EnhancedJournalSheet; const o = C.prototype._getDescriptionContextOptions; C.prototype._getDescriptionContextOptions = function () { return [...o.call(this), { label: "Probe", icon: "", visible: () => true, onClick: () => {} }]; };` then re-render the sheet, right-click the description, and record whether the menu opens with "Probe".

- [ ] **Step 6: Write the findings note** with one heading per fact (a)–(d), per Foundry version, and the verdict: `sender id: <arg index | none>`, `visible: function | condition`, `onClick signature`, `selection survives: yes/no`, `player menu opens: yes/no`.

- [ ] **Step 7: Commit the note.**

```bash
git add docs/superpowers/notes/2026-09-22-entity-from-selection-spike.md
git commit -m "docs(spike): socket sender id and ContextMenu API for entity-from-selection

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure selection rules and source linker

**Files:**
- Create: `scripts/logic/entity-from-selection.mjs`
- Test: `test/entity-from-selection.test.js`

**Interfaces:**
- Consumes: `tokenizeHtml(html)` from `scripts/logic/auto-link.mjs` → `{ type: "text"|"tag"|"link"|"code", raw: string }[]`.
- Produces:
  - `ENTITY_TYPES: string[]` (Global Constraints order), `MAX_SELECTION_LENGTH = 80`, `MAX_NAME_LENGTH = 120`
  - `qualifySelection(text: unknown): string | null`
  - `countOccurrences(haystack: string, needle: string): number` (non-overlapping, case-sensitive)
  - `linkSelectionInSource(sourceHtml: string, { text, occurrence, total, uuid }): string | null`

- [ ] **Step 1: Write the failing tests.**

```js
// test/entity-from-selection.test.js
import { describe, it, expect } from "vitest";
import {
  ENTITY_TYPES, qualifySelection, countOccurrences, linkSelectionInSource
} from "../scripts/logic/entity-from-selection.mjs";

const U = "JournalEntry.abc";

describe("qualifySelection", () => {
  it("trims and accepts 1–80 chars", () => {
    expect(qualifySelection("  Elara  ")).toBe("Elara");
    expect(qualifySelection("a".repeat(80))).toBe("a".repeat(80));
    expect(qualifySelection(` ${"a".repeat(80)} `)).toBe("a".repeat(80));
  });
  it("rejects empty, whitespace, >80, non-strings", () => {
    for (const bad of ["", "   ", "a".repeat(81), null, undefined, 42]) expect(qualifySelection(bad)).toBeNull();
  });
  it("rejects line breaks and enricher-breaking characters", () => {
    for (const bad of ["Elara\nMoon", "Elara\r", "A[b]", "A{b}", "@Elara"]) expect(qualifySelection(bad)).toBeNull();
  });
  it("accepts non-ASCII names and nbsp inside", () => {
    expect(qualifySelection("Ærwen Ó Súilleabháin")).toBe("Ærwen Ó Súilleabháin");
    expect(qualifySelection("Old Tom")).toBe("Old Tom");
  });
});

describe("ENTITY_TYPES", () => {
  it("is the wizard order without session", () => {
    expect(ENTITY_TYPES).toEqual(["journalentry", "person", "place", "organization", "quest",
      "encounter", "event", "poi", "shop", "loot", "list"]);
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping, case-sensitive", () => {
    expect(countOccurrences("Ana Ana ana", "Ana")).toBe(2);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("", "x")).toBe(0);
  });
});

describe("linkSelectionInSource", () => {
  const link = (text, occurrence, total, html) => linkSelectionInSource(html, { text, occurrence, total, uuid: U });

  it("links the 1st, 2nd and Nth occurrence", () => {
    const html = "<p>Elara met Elara.</p><p>Then Elara left.</p>";
    expect(link("Elara", 0, 3, html)).toBe(`<p>@UUID[${U}]{Elara} met Elara.</p><p>Then Elara left.</p>`);
    expect(link("Elara", 1, 3, html)).toBe(`<p>Elara met @UUID[${U}]{Elara}.</p><p>Then Elara left.</p>`);
    expect(link("Elara", 2, 3, html)).toBe(`<p>Elara met Elara.</p><p>Then @UUID[${U}]{Elara} left.</p>`);
  });
  it("skips occurrences inside existing links and code/pre", () => {
    const html = "<p>@UUID[JournalEntry.x]{Elara} <a href='#'>Elara</a> <code>Elara</code> <pre>Elara</pre> Elara</p>";
    expect(link("Elara", 0, 1, html)).toBe(
      `<p>@UUID[JournalEntry.x]{Elara} <a href='#'>Elara</a> <code>Elara</code> <pre>Elara</pre> @UUID[${U}]{Elara}</p>`);
  });
  it("skips occurrences inside inline rolls and other @Enrichers", () => {
    const html = "<p>[[/r 1d6 # Goblin]] @Check[dex]{Goblin} Goblin</p>";
    expect(link("Goblin", 0, 1, html)).toBe(`<p>[[/r 1d6 # Goblin]] @Check[dex]{Goblin} @UUID[${U}]{Goblin}</p>`);
  });
  it("does not count case-different matches", () => {
    expect(link("Elara", 0, 1, "<p>elara Elara</p>")).toBe(`<p>elara @UUID[${U}]{Elara}</p>`);
  });
  it("matches decoded entities and keeps the encoded source as the label", () => {
    expect(link("Tom & Jerry", 0, 1, "<p>Tom &amp; Jerry</p>")).toBe(`<p>@UUID[${U}]{Tom &amp; Jerry}</p>`);
    expect(link('"Quoted"', 0, 1, "<p>&quot;Quoted&quot;</p>")).toBe(`<p>@UUID[${U}]{&quot;Quoted&quot;}</p>`);
    expect(link("Old Tom", 0, 1, "<p>Old&nbsp;Tom</p>")).toBe(`<p>@UUID[${U}]{Old&nbsp;Tom}</p>`);
  });
  it("returns null when the total differs (rendered/source mismatch)", () => {
    expect(link("Elara", 0, 2, "<p>Elara</p>")).toBeNull();
  });
  it("returns null for an out-of-range occurrence", () => {
    expect(link("Elara", 1, 1, "<p>Elara</p>")).toBeNull();
  });
  it("returns null for a match spanning markup", () => {
    expect(link("Elara Moon", 0, 0, "<p>Elara <em>Moon</em></p>")).toBeNull();
  });
  it("tolerates empty/non-string source", () => {
    expect(link("Elara", 0, 1, "")).toBeNull();
    expect(link("Elara", 0, 1, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/entity-from-selection.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```js
// scripts/logic/entity-from-selection.mjs
// Pure rules for "Create Entity from Selection" (spec 2026-09-22). No
// Foundry globals: the selection gate, the source-HTML linker, and the
// relay request validator (added in Task 3) are unit-tested directly.
import { tokenizeHtml } from "./auto-link.mjs";

export const ENTITY_TYPES = [
  "journalentry", "person", "place", "organization", "quest",
  "encounter", "event", "poi", "shop", "loot", "list"
];
export const MAX_SELECTION_LENGTH = 80;
export const MAX_NAME_LENGTH = 120;

// Line breaks mean the selection crossed a block; brackets, braces and @
// would break the @UUID[...]{label} enricher the selection becomes.
const FORBIDDEN = /[\r\n[\]{}@]/;

/** Trimmed selection when it may become an entity name + link label, else null. */
export function qualifySelection(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t.length || t.length > MAX_SELECTION_LENGTH || FORBIDDEN.test(t)) return null;
  return t;
}

/** Non-overlapping, case-sensitive occurrence count. */
export function countOccurrences(haystack, needle) {
  if (!needle || typeof haystack !== "string") return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/iy;

/** Decode a raw text segment; map[i] is the raw index of decoded char i (map[len] = raw.length). */
function decodeWithMap(raw) {
  let decoded = "";
  const map = [];
  let i = 0;
  while (i < raw.length) {
    ENTITY_RE.lastIndex = i;
    const m = raw[i] === "&" ? ENTITY_RE.exec(raw) : null;
    let ch = null;
    if (m) {
      const body = m[1];
      if (body[0] === "#") {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (Number.isFinite(code)) ch = String.fromCodePoint(code);
      } else if (NAMED[body.toLowerCase()] !== undefined) {
        ch = NAMED[body.toLowerCase()];
      }
    }
    if (ch !== null) {
      for (const c of ch) { map.push(i); decoded += c; }
      i += m[0].length;
    } else {
      map.push(i);
      decoded += raw[i];
      i++;
    }
  }
  map.push(raw.length);
  return { decoded, map };
}

// Enricher syntax that renders as something other than its source text:
// inline rolls and any @Type[...]{...} (tokenizeHtml only makes @UUID opaque).
const ENRICHER_RE = /\[\[[\s\S]*?\]\]|@[A-Za-z]+\[[^\]]*\](?:\{[^}]*\})?/g;

function maskedRanges(decoded) {
  const ranges = [];
  ENRICHER_RE.lastIndex = 0;
  let m;
  while ((m = ENRICHER_RE.exec(decoded))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/**
 * Wrap the `occurrence`-th eligible match of `text` in the stored HTML as
 * @UUID[uuid]{<raw source substring>}. Eligible = inside a tokenizeHtml
 * "text" segment and outside enricher syntax. Returns null when the source's
 * eligible count differs from the rendered `total` the capture saw, or the
 * occurrence does not exist - the caller then reports "could not link".
 */
export function linkSelectionInSource(sourceHtml, { text, occurrence, total, uuid }) {
  if (typeof sourceHtml !== "string" || !sourceHtml || !text) return null;
  const segs = tokenizeHtml(sourceHtml);
  const hits = [];
  segs.forEach((seg, segIndex) => {
    if (seg.type !== "text") return;
    const { decoded, map } = decodeWithMap(seg.raw);
    const masked = maskedRanges(decoded);
    for (let i = decoded.indexOf(text); i !== -1; i = decoded.indexOf(text, i + text.length)) {
      const end = i + text.length;
      if (masked.some(([a, b]) => i < b && end > a)) continue;
      hits.push({ segIndex, rawStart: map[i], rawEnd: map[end] });
    }
  });
  if (hits.length !== total) return null;
  const hit = hits[occurrence];
  if (!hit) return null;
  return segs.map((seg, i) => {
    if (i !== hit.segIndex) return seg.raw;
    const label = seg.raw.slice(hit.rawStart, hit.rawEnd);
    return `${seg.raw.slice(0, hit.rawStart)}@UUID[${uuid}]{${label}}${seg.raw.slice(hit.rawEnd)}`;
  }).join("");
}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/entity-from-selection.test.js` — Expected: PASS. If the `[[/r 1d6 # Goblin]]` case fails because `tokenizeHtml` splits it, inspect `tokenizeHtml(html)` output and adjust only `maskedRanges`, not `tokenizeHtml` (other callers depend on it).

- [ ] **Step 5: Commit.**

```bash
git add scripts/logic/entity-from-selection.mjs test/entity-from-selection.test.js
git commit -m "feat(entity-from-selection): selection rules and source linker

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Contributors and relay request validation (pure)

**Files:**
- Modify: `scripts/logic/campaigns.mjs` (append)
- Modify: `scripts/logic/entity-from-selection.mjs` (append)
- Test: `test/campaigns.test.js` (append), `test/entity-from-selection.test.js` (append)

**Interfaces:**
- Consumes: `normalizeGroups(raw)` from `scripts/logic/player-groups.mjs`; Task 2 exports.
- Produces:
  - `contributorsOf(flag): { userIds: string[], groupIds: string[] }`
  - `isContributor(user: {id, isGM}, flag: object|null, groups: unknown): boolean`
  - `validateSelectionRequest(request, ctx): { ok: true } | { ok: false, reason: string }` where `ctx = { sender: {id, isGM}|null, isContributor: boolean, canObserve: boolean, regionKeys: string[] }`; reasons: `bad-payload`, `bad-sender`, `not-contributor`, `not-visible`, `bad-field`, `bad-selection`, `bad-type`, `bad-name`.

- [ ] **Step 1: Write the failing tests.** Append to `test/campaigns.test.js` (add `contributorsOf, isContributor` to its existing import from `../scripts/logic/campaigns.mjs`):

```js
describe("contributorsOf / isContributor", () => {
  const groups = [{ id: "g1", name: "Party", members: ["u2"] }];
  const flag = { ownershipDefault: "observer", contributors: { userIds: ["u1"], groupIds: ["g1"] } };
  it("normalizes absent/garbage to empty lists", () => {
    expect(contributorsOf(null)).toEqual({ userIds: [], groupIds: [] });
    expect(contributorsOf({ contributors: { userIds: "x", groupIds: [1, "g"] } })).toEqual({ userIds: [], groupIds: ["g"] });
  });
  it("direct user, group member, GM always, others never", () => {
    expect(isContributor({ id: "u1", isGM: false }, flag, groups)).toBe(true);
    expect(isContributor({ id: "u2", isGM: false }, flag, groups)).toBe(true);
    expect(isContributor({ id: "gm", isGM: true }, null, [])).toBe(true);
    expect(isContributor({ id: "u3", isGM: false }, flag, groups)).toBe(false);
    expect(isContributor({ id: "u1", isGM: false }, { ownershipDefault: "observer" }, groups)).toBe(false);
    expect(isContributor(null, flag, groups)).toBe(false);
  });
});
```

Append to `test/entity-from-selection.test.js` (add `validateSelectionRequest` to the import):

```js
describe("validateSelectionRequest", () => {
  const good = {
    requestId: "r1", pageUuid: "JournalEntry.a.JournalEntryPage.b", fieldKey: "text.content",
    text: "Elara", occurrence: 0, total: 1, type: "person", name: "Elara", linkOthers: true
  };
  const ctx = { sender: { id: "u1", isGM: false }, isContributor: true, canObserve: true, regionKeys: ["text.content"] };
  const v = (patch = {}, cpatch = {}) => validateSelectionRequest({ ...good, ...patch }, { ...ctx, ...cpatch });

  it("accepts a valid request", () => expect(v()).toEqual({ ok: true }));
  it.each([
    [{ requestId: "" }, {}, "bad-payload"],
    [{ occurrence: -1 }, {}, "bad-payload"],
    [{ occurrence: 1, total: 1 }, {}, "bad-payload"],
    [{ total: 1.5 }, {}, "bad-payload"],
    [{ linkOthers: "yes" }, {}, "bad-payload"],
    [{}, { sender: null }, "bad-sender"],
    [{}, { sender: { id: "gm", isGM: true } }, "bad-sender"],
    [{}, { isContributor: false }, "not-contributor"],
    [{}, { canObserve: false }, "not-visible"],
    [{ fieldKey: "flags.x.notes" }, {}, "bad-field"],
    [{ text: "a".repeat(81) }, {}, "bad-selection"],
    [{ text: " Elara " }, {}, "bad-selection"],
    [{ type: "session" }, {}, "bad-type"],
    [{ name: "   " }, {}, "bad-name"],
    [{ name: "x".repeat(121) }, {}, "bad-name"],
    [{ name: 7 }, {}, "bad-name"]
  ])("rejects %j %j as %s", (patch, cpatch, reason) => {
    expect(v(patch, cpatch)).toEqual({ ok: false, reason });
  });
});
```

(A GM never relays; a GM "sender" is therefore malformed and rejected as `bad-sender`. `text` must already be the trimmed form, so padded text is `bad-selection`.)

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/campaigns.test.js test/entity-from-selection.test.js` — Expected: FAIL, missing exports.

- [ ] **Step 3: Implement.** Append to `scripts/logic/campaigns.mjs` (add `import { normalizeGroups } from "./player-groups.mjs";` at the top):

```js
/** The campaign flag's contributor lists, normalized; absent = none (spec 2026-09-22 §4.5). */
export function contributorsOf(flag) {
  const c = flag?.contributors ?? {};
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length) : []);
  return { userIds: strings(c.userIds), groupIds: strings(c.groupIds) };
}

/** GMs always; otherwise listed directly or via a listed player group. */
export function isContributor(user, flag, groups) {
  if (!user) return false;
  if (user.isGM) return true;
  const { userIds, groupIds } = contributorsOf(flag);
  if (userIds.includes(user.id)) return true;
  return normalizeGroups(groups).some((g) => groupIds.includes(g.id) && g.members.includes(user.id));
}
```

Append to `scripts/logic/entity-from-selection.mjs`:

```js
const isIndex = (n) => Number.isInteger(n) && n >= 0;

/**
 * GM-side check of a contributor's relayed request (spec §4.5). Never
 * trusts the payload: `ctx` is computed by the GM from the socket-supplied
 * sender and the live page.
 */
export function validateSelectionRequest(request, ctx) {
  const r = request ?? {};
  if (typeof r.requestId !== "string" || !r.requestId || typeof r.pageUuid !== "string" ||
      typeof r.fieldKey !== "string" || !isIndex(r.occurrence) || !isIndex(r.total) ||
      r.occurrence >= r.total || typeof r.linkOthers !== "boolean") {
    return { ok: false, reason: "bad-payload" };
  }
  if (!ctx?.sender || ctx.sender.isGM) return { ok: false, reason: "bad-sender" };
  if (!ctx.isContributor) return { ok: false, reason: "not-contributor" };
  if (!ctx.canObserve) return { ok: false, reason: "not-visible" };
  if (!ctx.regionKeys?.includes(r.fieldKey)) return { ok: false, reason: "bad-field" };
  if (qualifySelection(r.text) !== r.text) return { ok: false, reason: "bad-selection" };
  if (!ENTITY_TYPES.includes(r.type)) return { ok: false, reason: "bad-type" };
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, reason: "bad-name" };
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/campaigns.test.js test/entity-from-selection.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/logic/campaigns.mjs scripts/logic/entity-from-selection.mjs test/campaigns.test.js test/entity-from-selection.test.js
git commit -m "feat(entity-from-selection): campaign contributors and relay validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: DOM selection capture

**Files:**
- Create: `scripts/logic/selection-capture.mjs`
- Test: `test/selection-capture.test.js`

**Interfaces:**
- Consumes: `qualifySelection`, `countOccurrences` (Task 2).
- Produces: `captureSelection(displayEl: Element, selection: Selection): { text: string, occurrence: number, total: number } | null`; `INELIGIBLE_SELECTOR` (string).

Rules (spec §4.2 + plan refinement): exactly one non-collapsed range; start and end in the **same text node**; that node is inside `displayEl` and not inside an ineligible element; `qualifySelection(range.toString())` non-null. `occurrence` = eligible matches in eligible text nodes strictly before the trimmed selection start; `total` = eligible matches in all eligible text nodes of `displayEl`.

- [ ] **Step 1: Write the failing tests.**

```js
// @vitest-environment jsdom
// test/selection-capture.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { captureSelection } from "../scripts/logic/selection-capture.mjs";

let root;
beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  root.className = "editor-display";
  document.body.append(root);
});

/** Select [start,end) of the nth text node (document order) whose data contains `probe`. */
function select(probe, nth, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node, seen = 0;
  while ((node = walker.nextNode())) {
    if (node.data.includes(probe) && seen++ === nth) break;
  }
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return sel;
}

describe("captureSelection", () => {
  it("captures the second occurrence with its total", () => {
    root.innerHTML = "<p>Elara met Elara.</p><p>Then Elara left.</p>";
    const sel = select("Elara met", 0, 10, 15);
    expect(captureSelection(root, sel)).toEqual({ text: "Elara", occurrence: 1, total: 3 });
  });
  it("trims whitespace around the selection and counts from the trimmed start", () => {
    root.innerHTML = "<p>Elara  Elara</p>";
    const sel = select("Elara", 0, 5, 12);
    expect(captureSelection(root, sel)).toEqual({ text: "Elara", occurrence: 1, total: 2 });
  });
  it("ignores text in links, code, pre and inline rolls for counting", () => {
    root.innerHTML = '<p><a class="content-link">Elara</a> <code>Elara</code> <a class="inline-roll">Elara</a> <span class="inline-roll">Elara</span> Elara</p><pre>Elara</pre>';
    const sel = select("Elara", 4, 1, 6);   // the 5th node is " Elara"
    expect(captureSelection(root, sel)).toEqual({ text: "Elara", occurrence: 0, total: 1 });
  });
  it("returns null inside a link, across nodes, outside the root, collapsed, or too long", () => {
    root.innerHTML = '<p><a>Elara</a> Elara <em>Moon</em></p>';
    expect(captureSelection(root, select("Elara", 0, 0, 5))).toBeNull();
    const r = document.createRange();
    const p = root.querySelector("p");
    r.setStart(p.childNodes[1], 1);
    r.setEnd(p.querySelector("em").firstChild, 2);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    expect(captureSelection(root, sel)).toBeNull();
    const outside = document.createElement("p"); outside.textContent = "Elara"; document.body.append(outside);
    const r2 = document.createRange(); r2.setStart(outside.firstChild, 0); r2.setEnd(outside.firstChild, 5);
    sel.removeAllRanges(); sel.addRange(r2);
    expect(captureSelection(root, sel)).toBeNull();
    expect(captureSelection(root, select("Elara", 1, 3, 3))).toBeNull();
    root.innerHTML = `<p>${"a".repeat(90)}</p>`;
    expect(captureSelection(root, select("a", 0, 0, 90))).toBeNull();
  });
  it("returns null for a null selection or no ranges", () => {
    expect(captureSelection(root, null)).toBeNull();
    window.getSelection().removeAllRanges();
    expect(captureSelection(root, window.getSelection())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/selection-capture.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```js
// scripts/logic/selection-capture.mjs
// Turns the live DOM selection in a rendered MEJ editor into the
// serialisable { text, occurrence, total } that linkSelectionInSource
// replays against the stored HTML. DOM only, no Foundry globals.
// INELIGIBLE_SELECTOR mirrors what the source side treats as opaque:
// <a> (content links, @UUID) and inline rolls ([[...]]), code, pre.
import { qualifySelection, countOccurrences } from "./entity-from-selection.mjs";

export const INELIGIBLE_SELECTOR = "a, code, pre, .inline-roll";

function eligibleTextNodes(root) {
  const nodes = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.parentElement?.closest(INELIGIBLE_SELECTOR) || !root.contains(n.parentElement.closest(INELIGIBLE_SELECTOR))) {
      nodes.push(n);
    }
  }
  return nodes;
}

export function captureSelection(displayEl, selection) {
  if (!displayEl || !selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  const node = range.startContainer;
  if (node !== range.endContainer || node.nodeType !== 3 || !displayEl.contains(node)) return null;
  const raw = node.data.slice(range.startOffset, range.endOffset);
  const text = qualifySelection(raw);
  if (!text) return null;
  const nodes = eligibleTextNodes(displayEl);
  const at = nodes.indexOf(node);
  if (at === -1) return null;
  const trimmedStart = range.startOffset + (raw.length - raw.trimStart().length);
  let occurrence = countOccurrences(node.data.slice(0, trimmedStart), text);
  for (let i = 0; i < at; i++) occurrence += countOccurrences(nodes[i].data, text);
  const total = nodes.reduce((sum, n) => sum + countOccurrences(n.data, text), 0);
  return { text, occurrence, total };
}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/selection-capture.test.js` — Expected: PASS. The eligibility test in `eligibleTextNodes` must treat an ineligible ancestor *outside* `displayEl` as irrelevant (the editor itself may sit inside an `<a>`-free tree; the `root.contains` check keeps that true).

- [ ] **Step 5: Commit.**

```bash
git add scripts/logic/selection-capture.mjs test/selection-capture.test.js
git commit -m "feat(entity-from-selection): DOM selection capture

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Retro opt-out, createMejEntry options, and the write pipeline

**Files:**
- Modify: `scripts/logic/retro-link.mjs` (append `shouldStampRetro`)
- Modify: `scripts/hooks/retro-link.mjs:460-468` (preCreate handler)
- Modify: `scripts/data/mej-entry.mjs:49` (signature + `JournalEntry.create` call)
- Create: `scripts/logic/entity-from-selection-run.mjs`
- Test: `test/retro-link.test.js` (append), `test/entity-from-selection-run.test.js`

**Interfaces:**
- Consumes: `linkSelectionInSource` (Task 2).
- Produces:
  - `shouldStampRetro({ mode: string, isCandidate: boolean, options: object|undefined, moduleId: string }): boolean`
  - `createMejEntry(type, name, htmlContent, extraFlags = {}, ownership = null, folder = null, createOptions = {})` → `Promise<JournalEntryPage>`
  - `runEntityFromSelection(request, deps)` → `Promise<{ ok: true, entryUuid: string, linked: boolean, retro: boolean } | { ok: false, reason: "page-missing"|"create-failed" }>` where `request = { pageUuid, fieldKey, text, occurrence, total, type, name, linkOthers }` and `deps = { fromUuid, createMejEntry, runRetroPass, getProperty, moduleId, logError }`.

- [ ] **Step 1: Write the failing tests.** Append to `test/retro-link.test.js` (add `shouldStampRetro` to its import from `../scripts/logic/retro-link.mjs`):

```js
describe("shouldStampRetro", () => {
  const M = "mej-campaign-companion";
  it("stamps candidates unless mode is off or the create opted out", () => {
    expect(shouldStampRetro({ mode: "auto", isCandidate: true, options: {}, moduleId: M })).toBe(true);
    expect(shouldStampRetro({ mode: "confirm", isCandidate: true, options: undefined, moduleId: M })).toBe(true);
    expect(shouldStampRetro({ mode: "off", isCandidate: true, options: {}, moduleId: M })).toBe(false);
    expect(shouldStampRetro({ mode: "auto", isCandidate: false, options: {}, moduleId: M })).toBe(false);
    expect(shouldStampRetro({ mode: "auto", isCandidate: true, options: { [M]: { skipRetroLink: true } }, moduleId: M })).toBe(false);
  });
});
```

Create `test/entity-from-selection-run.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { runEntityFromSelection } from "../scripts/logic/entity-from-selection-run.mjs";

const M = "mej-campaign-companion";
const get = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

function setup({ content = "<p>Elara waits.</p>", createThrows = false, updateThrows = false, folderId = "F1" } = {}) {
  const page = {
    text: { content },
    parent: { folder: folderId ? { id: folderId } : null },
    update: vi.fn(async (u) => { if (updateThrows) throw new Error("nope"); page.text.content = u["text.content"]; })
  };
  const entry = { uuid: "JournalEntry.new" };
  const deps = {
    moduleId: M,
    fromUuid: vi.fn(async (u) => (u === "P" ? page : null)),
    createMejEntry: vi.fn(async () => { if (createThrows) throw new Error("boom"); return { parent: entry }; }),
    runRetroPass: vi.fn(async () => {}),
    getProperty: get,
    logError: vi.fn()
  };
  return { page, entry, deps };
}
const req = (p = {}) => ({ pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1,
  type: "person", name: "Elara", linkOthers: true, ...p });

describe("runEntityFromSelection", () => {
  it("creates in the source folder with the retro opt-out, links, then runs the retro pass", async () => {
    const { page, entry, deps } = setup();
    const out = await runEntityFromSelection(req(), deps);
    expect(deps.createMejEntry).toHaveBeenCalledWith("person", "Elara", "", {}, null, "F1", { [M]: { skipRetroLink: true } });
    expect(page.text.content).toBe("<p>@UUID[JournalEntry.new]{Elara} waits.</p>");
    expect(deps.runRetroPass).toHaveBeenCalledWith([entry]);
    expect(out).toEqual({ ok: true, entryUuid: "JournalEntry.new", linked: true, retro: true });
  });
  it("uses the trimmed edited name but keeps the selected text as the label", async () => {
    const { page, deps } = setup();
    await runEntityFromSelection(req({ name: "  Elara Moonwhisper " }), deps);
    expect(deps.createMejEntry.mock.calls[0][1]).toBe("Elara Moonwhisper");
    expect(page.text.content).toContain("{Elara}");
  });
  it("unfiled source → null folder; linkOthers false → no retro", async () => {
    const { deps } = setup({ folderId: null });
    const out = await runEntityFromSelection(req({ linkOthers: false }), deps);
    expect(deps.createMejEntry.mock.calls[0][5]).toBeNull();
    expect(deps.runRetroPass).not.toHaveBeenCalled();
    expect(out.retro).toBe(false);
  });
  it("content changed since capture → entity kept, not linked, retro still runs", async () => {
    const { page, deps } = setup({ content: "<p>Elara and Elara.</p>" });
    const out = await runEntityFromSelection(req(), deps);
    expect(page.update).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, entryUuid: "JournalEntry.new", linked: false, retro: true });
  });
  it("page update throws → entity kept, not linked, retro skipped", async () => {
    const { deps } = setup({ updateThrows: true });
    const out = await runEntityFromSelection(req(), deps);
    expect(out).toEqual({ ok: true, entryUuid: "JournalEntry.new", linked: false, retro: false });
    expect(deps.runRetroPass).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalled();
  });
  it("missing page / create failure → ok:false, nothing written", async () => {
    const a = setup();
    expect(await runEntityFromSelection(req({ pageUuid: "X" }), a.deps)).toEqual({ ok: false, reason: "page-missing" });
    expect(a.deps.createMejEntry).not.toHaveBeenCalled();
    const b = setup({ createThrows: true });
    expect(await runEntityFromSelection(req(), b.deps)).toEqual({ ok: false, reason: "create-failed" });
    expect(b.page.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/retro-link.test.js test/entity-from-selection-run.test.js` — Expected: FAIL, missing exports/module.

- [ ] **Step 3: Implement.** Append to `scripts/logic/retro-link.mjs`:

```js
/**
 * preCreateJournalEntry decision for the retro stamp. A creator that runs
 * its own pass afterwards (entity-from-selection, which must write the
 * selection link first so the two writes cannot race) opts out through the
 * create options: { [moduleId]: { skipRetroLink: true } }.
 */
export function shouldStampRetro({ mode, isCandidate, options, moduleId }) {
  if (mode === "off" || !isCandidate) return false;
  return options?.[moduleId]?.skipRetroLink !== true;
}
```

In `scripts/hooks/retro-link.mjs` add `shouldStampRetro` to the import from `../logic/retro-link.mjs` and replace the preCreate handler body:

```js
  Hooks.on("preCreateJournalEntry", (entry, data, options) => {
    try {
      const stamp = shouldStampRetro({
        mode: game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING),
        isCandidate: isMejCandidate(entry),
        options,
        moduleId: MODULE_ID
      });
      if (stamp) entry.updateSource({ [`flags.${MODULE_ID}.${RETRO_LINK_PENDING_FLAG}`]: true });
    } catch (err) {
      console.error(`${MODULE_ID} | retro-link stamp failed`, err);
    }
  });
```

In `scripts/data/mej-entry.mjs`: add `@param {object} [createOptions] passed to JournalEntry.create as its options (e.g. the retro opt-out)` to the JSDoc, change the signature to `export async function createMejEntry(type, name, htmlContent, extraFlags = {}, ownership = null, folder = null, createOptions = {})`, and pass `createOptions` as the second argument of the existing `JournalEntry.create({...})` call (`JournalEntry.create({ ... }, createOptions)`).

Create `scripts/logic/entity-from-selection-run.mjs`:

```js
// The single writer for "Create Entity from Selection" (spec 2026-09-22
// §4.3 steps 3-5). Called directly on a GM client and from the relay
// handler for a contributor, so both paths write identically. Foundry
// access is injected (deps) so the branching is unit-tested.
import { linkSelectionInSource } from "./entity-from-selection.mjs";

export async function runEntityFromSelection(request, deps) {
  const { pageUuid, fieldKey, text, occurrence, total, type, name, linkOthers } = request;
  const page = await deps.fromUuid(pageUuid);
  if (!page) return { ok: false, reason: "page-missing" };

  let entry;
  try {
    const created = await deps.createMejEntry(type, name.trim(), "", {}, null, page.parent?.folder?.id ?? null,
      { [deps.moduleId]: { skipRetroLink: true } });
    entry = created.parent;
  } catch (err) {
    deps.logError("entity-from-selection: create failed", err);
    return { ok: false, reason: "create-failed" };
  }

  // Re-read now, not the captured HTML: someone may have edited the page
  // while the dialog was open; a shifted occurrence fails the total check.
  const newHtml = linkSelectionInSource(deps.getProperty(page, fieldKey), { text, occurrence, total, uuid: entry.uuid });
  let linked = false;
  if (newHtml !== null) {
    try {
      await page.update({ [fieldKey]: newHtml });
      linked = true;
    } catch (err) {
      deps.logError("entity-from-selection: page update failed", err);
      return { ok: true, entryUuid: entry.uuid, linked: false, retro: false };
    }
  }

  if (linkOthers) {
    Promise.resolve(deps.runRetroPass([entry])).catch((err) => deps.logError("entity-from-selection: retro pass failed", err));
  }
  return { ok: true, entryUuid: entry.uuid, linked, retro: !!linkOthers };
}
```

- [ ] **Step 4: Run to verify pass, then the full suite.** Run: `npx vitest run test/retro-link.test.js test/entity-from-selection-run.test.js` — Expected: PASS. Then `npm test` — Expected: all existing tests still pass (the `createMejEntry` change is additive).

- [ ] **Step 5: Commit.**

```bash
git add scripts/logic/retro-link.mjs scripts/hooks/retro-link.mjs scripts/data/mej-entry.mjs scripts/logic/entity-from-selection-run.mjs test/retro-link.test.js test/entity-from-selection-run.test.js
git commit -m "feat(entity-from-selection): write pipeline with retro opt-out

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dialog, menu item, and the GM path

**Files:**
- Create: `scripts/apps/entity-from-selection-dialog.mjs`
- Create: `scripts/hooks/entity-from-selection.mjs`
- Modify: `scripts/constants.mjs` (append), `scripts/campaign-companion.mjs` (setting registration + ready call), `lang/en.json`
- Test: `test/entity-dialog.test.js`

**Interfaces:**
- Consumes: Tasks 2–5; spike note facts (b)–(d); `installWraps` (`scripts/logic/mej-wraps.mjs`) with `wrapEnv(label)` (`scripts/integrations/wrap-env.mjs`); `linkableRegions(page)` (`scripts/logic/link-targets.mjs`); `campaignOf(doc)`, `campaignFlagOf(folder)`, `isContributor` (`scripts/logic/campaigns.mjs`); `runRetroPass(entries)` (`scripts/hooks/retro-link.mjs`); `createMejEntry` (`scripts/data/mej-entry.mjs`).
- Produces:
  - constants `ENTITY_FROM_SELECTION_LAST_TYPE_SETTING = "entityFromSelectionLastType"`, `ENTITY_FROM_SELECTION_ACTION = "entity-from-selection"`, `ENTITY_FROM_SELECTION_RESULT_ACTION = "entity-from-selection-result"`, `ENTITY_RELAY_TIMEOUT_MS = 15000`
  - `typeOptions(labels: Record<string,string>, selected: string, localize: (k)=>string): {value,label,selected}[]`
  - `readDialogResult(elements): { type, name, linkOthers }`
  - `promptEntityFromSelection({ name, lastType }): Promise<{ type, name, linkOthers } | null>`
  - `registerEntityFromSelection(): Promise<void>`
  - `showEntityOutcome(outcome, { type, name, sheet })` (used by Task 7 for relayed results)
  - `requestViaGm(request)` hook point: in this task a stub that returns `{ ok: false, reason: "relay-unavailable" }`; Task 7 replaces it.

- [ ] **Step 1: Write the failing dialog test.**

```js
// @vitest-environment jsdom
// test/entity-dialog.test.js
import { describe, it, expect } from "vitest";
import { typeOptions, readDialogResult } from "../scripts/apps/entity-from-selection-dialog.mjs";

describe("typeOptions", () => {
  it("lists ENTITY_TYPES in order with MEJ labels and marks the selected one", () => {
    const opts = typeOptions({ person: "MEJ.Person", place: "MEJ.Place" }, "place", (k) => `L:${k}`);
    expect(opts.map((o) => o.value)).toEqual(["journalentry", "person", "place", "organization", "quest",
      "encounter", "event", "poi", "shop", "loot", "list"]);
    expect(opts.find((o) => o.value === "person").label).toBe("L:MEJ.Person");
    expect(opts.find((o) => o.value === "quest").label).toBe("L:quest");
    expect(opts.filter((o) => o.selected).map((o) => o.value)).toEqual(["place"]);
  });
  it("falls back to person for an unknown remembered type", () => {
    expect(typeOptions({}, "session", (k) => k).find((o) => o.selected).value).toBe("person");
  });
});

describe("readDialogResult", () => {
  it("reads type, trimmed name and checkbox", () => {
    const form = document.createElement("form");
    form.innerHTML = '<select name="type"><option value="place" selected>Place</option></select>' +
      '<input name="name" value="  Elara ">' + '<input type="checkbox" name="linkOthers">';
    expect(readDialogResult(form.elements)).toEqual({ type: "place", name: "Elara", linkOthers: false });
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/entity-dialog.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the dialog.**

```js
// scripts/apps/entity-from-selection-dialog.mjs
// Type / name / "link other mentions" prompt (spec 2026-09-22 §3.2).
import { I18N } from "../constants.mjs";
import { ENTITY_TYPES, MAX_NAME_LENGTH } from "../logic/entity-from-selection.mjs";

export function typeOptions(labels, selected, localize) {
  const pick = ENTITY_TYPES.includes(selected) ? selected : "person";
  return ENTITY_TYPES.map((t) => ({ value: t, label: localize(labels?.[t] ?? t), selected: t === pick }));
}

export function readDialogResult(elements) {
  return {
    type: elements.type.value,
    name: elements.name.value.trim(),
    linkOthers: !!elements.linkOthers.checked
  };
}

export async function promptEntityFromSelection({ name, lastType }) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => esc(game.i18n.localize(`${I18N}.entityFromSelection.${k}`));
  const labels = game.MonksEnhancedJournal?.getTypeLabels?.() ?? {};
  const options = typeOptions(labels, lastType, (k) => game.i18n.localize(k))
    .map((o) => `<option value="${o.value}" ${o.selected ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  const content = `
    <div class="form-group"><label>${L("type")}</label><select name="type">${options}</select></div>
    <div class="form-group"><label>${L("name")}</label>
      <input type="text" name="name" value="${esc(name)}" maxlength="${MAX_NAME_LENGTH}" required autofocus></div>
    <div class="form-group"><label><input type="checkbox" name="linkOthers" checked> ${L("linkOthers")}</label></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${I18N}.entityFromSelection.title`) },
    content,
    ok: {
      label: game.i18n.localize(`${I18N}.entityFromSelection.create`),
      callback: (event, button) => readDialogResult(button.form.elements)
    },
    rejectClose: false
  });
  if (!result) return null;
  if (!result.name) {
    ui.notifications.warn(game.i18n.localize(`${I18N}.entityFromSelection.nameRequired`));
    return null;
  }
  return result;
}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/entity-dialog.test.js` — Expected: PASS.

- [ ] **Step 5: Constants, setting, strings.** Append to `scripts/constants.mjs`:

```js
// Create Entity from Selection (spec 2026-09-22).
export const ENTITY_FROM_SELECTION_LAST_TYPE_SETTING = "entityFromSelectionLastType";
export const ENTITY_FROM_SELECTION_ACTION = "entity-from-selection";
export const ENTITY_FROM_SELECTION_RESULT_ACTION = "entity-from-selection-result";
export const ENTITY_RELAY_TIMEOUT_MS = 15000;
```

In `scripts/campaign-companion.mjs`, next to the other `game.settings.register` calls:

```js
  game.settings.register(MODULE_ID, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING, {
    scope: "client", config: false, type: String, default: "person"
  });
```

Add to `lang/en.json` under `MEJCampaignCompanion`:

```json
"entityFromSelection": {
  "menu": "Create Entity from Selection",
  "title": "Create Entity from Selection",
  "type": "Type",
  "name": "Name",
  "linkOthers": "Link other mentions",
  "create": "Create",
  "nameRequired": "The entity needs a name.",
  "created": "Created {type} \"{name}\" and linked the selection.",
  "createdNotLinked": "Created {type} \"{name}\", but the selected text could not be linked automatically.",
  "awaitingReview": "Other mentions are waiting for GM review.",
  "failed": "Could not create the entity ({reason}).",
  "noGm": "No GM responded; nothing was created.",
  "rejected": {
    "bad-payload": "the request was malformed",
    "bad-sender": "your user could not be verified",
    "not-contributor": "you are not a contributor to this campaign",
    "not-visible": "you cannot see this page",
    "bad-field": "this field cannot be linked",
    "bad-selection": "the selection is not usable as a name",
    "bad-type": "unknown entity type",
    "bad-name": "the name is empty or longer than 120 characters",
    "page-missing": "the page no longer exists",
    "create-failed": "creation failed",
    "relay-unavailable": "no GM is available"
  }
}
```

- [ ] **Step 6: Implement the hook module (GM path; relay stubbed).**

```js
// scripts/hooks/entity-from-selection.mjs
// "Create Entity from Selection" (spec 2026-09-22): adds one entry to MEJ's
// description context menu through a manual wrap of
// EnhancedJournalSheet.prototype._getDescriptionContextOptions - MEJ builds
// that menu with `new ContextMenu(...)` directly, so no hook exists to
// extend it. Manual (no libWrapper path): the class is an ES-module export,
// not reachable by a global path string.
import { MODULE_ID, I18N, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING, RETRO_LINK_MODE_SETTING, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { installWraps } from "../logic/mej-wraps.mjs";
import { wrapEnv } from "../integrations/wrap-env.mjs";
import { captureSelection } from "../logic/selection-capture.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { campaignOf, campaignFlagOf, isContributor } from "../logic/campaigns.mjs";
import { runEntityFromSelection } from "../logic/entity-from-selection-run.mjs";
import { promptEntityFromSelection } from "../apps/entity-from-selection-dialog.mjs";
import { createMejEntry } from "../data/mej-entry.mjs";
import { runRetroPass } from "./retro-link.mjs";

/** Foundry-bound deps for the pipeline (GM path here, relay handler in Task 7). */
export function pipelineDeps() {
  return {
    moduleId: MODULE_ID,
    fromUuid: (u) => fromUuid(u),
    createMejEntry,
    runRetroPass: (entries) => runRetroPass(entries),
    getProperty: (o, p) => foundry.utils.getProperty(o, p),
    logError: (msg, err) => console.error(`${MODULE_ID} | ${msg}`, err)
  };
}

/** The rendered editor under the pointer, if it is in display mode. */
function displayFor(target) {
  const parent = target?.closest?.(".editor-parent") ?? null;
  if (!parent || parent.classList.contains("editing")) return null;
  if (parent.querySelector(".editor-control prose-mirror.active, .editor-control .ProseMirror")) return null;
  return parent.querySelector(".editor-display[data-key]");
}

/** Everything the click needs, or null when the item must stay hidden (spec §4.2). */
export function eligibility(sheet, target) {
  const page = sheet?.document;
  const display = displayFor(target);
  if (!page || !display) return null;
  const fieldKey = display.dataset.key;
  if (!linkableRegions(page).some((r) => r.key === fieldKey)) return null;
  const capture = captureSelection(display, window.getSelection());
  if (!capture) return null;
  if (game.user.isGM) return sheet.isEditable ? { page, fieldKey, capture, relay: false } : null;
  const campaign = campaignOf(page);
  if (!campaign || !game.users.activeGM) return null;
  const groups = game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING);
  return isContributor(game.user, campaignFlagOf(campaign), groups) ? { page, fieldKey, capture, relay: true } : null;
}

/** Replaced by Task 7 (entity-from-selection-relay.mjs). */
let requestViaGm = async () => ({ ok: false, reason: "relay-unavailable" });
export function setRelay(fn) { requestViaGm = fn; }

export function showEntityOutcome(outcome, { type, name, sheet }) {
  const f = (k, d) => game.i18n.format(`${I18N}.entityFromSelection.${k}`, d);
  if (!outcome?.ok) {
    const reason = game.i18n.localize(`${I18N}.entityFromSelection.rejected.${outcome?.reason ?? "create-failed"}`);
    ui.notifications.error(f("failed", { reason }));
    return;
  }
  const typeLabel = game.i18n.localize(game.MonksEnhancedJournal?.getTypeLabels?.()?.[type] ?? type);
  if (outcome.linked) ui.notifications.info(f("created", { type: typeLabel, name }));
  else ui.notifications.warn(f("createdNotLinked", { type: typeLabel, name }));
  if (outcome.retro && !game.user.isGM && game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING) === "confirm") {
    ui.notifications.info(game.i18n.localize(`${I18N}.entityFromSelection.awaitingReview`));
  }
  const entry = fromUuidSync(outcome.entryUuid);
  const host = sheet?.enhancedjournal;
  if (entry && host && entry.testUserPermission(game.user, "OBSERVER")) {
    host.addTab(entry, { activate: false });
    host.render();
  }
}

async function startFromSelection(sheet, target) {
  const ctx = eligibility(sheet, target);   // re-check: the selection is read NOW, before the dialog takes focus
  if (!ctx) return;
  const lastType = game.settings.get(MODULE_ID, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING);
  const choice = await promptEntityFromSelection({ name: ctx.capture.text, lastType });
  if (!choice) return;
  await game.settings.set(MODULE_ID, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING, choice.type);
  const request = { pageUuid: ctx.page.uuid, fieldKey: ctx.fieldKey, ...ctx.capture, ...choice };
  const outcome = ctx.relay ? await requestViaGm(request) : await runEntityFromSelection(request, pipelineDeps());
  showEntityOutcome(outcome, { type: choice.type, name: choice.name, sheet });
}

export async function registerEntityFromSelection() {
  let EnhancedJournalSheet;
  try {
    ({ EnhancedJournalSheet } = await import("/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js"));
  } catch (err) {
    console.warn(`${MODULE_ID} | entity-from-selection unavailable: MEJ sheet class not importable`, err);
    return;
  }
  const result = installWraps([{
    name: "_getDescriptionContextOptions",
    object: EnhancedJournalSheet?.prototype,
    key: "_getDescriptionContextOptions",
    wrapper(wrapped, ...args) {
      const menu = wrapped(...args);
      const sheet = this;
      menu.push({
        label: game.i18n.localize(`${I18N}.entityFromSelection.menu`),
        icon: '<i class="fas fa-user-plus"></i>',
        visible: (target) => !!eligibility(sheet, target),
        onClick: (event, target) => startFromSelection(sheet, target)
      });
      return menu;
    }
  }], wrapEnv("entity from selection"));
  if (result.failed) console.warn(`${MODULE_ID} | entity-from-selection unavailable (wrap not installable)`);
}
```

Adjust from the spike note: if Foundry 13 needs `condition` instead of `visible`, add `condition: (target) => !!eligibility(sheet, target)` beside `visible`; if `onClick` does not receive `target` on a version, capture it from the `contextmenu` event instead (record the change in the commit message). If MEJ builds the menu only when `game.user.isGM` (spike fact d = no), the contributor path cannot appear; stop and report.

- [ ] **Step 7: Wire into ready.** In `scripts/campaign-companion.mjs` `Hooks.once("ready", …)`, after `registerCampaignGuard()`:

```js
  if (game.modules.get("monks-enhanced-journal")?.active) registerEntityFromSelection();
```

with `import { registerEntityFromSelection } from "./hooks/entity-from-selection.mjs";` at the top. Sheets render after ready, so the prototype wrap is in place before any menu is built.

- [ ] **Step 8: Run the full unit suite.** Run: `npm test` — Expected: PASS (the hook module is not imported by unit tests; its pure parts are covered by Tasks 2–5 and Step 1).

- [ ] **Step 9: Manual smoke on v14 as GM** (Foundry running per the v14 test-env notes): open a Place, select a name in its description, right-click → "Create Entity from Selection" → Person → Create. Expected: toast, background tab, selection is a content link. Delete the TT- entity afterwards.

- [ ] **Step 10: Commit.**

```bash
git add scripts/apps/entity-from-selection-dialog.mjs scripts/hooks/entity-from-selection.mjs scripts/constants.mjs scripts/campaign-companion.mjs lang/en.json test/entity-dialog.test.js
git commit -m "feat(entity-from-selection): menu item, dialog and GM path

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Contributor relay over the socket

**Precondition:** spike fact (a) says the socket supplies the sender id. If it does not, do not start this task — report to the human partner.

**Files:**
- Create: `scripts/hooks/entity-from-selection-relay.mjs`
- Modify: `scripts/hooks/socket.mjs` (handlers, `GM_ACTIONS`, pass sender id)
- Modify: `scripts/hooks/entity-from-selection.mjs` (call `setRelay` in `registerEntityFromSelection`)
- Test: `test/entity-from-selection-relay.test.js`, `test/socket-dispatcher.test.js` (append)

**Interfaces:**
- Consumes: `validateSelectionRequest` (Task 3), `isContributor`/`campaignOf`/`campaignFlagOf`, `linkableRegions`, `runEntityFromSelection` + `pipelineDeps` + `showEntityOutcome` (Tasks 5–6), constants (Task 6).
- Produces:
  - `handleEntityRequest(payload, senderId, env?)` (GM side)
  - `handleEntityResult(payload, env?)` (requester side)
  - `requestEntityViaGm(request, env?)` → `Promise<outcome>`; resolves `{ ok: false, reason: "no-gm" }` on timeout
  - `env` defaults to Foundry globals; tests pass fakes: `{ emit, users, fromUuid, groups, run, userId, now/timers via vi.useFakeTimers, onLate }`.

- [ ] **Step 1: Write the failing tests.**

```js
// test/entity-from-selection-relay.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleEntityRequest, handleEntityResult, requestEntityViaGm } from "../scripts/hooks/entity-from-selection-relay.mjs";

const payload = (p = {}) => ({
  action: "entity-from-selection", requestId: "r1", userId: "SPOOF",
  pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1,
  type: "person", name: "Elara", linkOthers: true, ...p
});

function gmEnv({ contributor = true, observe = true } = {}) {
  const page = {
    parent: { testUserPermission: vi.fn(() => observe) },
    text: { content: "<p>Elara</p>" }
  };
  return {
    emitted: [],
    emit(msg) { this.emitted.push(msg); },
    users: new Map([["u1", { id: "u1", isGM: false }], ["SPOOF", { id: "SPOOF", isGM: false }]]),
    fromUuid: vi.fn(async () => page),
    campaignFlagFor: vi.fn(() => ({ contributors: { userIds: contributor ? ["u1"] : [], groupIds: [] } })),
    groups: [],
    regionKeys: () => ["text.content"],
    run: vi.fn(async () => ({ ok: true, entryUuid: "JournalEntry.new", linked: true, retro: true })),
    page
  };
}

describe("handleEntityRequest (GM)", () => {
  it("validates against the socket sender, not payload.userId, then runs and replies to the sender", async () => {
    const env = gmEnv();
    await handleEntityRequest(payload(), "u1", env);
    expect(env.page.parent.testUserPermission).toHaveBeenCalledWith(env.users.get("u1"), "OBSERVER");
    expect(env.run).toHaveBeenCalledWith(expect.objectContaining({ pageUuid: "P", name: "Elara" }));
    expect(env.emitted).toEqual([{ action: "entity-from-selection-result", requestId: "r1", recipient: "u1",
      ok: true, entryUuid: "JournalEntry.new", linked: true, retro: true }]);
  });
  it("rejects a non-contributor sender even when payload.userId names a contributor", async () => {
    const env = gmEnv({ contributor: false });
    env.campaignFlagFor = () => ({ contributors: { userIds: ["SPOOF"], groupIds: [] } });
    await handleEntityRequest(payload(), "u1", env);
    expect(env.run).not.toHaveBeenCalled();
    expect(env.emitted[0]).toMatchObject({ recipient: "u1", ok: false, reason: "not-contributor" });
  });
  it("rejects unknown sender, invisible page, bad type, oversized name without writing", async () => {
    for (const [p, s, opts, reason] of [
      [{}, "ghost", {}, "bad-sender"],
      [{}, "u1", { observe: false }, "not-visible"],
      [{ type: "session" }, "u1", {}, "bad-type"],
      [{ name: "x".repeat(5000) }, "u1", {}, "bad-name"]
    ]) {
      const env = gmEnv(opts);
      await handleEntityRequest(payload(p), s, env);
      expect(env.run).not.toHaveBeenCalled();
      expect(env.emitted[0]).toMatchObject({ ok: false, reason });
    }
  });
  it("replies page-missing when the page is gone", async () => {
    const env = gmEnv();
    env.fromUuid = vi.fn(async () => null);
    await handleEntityRequest(payload(), "u1", env);
    expect(env.emitted[0]).toMatchObject({ ok: false, reason: "page-missing" });
  });
});

describe("requestEntityViaGm / handleEntityResult (requester)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const clientEnv = () => ({ emitted: [], emit(m) { this.emitted.push(m); }, userId: "u1", randomId: () => "r1", onLate: vi.fn() });

  it("emits the request and resolves on the matching result for this user only", async () => {
    const env = clientEnv();
    const p = requestEntityViaGm({ pageUuid: "P" }, env);
    expect(env.emitted[0]).toMatchObject({ action: "entity-from-selection", requestId: "r1", pageUuid: "P" });
    handleEntityResult({ requestId: "r1", recipient: "someone-else", ok: true }, env);
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, env);
    await expect(p).resolves.toEqual({ ok: true, entryUuid: "E", linked: true, retro: false });
  });
  it("times out after 15 s with no-gm, and a late result goes to onLate", async () => {
    const env = clientEnv();
    const p = requestEntityViaGm({ pageUuid: "P" }, env);
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toEqual({ ok: false, reason: "no-gm" });
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, env);
    expect(env.onLate).toHaveBeenCalledWith(expect.objectContaining({ ok: true, entryUuid: "E" }));
  });
});
```

Append to `test/socket-dispatcher.test.js`:

```js
describe("entity-from-selection actions", () => {
  it("request is GM-only; result reaches every client", () => {
    expect(isAuthorizedForAction("entity-from-selection", false)).toBe(false);
    expect(isAuthorizedForAction("entity-from-selection", true)).toBe(true);
    expect(isAuthorizedForAction("entity-from-selection-result", false)).toBe(true);
  });
});
```

Add `"no-gm": "no GM responded"` to `entityFromSelection.rejected` in `lang/en.json`, and make `showEntityOutcome` use the `noGm` string for `reason === "no-gm"` (warn, not error).

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/entity-from-selection-relay.test.js test/socket-dispatcher.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement the relay module.**

```js
// scripts/hooks/entity-from-selection-relay.mjs
// Contributor → active GM relay for "Create Entity from Selection" (spec
// 2026-09-22 §4.5), mirroring the media-upload request/result pair. The
// GM trusts only the socket-supplied sender id (spike note 2026-09-22):
// payload.userId is ignored, so a player cannot act as another user.
import {
  MODULE_ID, SOCKET, ENTITY_FROM_SELECTION_ACTION, ENTITY_FROM_SELECTION_RESULT_ACTION,
  ENTITY_RELAY_TIMEOUT_MS, PLAYER_GROUPS_SETTING
} from "../constants.mjs";
import { validateSelectionRequest } from "../logic/entity-from-selection.mjs";
import { isContributor, campaignOf, campaignFlagOf } from "../logic/campaigns.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { runEntityFromSelection } from "../logic/entity-from-selection-run.mjs";

const FIELDS = ["pageUuid", "fieldKey", "text", "occurrence", "total", "type", "name", "linkOthers"];
const pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p?.[k]]));

function foundryEnv() {
  return {
    emit: (msg) => game.socket.emit(SOCKET, msg),
    users: game.users,
    fromUuid: (u) => fromUuid(u),
    campaignFlagFor: (page) => campaignFlagOf(campaignOf(page)),
    groups: game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING),
    regionKeys: (page) => linkableRegions(page).map((r) => r.key),
    run: async (request) => {
      const { pipelineDeps } = await import("./entity-from-selection.mjs");
      return runEntityFromSelection(request, pipelineDeps());
    },
    userId: game.user.id,
    randomId: () => foundry.utils.randomID(),
    onLate: async (outcome) => {
      const { showEntityOutcome } = await import("./entity-from-selection.mjs");
      showEntityOutcome(outcome, { type: outcome.type, name: outcome.name, sheet: null });
    }
  };
}

/** GM side. `senderId` comes from the socket, never from the payload. */
export async function handleEntityRequest(payload, senderId, env = foundryEnv()) {
  const reply = (outcome) => env.emit({
    action: ENTITY_FROM_SELECTION_RESULT_ACTION, requestId: payload?.requestId, recipient: senderId, ...outcome
  });
  if (typeof senderId !== "string" || typeof payload?.requestId !== "string") return;
  const sender = env.users.get(senderId) ?? null;
  const page = typeof payload.pageUuid === "string" ? await env.fromUuid(payload.pageUuid) : null;
  if (!page) return reply({ ok: false, reason: "page-missing" });
  const flag = env.campaignFlagFor(page);
  const verdict = validateSelectionRequest(payload, {
    sender: sender ? { id: sender.id, isGM: !!sender.isGM } : null,
    isContributor: !!sender && !!flag && isContributor({ id: sender.id, isGM: false }, flag, env.groups),
    canObserve: !!sender && page.parent?.testUserPermission(sender, "OBSERVER") === true,
    regionKeys: env.regionKeys(page)
  });
  if (!verdict.ok) return reply(verdict);
  return reply(await env.run(pick(payload)));
}

const pending = new Map();   // requestId -> { resolve, timer, meta }
const late = new Map();      // requestId -> meta, after a timeout

export function requestEntityViaGm(request, env = foundryEnv()) {
  const requestId = env.randomId();
  const meta = { type: request.type, name: request.name };
  const result = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      late.set(requestId, meta);
      resolve({ ok: false, reason: "no-gm" });
    }, ENTITY_RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer, meta });
  });
  env.emit({ action: ENTITY_FROM_SELECTION_ACTION, requestId, userId: env.userId, ...pick(request) });
  return result;
}

/** Requester side: settle our own pending request; toast a result that arrives after the timeout. */
export function handleEntityResult(payload, env = foundryEnv()) {
  if (payload?.recipient !== env.userId) return;
  const { action, requestId, recipient, ...outcome } = payload;
  const waiting = pending.get(requestId);
  if (waiting) {
    clearTimeout(waiting.timer);
    pending.delete(requestId);
    waiting.resolve(outcome);
    return;
  }
  const meta = late.get(requestId);
  if (meta) {
    late.delete(requestId);
    env.onLate({ ...outcome, ...meta });
  }
}
```

(`userId` stays in the emitted payload only for GM-side logging; the handler never reads it.)

- [ ] **Step 4: Register in the dispatcher.** In `scripts/hooks/socket.mjs`: import the two constants and `handleEntityRequest`, `handleEntityResult`; add both to `HANDLERS`; add `ENTITY_FROM_SELECTION_ACTION` to `GM_ACTIONS`; change the listener to forward the sender id per the spike (example for "sender id is the last argument"):

```js
  game.socket.on(SOCKET, (payload, ...rest) => {
    const senderId = rest.at(-1);   // spike note 2026-09-22: Foundry appends the emitting user's id
    const action = payload?.action;
    if (!isAuthorizedForAction(action, game.user === game.users.activeGM)) return;
    const handler = HANDLERS[action];
    (async () => {
      try {
        await handler(payload, senderId);
      } catch (error) {
        console.error(`mej-campaign-companion | socket handler for "${action}" failed`, error);
      }
    })();
  });
```

Update the header comment's GM_ACTIONS paragraph to name the new request action. `handleUploadRequest` ignores the extra argument. Note: Foundry does not deliver a client's own emit back to itself, so a GM never relays to itself (GMs use the direct path anyway).

In `registerEntityFromSelection()` (Task 6 file) add after the wrap install:

```js
  const { requestEntityViaGm } = await import("./entity-from-selection-relay.mjs");
  setRelay((request) => requestEntityViaGm(request));
```

- [ ] **Step 5: Run to verify pass.** Run: `npx vitest run test/entity-from-selection-relay.test.js test/socket-dispatcher.test.js` then `npm test` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add scripts/hooks/entity-from-selection-relay.mjs scripts/hooks/socket.mjs scripts/hooks/entity-from-selection.mjs lang/en.json test/entity-from-selection-relay.test.js test/socket-dispatcher.test.js
git commit -m "feat(entity-from-selection): contributor relay through the active GM

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Hub Contributors row

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onEditCampaign`, ~line 1124)
- Modify: `scripts/logic/campaigns.mjs` (append `contributorChoices`, `readContributors`)
- Modify: `lang/en.json` (`hub.contributors`, `hub.contributorsHint`, `hub.contributorsUsers`, `hub.contributorsGroups`)
- Test: `test/campaigns.test.js` (append)

**Interfaces:**
- Consumes: `contributorsOf` (Task 3), `normalizeGroups`.
- Produces:
  - `contributorChoices(users: {id,name,isGM}[], groups, flag): { users: {id,name,checked}[], groups: {id,name,checked}[] }` (non-GM users only, name-sorted)
  - `readContributors(form: HTMLFormElement): { userIds: string[], groupIds: string[] }` (checkbox names `contributorUser` / `contributorGroup`)

- [ ] **Step 1: Write the failing tests.** Append to `test/campaigns.test.js` (the file must keep working in its current environment; if it is not jsdom, put the `readContributors` test in a new `// @vitest-environment jsdom` file `test/contributors-form.test.js`):

```js
describe("contributorChoices", () => {
  it("lists non-GM users and groups, sorted, with current picks checked", () => {
    const users = [{ id: "u2", name: "Zed", isGM: false }, { id: "gm", name: "GM", isGM: true }, { id: "u1", name: "Ana", isGM: false }];
    const groups = [{ id: "g1", name: "Party", members: [] }];
    const flag = { contributors: { userIds: ["u2"], groupIds: ["g1"] } };
    expect(contributorChoices(users, groups, flag)).toEqual({
      users: [{ id: "u1", name: "Ana", checked: false }, { id: "u2", name: "Zed", checked: true }],
      groups: [{ id: "g1", name: "Party", checked: true }]
    });
  });
});
```

```js
// @vitest-environment jsdom
// test/contributors-form.test.js
import { describe, it, expect } from "vitest";
import { readContributors } from "../scripts/logic/campaigns.mjs";

describe("readContributors", () => {
  it("collects checked user and group boxes", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input type="checkbox" name="contributorUser" value="u1" checked>' +
      '<input type="checkbox" name="contributorUser" value="u2">' +
      '<input type="checkbox" name="contributorGroup" value="g1" checked>';
    expect(readContributors(form)).toEqual({ userIds: ["u1"], groupIds: ["g1"] });
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/campaigns.test.js test/contributors-form.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement.** Append to `scripts/logic/campaigns.mjs`:

```js
/** Checkbox rows for the Hub's Contributors fieldset (spec 2026-09-22 §4.5). */
export function contributorChoices(users, groups, flag) {
  const { userIds, groupIds } = contributorsOf(flag);
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    users: (users ?? []).filter((u) => !u.isGM).map((u) => ({ id: u.id, name: u.name, checked: userIds.includes(u.id) })).sort(byName),
    groups: normalizeGroups(groups).map((g) => ({ id: g.id, name: g.name, checked: groupIds.includes(g.id) })).sort(byName)
  };
}

/** Read the Contributors checkboxes back out of the settings form. */
export function readContributors(form) {
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  return { userIds: checked("contributorUser"), groupIds: checked("contributorGroup") };
}
```

In `CampaignHubPage.onEditCampaign`: import `contributorChoices`, `readContributors` and `PLAYER_GROUPS_SETTING`; build the fieldset and append it to `content`:

```js
    const choices = contributorChoices(game.users.contents, game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), campaignFlagOf(campaign));
    const box = (name, c) => `<label class="checkbox"><input type="checkbox" name="${name}" value="${esc(c.id)}" ${c.checked ? "checked" : ""}> ${esc(c.name)}</label>`;
    const contributors = `
      <fieldset><legend>${esc(game.i18n.localize(`${I18N}.hub.contributors`))}</legend>
        <p class="hint">${esc(game.i18n.localize(`${I18N}.hub.contributorsHint`))}</p>
        <div class="form-group stacked"><label>${esc(game.i18n.localize(`${I18N}.hub.contributorsUsers`))}</label>
          ${choices.users.map((c) => box("contributorUser", c)).join("")}</div>
        ${choices.groups.length ? `<div class="form-group stacked"><label>${esc(game.i18n.localize(`${I18N}.hub.contributorsGroups`))}</label>
          ${choices.groups.map((c) => box("contributorGroup", c)).join("")}</div>` : ""}
      </fieldset>`;
```

Extend the `ok` callback to return `contributors: readContributors(button.form)` and replace the `setFlag` call with:

```js
    await campaign.setFlag(MODULE_ID, CAMPAIGN_FLAG, { ownershipDefault: result.baseline, contributors: result.contributors });
```

Strings (under `hub`): `"contributors": "Contributors"`, `"contributorsHint": "Contributors can create entities from selected text in this campaign's pages while a GM is connected."`, `"contributorsUsers": "Players"`, `"contributorsGroups": "Player groups"`.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/campaigns.test.js test/contributors-form.test.js` then `npm test` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/logic/campaigns.mjs scripts/apps/CampaignHubPage.mjs lang/en.json test/campaigns.test.js test/contributors-form.test.js
git commit -m "feat(hub): campaign Contributors row

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end tests (v14, then v13 smoke)

**Files:**
- Create: `tests/e2e/24-entity-from-selection.spec.mjs`

**Interfaces:**
- Consumes: `login`, `cleanupAsGm`, `trackConsoleErrors`, `assertNoConsoleErrors`, `settle`, `KNOWN_MEJ_SESSION_ICON_404` from `tests/e2e/helpers/foundry.mjs`; seats "Gamemaster", "User 1", "User 2"; entity-creation and entry-opening patterns from `tests/e2e/22-auto-link-sessions.spec.mjs` and `tests/e2e/11-auto-link-scope.spec.mjs` (copy their `createCampaignFolder` / `createPerson`-style helpers and their way of opening an entry in the MEJ shell).

- [ ] **Step 1: Write the spec** with names `TTEfs…${RUN}` and these helpers (in addition to the copied ones):

```js
/** Select `text` (nth occurrence, 0-based) inside the open sheet's description and open the context menu on it. */
async function selectAndOpenMenu(page, text, nth = 0) {
  const box = await page.evaluate(({ text, nth }) => {
    const display = [...document.querySelectorAll(".editor-parent .editor-display[data-key]")].find((d) => d.offsetParent);
    const walker = document.createTreeWalker(display, NodeFilter.SHOW_TEXT);
    let node, seen = 0, at = -1;
    while ((node = walker.nextNode())) {
      let i = -1;
      while ((i = node.data.indexOf(text, i + 1)) !== -1) { if (seen++ === nth) { at = i; break; } }
      if (at !== -1) break;
    }
    const r = document.createRange(); r.setStart(node, at); r.setEnd(node, at + text.length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const rect = r.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, { text, nth });
  await page.mouse.click(box.x, box.y, { button: "right" });
}
const menuItem = (page) => page.locator("#context-menu li", { hasText: "Create Entity from Selection" });
```

Tests (each creates its own TT- campaign folder with `ownershipDefault: "observer"` and cleans up in `afterEach` via `cleanupAsGm`, deleting TT- journals and folders):

1. **GM happy path** — Place `TTEfsPlace` in the campaign with description `<p>Ask Elara about Elara.</p>`; a second page `TTEfsOther` with `<p>Elara is here.</p>`; `retroLinkMode = "auto"`. Open the Place, `selectAndOpenMenu(page, "Elara", 1)`, click the item, choose Person, Create. Assert: a `JournalEntry` named `Elara` exists with folder = the campaign folder id and MEJ type `person`; the Place's `text.content` equals `<p>Ask Elara about @UUID[JournalEntry.<id>]{Elara}.</p>` (only the 2nd occurrence) until the retro pass runs — then poll until `TTEfsOther` contains `@UUID[JournalEntry.<id>]{Elara}`; the MEJ shell has a tab for `Elara` and the active tab is still the Place.
2. **Checkbox unchecked** — same setup, uncheck "Link other mentions": after 3 s `TTEfsOther` has no `@UUID` for the new entry; the Place's selected occurrence is linked.
3. **Long selection** — select an 81-character span; the item is absent (`toHaveCount(0)`); MEJ's "Extract to Journal Entry" item is present.
4. **Edit mode** — click the description's edit (feather) button, then `selectAndOpenMenu`; the item is absent.
5. **Remembered type** — create with Place; open the dialog again on another name; the type select's value is `place`.
6. **Contributor** — GM sets the campaign flag `contributors.userIds = [<User 1 id>]` (via `page.evaluate` + `setFlag`) and keeps a seat open; User 1 seat opens the Place (observer), selects "Elara", creates a Person. Assert on the GM seat: entry exists with `ownership.default` equal to the campaign baseline (2 for observer) and the Place is linked; on the User 1 seat: an info toast containing `Created` appears.
7. **Non-contributor / no GM** — User 2 (not listed) sees no item; then close the GM seat, User 1 sees no item.

Also assert no unexpected console errors per seat (`assertNoConsoleErrors`).

- [ ] **Step 2: Run on v14.** Run: `npx playwright test tests/e2e/24-entity-from-selection.spec.mjs` — Expected: 7 passed. On failure, fix the product code (not the assertion) unless the assertion contradicts the spec; record any spec contradiction for the human partner.

- [ ] **Step 3: Run the neighbouring suites for regressions.** Run: `npx playwright test tests/e2e/11-auto-link-scope.spec.mjs tests/e2e/22-auto-link-sessions.spec.mjs tests/e2e/14-campaigns.spec.mjs` — Expected: same pass count as on `main` (run them on `main` first if unsure).

- [ ] **Step 4: v13 smoke.** Run: `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/24-entity-from-selection.spec.mjs -g "GM happy path"` — Expected: pass, or (if the spike found the wrap target missing on 13.06) mark the test `test.skip(TARGET.name === "v13", "<spike finding>")` and assert instead that the item is absent and no error is logged. Record which in the commit message.

- [ ] **Step 5: Commit.**

```bash
git add tests/e2e/24-entity-from-selection.spec.mjs
git commit -m "test(e2e): create entity from selection on v14 and v13

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Docs and release prep (0.21.0)

**Files:**
- Modify: `CHANGELOG.md`, `docs/gm-guide.md`, `docs/player-guide.md`, `module.json`
- Create: `docs/images/entity-from-selection-dialog.png` (screenshot, via the existing `tests/e2e/guide-screenshots.spec.mjs` pattern)

- [ ] **Step 1: CHANGELOG.** Add at the top, in the style of the existing entries:

```markdown
## 0.21.0 (2026-09-2X)

Create entities straight from selected text.

- **Added:** "Create Entity from Selection" in the journal description's right-click menu. Select a name (up to 80 characters), pick a type, and the companion creates the entity in the same folder, turns the selected text into a link to it, and (optionally) links the other mentions using your retroactive auto-link setting.
- **Added:** campaign Contributors (Hub → campaign settings). Listed players and player groups can use the new menu item on that campaign's pages while a GM is connected; the GM's client does the work, so new entities get the campaign's ownership baseline.
```

- [ ] **Step 2: Guides.** GM guide: a short section "Creating an entity from selected text" (steps, the checkbox, the retro-mode interaction, Contributors setting) with the screenshot. Player guide: "If your GM has made you a contributor…" paragraph. Run `npm run check:links` — Expected: pass.

- [ ] **Step 3: Version.** Set `"version": "0.21.0"` in `module.json` and update its download URL the way 0.20.2 did (inspect `git show 3db8a4f -- module.json`).

- [ ] **Step 4: Full verification.** Run `npm test` and the v14 e2e file again. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add CHANGELOG.md docs/gm-guide.md docs/player-guide.md docs/images/entity-from-selection-dialog.png module.json
git commit -m "release: 0.21.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Stop.** PR, merge, tag `0.21.0`, GitHub release, and World A restart follow the usual companion ceremony **after the human partner approves** (PR body without Claude attribution).
