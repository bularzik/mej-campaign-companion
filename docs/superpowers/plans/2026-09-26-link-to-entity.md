# Link to Entity from Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a right-clicked selection matches an existing entity's name, MEJ's description context menu offers "Link to Entity" instead of "Create Entity from Selection", and choosing it links the selection to that entity.

**Architecture:** Pure matching and validation in `logic/entity-from-selection.mjs`, a link-only writer beside the create writer in `logic/entity-from-selection-run.mjs`, the auto-link candidate builder extracted to `hooks/link-candidates.mjs` so both features share it, a link mode on the existing contributor relay, and a second context-menu entry with visibility complementary to Create's.

**Tech Stack:** Foundry VTT 13/14 module (ES modules), vitest unit tests, Playwright e2e against World A (Foundry 14.368, port 30000) and World B (`FOUNDRY_TARGET=v13`, port 30013).

**Spec:** `docs/superpowers/specs/2026-09-26-link-to-entity-design.md`

## Global Constraints

- Companion features never patch MEJ or Foundry; MEJ is reached only through the existing `_getDescriptionContextOptions` wrap.
- Every context-menu entry carries both API spellings: `label`/`name`, `visible`/`condition`, `onClick(event, target)`/`callback(target)`.
- Matching = auto-link's candidate rules exactly (MEJ-typed, campaign link scope, audience containment, not the page's own entry, name ≥ 3 chars) **without** `dropAmbiguousNames`; name comparison = trim, collapse whitespace runs to one space, `toLowerCase`.
- Link never creates an entity and never runs the retro pass.
- The GM never trusts a relayed `entityUuid`: the writer recomputes the matches.
- E2E documents are `TT-` prefixed (this spec's slice: `TT-Lte`) and deleted in cleanup; never touch Radiant Citadel.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Release version `0.23.0`.

## Review Focus

- Selecting the page's own entry name: the page's own entry is excluded, so Create shows (e2e test 3 pins it).
- Closing the picker without choosing writes nothing (e2e test 2 pins it).
- A GM-only entity on a player-visible page is not a match (e2e test 4).
- A relayed link result arriving after the requester's 15 s timeout toasts through the link reporter, not the create reporter (relay unit test, Task 4).
- An unexpected throw on the link path reports "linking failed", not "creation failed" (relay unit test, Task 4).

---

### Task 1: Pure matching and link-mode validation

**Files:**
- Modify: `scripts/logic/entity-from-selection.mjs`
- Test: `test/entity-from-selection.test.js`

**Interfaces:**
- Produces: `normalizeEntityName(s: any) → string`; `matchingEntities(text: string, candidates: {name, uuid}[]) → {name, uuid}[]`; `validateSelectionRequest` accepts link mode (`request.entityUuid !== undefined`).

- [ ] **Step 1: Write the failing tests** — append to `test/entity-from-selection.test.js` and add `normalizeEntityName, matchingEntities` to its import list from `../scripts/logic/entity-from-selection.mjs`:

```js
describe("normalizeEntityName / matchingEntities", () => {
  const C = [
    { name: "Vex", uuid: "A" }, { name: "Old  Mill", uuid: "B" },
    { name: "vex", uuid: "C" }, { name: "Vexa", uuid: "D" }
  ];
  it("normalises: trim, collapse whitespace (incl. nbsp), lower-case", () => {
    expect(normalizeEntityName("  Old   MILL ")).toBe("old mill");
    expect(normalizeEntityName(7)).toBe("");
  });
  it("matches case-insensitively and keeps candidate order", () => {
    expect(matchingEntities("VEX", C)).toEqual([C[0], C[2]]);
  });
  it("collapses inner whitespace on both sides", () => {
    expect(matchingEntities("old mill", C)).toEqual([C[1]]);
  });
  it("no match, empty text, or missing candidates → []", () => {
    expect(matchingEntities("Vexx", C)).toEqual([]);
    expect(matchingEntities("   ", C)).toEqual([]);
    expect(matchingEntities("Vex", null)).toEqual([]);
  });
});

describe("validateSelectionRequest link mode", () => {
  const link = {
    requestId: "r1", pageUuid: "JournalEntry.a.JournalEntryPage.b", fieldKey: "text.content",
    text: "Elara", occurrence: 0, total: 1, entityUuid: "JournalEntry.e"
  };
  const ctx = { sender: { id: "u1", isGM: false }, isContributor: true, canObserve: true, regionKeys: ["text.content"] };
  const v = (patch = {}, cpatch = {}) => validateSelectionRequest({ ...link, ...patch }, { ...ctx, ...cpatch });

  it("accepts without type, name or linkOthers", () => expect(v()).toEqual({ ok: true }));
  it("ignores a bad type/name in link mode", () => expect(v({ type: "session", name: "" })).toEqual({ ok: true }));
  it.each([
    [{ entityUuid: "" }, {}, "bad-payload"],
    [{ entityUuid: 7 }, {}, "bad-payload"],
    [{ entityUuid: null }, {}, "bad-payload"],
    [{ occurrence: 1 }, {}, "bad-payload"],
    [{}, { isContributor: false }, "not-contributor"],
    [{}, { canObserve: false }, "not-visible"],
    [{ fieldKey: "system.gmNotes" }, {}, "bad-field"],
    [{ text: " Elara " }, {}, "bad-selection"]
  ])("rejects %j %j as %s", (patch, cpatch, reason) => {
    expect(v(patch, cpatch)).toEqual({ ok: false, reason });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/entity-from-selection.test.js`
Expected: FAIL — `normalizeEntityName is not a function` (import undefined) and link-mode cases reporting `bad-payload` for the valid request.

- [ ] **Step 3: Implement** — in `scripts/logic/entity-from-selection.mjs`, add after `countOccurrences`:

```js
/** Trim, collapse whitespace runs, lower-case (spec 2026-09-26 §3). */
export function normalizeEntityName(s) {
  return typeof s === "string" ? s.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

/** Candidates (order kept) whose normalised name equals the normalised selection. */
export function matchingEntities(text, candidates) {
  const key = normalizeEntityName(text);
  if (!key) return [];
  return (candidates ?? []).filter((c) => normalizeEntityName(c?.name) === key);
}
```

and replace the body of `validateSelectionRequest` with:

```js
export function validateSelectionRequest(request, ctx) {
  const r = request ?? {};
  // Link mode (spec 2026-09-26 §4.2): an entityUuid replaces type/name/linkOthers.
  const linkMode = r.entityUuid !== undefined;
  if (typeof r.requestId !== "string" || !r.requestId || typeof r.pageUuid !== "string" ||
      typeof r.fieldKey !== "string" || !isIndex(r.occurrence) || !isIndex(r.total) ||
      r.occurrence >= r.total ||
      (linkMode ? (typeof r.entityUuid !== "string" || !r.entityUuid) : typeof r.linkOthers !== "boolean")) {
    return { ok: false, reason: "bad-payload" };
  }
  if (!ctx?.sender || ctx.sender.isGM) return { ok: false, reason: "bad-sender" };
  if (!ctx.isContributor) return { ok: false, reason: "not-contributor" };
  if (!ctx.canObserve) return { ok: false, reason: "not-visible" };
  if (!ctx.regionKeys?.includes(r.fieldKey)) return { ok: false, reason: "bad-field" };
  if (qualifySelection(r.text) !== r.text) return { ok: false, reason: "bad-selection" };
  if (linkMode) return { ok: true };
  if (!ENTITY_TYPES.includes(r.type)) return { ok: false, reason: "bad-type" };
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, reason: "bad-name" };
  return { ok: true };
}
```

Update the JSDoc above it to mention link mode ("Two modes: create (type/name/linkOthers) and link (entityUuid, spec 2026-09-26)").

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/entity-from-selection.test.js`
Expected: PASS, including every pre-existing create-mode case.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/entity-from-selection.mjs test/entity-from-selection.test.js
git commit -m "feat(link-to-entity): name matching and link-mode request validation"
```

---

### Task 2: Link-only writer

**Files:**
- Modify: `scripts/logic/entity-from-selection-run.mjs`
- Test: `test/entity-from-selection-run.test.js`

**Interfaces:**
- Consumes: `linkSelectionInSource` (existing).
- Produces: `runLinkSelection(request, deps) → Promise<{ok:true, entryUuid, linked:boolean} | {ok:false, reason:"page-missing"|"bad-entity"}>`; `request = { pageUuid, fieldKey, text, occurrence, total, entityUuid, maskSecrets? }`; `deps` = `pipelineDeps()` plus `matchesFor(page, fieldKey, text) → {name, uuid}[]`.

- [ ] **Step 1: Write the failing tests** — append to `test/entity-from-selection-run.test.js` and import `runLinkSelection` alongside `runEntityFromSelection`:

```js
describe("runLinkSelection", () => {
  const E = "JournalEntry.e";
  function linkSetup(opts = {}) {
    const s = setup(opts);
    s.deps.matchesFor = vi.fn(() => opts.matches ?? [{ name: "Elara", uuid: E }]);
    return s;
  }
  const lreq = (p = {}) => ({ pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1, entityUuid: E, ...p });

  it("links the occurrence to the chosen entity; never creates or runs the retro pass", async () => {
    const { page, deps } = linkSetup();
    const out = await runLinkSelection(lreq(), deps);
    expect(deps.matchesFor).toHaveBeenCalledWith(page, "text.content", "Elara");
    expect(page.text.content).toBe(`<p>@UUID[${E}]{Elara} waits.</p>`);
    expect(out).toEqual({ ok: true, entryUuid: E, linked: true });
    expect(deps.createMejEntry).not.toHaveBeenCalled();
    expect(deps.runRetroPass).not.toHaveBeenCalled();
  });
  it("an entityUuid that is not among the recomputed matches → bad-entity, nothing written", async () => {
    const { page, deps } = linkSetup({ matches: [{ name: "Elara", uuid: "JournalEntry.other" }] });
    expect(await runLinkSelection(lreq(), deps)).toEqual({ ok: false, reason: "bad-entity" });
    expect(page.update).not.toHaveBeenCalled();
  });
  it("occurrence no longer found → linked:false, nothing written", async () => {
    const { page, deps } = linkSetup({ content: "<p>Elara and Elara.</p>" });
    expect(await runLinkSelection(lreq(), deps)).toEqual({ ok: true, entryUuid: E, linked: false });
    expect(page.update).not.toHaveBeenCalled();
  });
  it("page missing → page-missing", async () => {
    const { deps } = linkSetup();
    expect(await runLinkSelection(lreq({ pageUuid: "gone" }), deps)).toEqual({ ok: false, reason: "page-missing" });
  });
  it("update throws → linked:false, logged", async () => {
    const { deps } = linkSetup({ updateThrows: true });
    expect(await runLinkSelection(lreq(), deps)).toEqual({ ok: true, entryUuid: E, linked: false });
    expect(deps.logError).toHaveBeenCalled();
  });
  it("maskSecrets: a secret occurrence is neither counted nor linked", async () => {
    const { page, deps } = linkSetup({ content: '<section class="secret"><p>Elara</p></section><p>Elara</p>' });
    await runLinkSelection(lreq({ maskSecrets: true }), deps);
    expect(page.text.content).toBe(`<section class="secret"><p>Elara</p></section><p>@UUID[${E}]{Elara}</p>`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/entity-from-selection-run.test.js`
Expected: FAIL — `runLinkSelection is not a function`.

- [ ] **Step 3: Implement** — append to `scripts/logic/entity-from-selection-run.mjs`:

```js
/**
 * "Link to Entity" writer (spec 2026-09-26 §4.3): links the selection to an
 * existing entity. The uuid is re-checked against the matches this client
 * computes now (deps.matchesFor), so a relayed or stale uuid cannot link an
 * entity the selection does not name. Never creates, never runs the retro pass.
 */
export async function runLinkSelection(request, deps) {
  const { pageUuid, fieldKey, text, occurrence, total, entityUuid, maskSecrets } = request;
  const page = await deps.fromUuid(pageUuid);
  if (!page) return { ok: false, reason: "page-missing" };
  const matches = deps.matchesFor(page, fieldKey, text) ?? [];
  if (!matches.some((m) => m.uuid === entityUuid)) return { ok: false, reason: "bad-entity" };

  const newHtml = linkSelectionInSource(deps.getProperty(page, fieldKey), { text, occurrence, total, uuid: entityUuid },
    { maskSecrets: maskSecrets === true });
  if (newHtml === null) return { ok: true, entryUuid: entityUuid, linked: false };
  try {
    await page.update({ [fieldKey]: newHtml });
  } catch (err) {
    deps.logError("link-to-entity: page update failed", err);
    return { ok: true, entryUuid: entityUuid, linked: false };
  }
  return { ok: true, entryUuid: entityUuid, linked: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/entity-from-selection-run.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/entity-from-selection-run.mjs test/entity-from-selection-run.test.js
git commit -m "feat(link-to-entity): link-only writer with GM-side match re-check"
```

---

### Task 3: Shared candidate builder

**Files:**
- Create: `scripts/hooks/link-candidates.mjs`
- Modify: `scripts/hooks/auto-link.mjs`

**Interfaces:**
- Consumes: `matchingEntities` (Task 1).
- Produces: `linkCandidates(page, region) → {name, uuid}[]` (before `dropAmbiguousNames`); `matchesForField(page, fieldKey, text) → {name, uuid}[]`.

This is a move of Foundry-bound code (`game.journal`, `game.users`); it has no unit seam. Its test is the existing auto-link e2e (specs 11 and 22) staying green here, plus spec 28 in Task 5.

- [ ] **Step 1: Create `scripts/hooks/link-candidates.mjs`**

```js
// scripts/hooks/link-candidates.mjs
// Entities that may be linked into one region of a page, shared by the
// typing-path auto-link and Link to Entity (spec 2026-09-26 §4.1). Bounded by
// audience containment (auto-link spec Part 1): an entity qualifies only if
// every non-GM user who can view the page's entry can also view the entity.
// Returned BEFORE dropAmbiguousNames: auto-link drops same-name candidates
// itself ("never guess"); Link to Entity offers them in a picker.
import { selectCandidates } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { linkableRegions, sameLinkScope } from "../logic/link-targets.mjs";
import { campaignIdOf, isLinkableEntity } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { matchingEntities } from "../logic/entity-from-selection.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

/**
 * Every other MEJ-typed JournalEntry in the page's campaign scope whose
 * viewer set contains the region's viewers. A gmOnly region (session GM
 * notes) has no non-GM viewers, so containment passes for every entity in
 * scope.
 */
export function linkCandidates(page, region) {
  const users = game.users.contents;
  const pageViewers = region.gmOnly ? [] : viewerIds(page.parent, users, isVisibleToUser);
  const pageCampaignId = campaignIdOf(page);
  const pages = game.journal
    .filter((entry) => isLinkableEntity(entry, mejType)
      && sameLinkScope(pageCampaignId, campaignIdOf(entry)))
    .map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      indexable: true,
      visible: audienceContains(pageViewers, viewerIds(entry, users, isVisibleToUser))
    }));
  return selectCandidates({ pages, selfId: page.parent?.id });
}

/** Link to Entity's matches for a selection in the field `fieldKey` ([] for an unknown field). */
export function matchesForField(page, fieldKey, text) {
  const region = linkableRegions(page).find((r) => r.key === fieldKey);
  return region ? matchingEntities(text, linkCandidates(page, region)) : [];
}
```

- [ ] **Step 2: Rewire `scripts/hooks/auto-link.mjs`** — delete `buildCandidates` and its JSDoc; replace the imports block with:

```js
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { MODULE_ID, AUTO_LINK_SETTING, NO_AUTO_LINK_FLAG } from "../constants.mjs";
import { linkCandidates } from "./link-candidates.mjs";
```

and the call site with:

```js
        const candidates = dropAmbiguousNames(linkCandidates(page, region)).kept;
```

Keep the file's header comment; append one line to it: `// Candidate building lives in hooks/link-candidates.mjs (shared with Link to Entity).`

- [ ] **Step 3: Unit suite and auto-link e2e**

Run: `npx vitest run > "$WS/t3-unit.txt" 2>&1; tail -5 "$WS/t3-unit.txt"`
Expected: all pass (1037 + Tasks 1–2's new tests).

Run (World A up, 0 real users connected is not required for e2e): `npx playwright test tests/e2e/11-auto-link-scope.spec.mjs tests/e2e/22-auto-link-sessions.spec.mjs > "$WS/t3-e2e.txt" 2>&1; tail -15 "$WS/t3-e2e.txt"`
Expected: same pass/skip counts as on main (0 failed).

- [ ] **Step 4: Commit**

```bash
git add scripts/hooks/link-candidates.mjs scripts/hooks/auto-link.mjs
git commit -m "refactor(auto-link): share the candidate builder with Link to Entity"
```

---

### Task 4: Relay link mode

**Files:**
- Modify: `scripts/hooks/entity-from-selection-relay.mjs`, `scripts/hooks/entity-from-selection.mjs` (`pipelineDeps` only, plus a `showLinkOutcome` stub export that Task 5 fills)
- Test: `test/entity-from-selection-relay.test.js`

**Interfaces:**
- Consumes: `runLinkSelection` (Task 2), `matchesForField` (Task 3).
- Produces: relay env gains `runLink(request)`; request payload may carry `entityUuid`; pending/late meta gains `mode: "link"|"create"`; `pipelineDeps().matchesFor`; `showLinkOutcome(outcome, { name, sheet })` exported from `hooks/entity-from-selection.mjs`.

- [ ] **Step 1: Write the failing tests** — in `test/entity-from-selection-relay.test.js`, add `runLink: vi.fn(async () => ({ ok: true, entryUuid: "JournalEntry.e", linked: true })),` to `gmEnv`'s returned object, then append:

```js
describe("handleEntityRequest link mode (GM)", () => {
  const linkPayload = (p = {}) => ({
    action: "entity-from-selection", requestId: "r1", pageUuid: "P", fieldKey: "text.content",
    text: "Elara", occurrence: 0, total: 1, entityUuid: "JournalEntry.e", ...p
  });
  it("runs the link writer, not the create writer, with maskSecrets and the uuid", async () => {
    const env = gmEnv();
    await handleEntityRequest(linkPayload(), "u1", env);
    expect(env.run).not.toHaveBeenCalled();
    expect(env.runLink).toHaveBeenCalledWith(expect.objectContaining({ entityUuid: "JournalEntry.e", maskSecrets: true }));
    expect(env.emitted[0]).toMatchObject({ recipient: "u1", ok: true, entryUuid: "JournalEntry.e", linked: true });
  });
  it("an empty entityUuid is bad-payload; nothing runs", async () => {
    const env = gmEnv();
    await handleEntityRequest(linkPayload({ entityUuid: "" }), "u1", env);
    expect(env.runLink).not.toHaveBeenCalled();
    expect(env.emitted[0]).toMatchObject({ ok: false, reason: "bad-payload" });
  });
  it("a throw on the link path replies link-failed", async () => {
    const env = gmEnv();
    env.runLink = vi.fn(async () => { throw new Error("boom"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleEntityRequest(linkPayload(), "u1", env);
      expect(env.emitted[0]).toMatchObject({ ok: false, reason: "link-failed" });
    } finally { spy.mockRestore(); }
  });
});

describe("requestEntityViaGm link mode (requester)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("sends entityUuid and tags a late result as a link", async () => {
    const env = {
      emitted: [], emit(m) { this.emitted.push(m); }, userId: "u1", randomId: () => "r9", onLate: vi.fn(),
      users: new Map([["gm1", { id: "gm1", isGM: true }]])
    };
    const p = requestEntityViaGm({ pageUuid: "P", entityUuid: "JournalEntry.e", name: "Elara" }, env);
    expect(env.emitted[0]).toMatchObject({ requestId: "r9", entityUuid: "JournalEntry.e" });
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toEqual({ ok: false, reason: "no-gm" });
    handleEntityResult({ requestId: "r9", recipient: "u1", ok: true, entryUuid: "JournalEntry.e", linked: true }, "gm1", env);
    expect(env.onLate).toHaveBeenCalledWith(expect.objectContaining({ mode: "link", name: "Elara", linked: true }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/entity-from-selection-relay.test.js`
Expected: FAIL — `env.run` called in link mode / `runLink` not called; `mode` missing from late meta; `create-failed` instead of `link-failed`.

- [ ] **Step 3: Implement the relay**

In `scripts/hooks/entity-from-selection-relay.mjs`:

```js
import { runEntityFromSelection, runLinkSelection } from "../logic/entity-from-selection-run.mjs";

const FIELDS = ["pageUuid", "fieldKey", "text", "occurrence", "total", "type", "name", "linkOthers", "entityUuid"];
```

In `foundryEnv()` add beside `run`:

```js
    runLink: async (request) => {
      const { pipelineDeps } = await import("./entity-from-selection.mjs");
      return runLinkSelection(request, pipelineDeps());
    },
```

and replace `onLate` with:

```js
    onLate: async (outcome) => {
      const { showEntityOutcome, showLinkOutcome } = await import("./entity-from-selection.mjs");
      if (outcome.mode === "link") showLinkOutcome(outcome, { name: outcome.name, sheet: null });
      else showEntityOutcome(outcome, { type: outcome.type, name: outcome.name, sheet: null });
    }
```

In `handleEntityRequest`, compute `const linkMode = payload?.entityUuid !== undefined;` right after the `senderId`/`requestId` guard; replace the final run line with:

```js
    return reply(await (linkMode ? env.runLink : env.run)({ ...pick(payload), maskSecrets }));
```

and the catch's reply with `return reply({ ok: false, reason: linkMode ? "link-failed" : "create-failed" });` (declare `linkMode` before the `try`).

In `requestEntityViaGm`: `const meta = { type: request.type, name: request.name, mode: request.entityUuid !== undefined ? "link" : "create" };`

- [ ] **Step 4: `pipelineDeps` and the outcome stub** — in `scripts/hooks/entity-from-selection.mjs` add `import { matchesForField } from "./link-candidates.mjs";`, add `matchesFor: (page, fieldKey, text) => matchesForField(page, fieldKey, text),` to `pipelineDeps()`'s object, and export a placeholder that Task 5 replaces in full:

```js
/** Link to Entity outcome toast (filled in by Task 5). */
export function showLinkOutcome(outcome, { name, sheet }) {}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/entity-from-selection-relay.test.js`
Expected: PASS, pre-existing relay tests included.

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/entity-from-selection-relay.mjs scripts/hooks/entity-from-selection.mjs test/entity-from-selection-relay.test.js
git commit -m "feat(link-to-entity): link mode on the contributor relay"
```

---

### Task 5: Menu entry, picker, outcome, strings, e2e

**Files:**
- Create: `scripts/apps/link-to-entity-dialog.mjs`, `test/link-to-entity-dialog.test.js`, `tests/e2e/28-link-to-entity.spec.mjs`
- Modify: `scripts/hooks/entity-from-selection.mjs`, `lang/en.json`

**Interfaces:**
- Consumes: `matchesForField` (Task 3), `runLinkSelection` (Task 2), `showLinkOutcome` stub (Task 4), `requestViaGm` relay (existing).
- Produces: `linkOptionLabel({name, type, folder}) → string`; `promptLinkTarget(options: {uuid, name, type, folder}[]) → Promise<string|null>`; `eligibilityFromCapture(...)` result gains `matches: {name, uuid}[]`.

- [ ] **Step 1: Failing unit test for the picker label** — `test/link-to-entity-dialog.test.js`:

```js
import { describe, it, expect } from "vitest";
import { linkOptionLabel } from "../scripts/apps/link-to-entity-dialog.mjs";

describe("linkOptionLabel", () => {
  it("joins name, type and folder with em dashes", () => {
    expect(linkOptionLabel({ name: "Vex", type: "Person", folder: "Act I" })).toBe("Vex — Person — Act I");
  });
  it("omits an empty folder or type", () => {
    expect(linkOptionLabel({ name: "Vex", type: "Person", folder: "" })).toBe("Vex — Person");
    expect(linkOptionLabel({ name: "Vex", type: "", folder: "" })).toBe("Vex");
  });
});
```

Run: `npx vitest run test/link-to-entity-dialog.test.js` — Expected: FAIL (module not found).

- [ ] **Step 2: Create `scripts/apps/link-to-entity-dialog.mjs`**

```js
// scripts/apps/link-to-entity-dialog.mjs
// Picker for "Link to Entity" when several entities share the selected name
// (spec 2026-09-26 §4.4).
import { I18N } from "../constants.mjs";

export function linkOptionLabel({ name, type, folder }) {
  return [name, type, folder].filter(Boolean).join(" — ");
}

/** options: {uuid, name, type, folder}[] → the chosen uuid, or null on cancel/close. */
export async function promptLinkTarget(options) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => game.i18n.localize(`${I18N}.entityFromSelection.${k}`);
  const opts = options.map((o) => `<option value="${esc(o.uuid)}">${esc(linkOptionLabel(o))}</option>`).join("");
  const content = `<div class="form-group"><label>${esc(L("pickLabel"))}</label><select name="entity">${opts}</select></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: L("pickTitle") },
    content,
    ok: { label: L("link"), callback: (event, button) => button.form.elements.entity.value },
    rejectClose: false
  });
  return result || null;
}
```

Run: `npx vitest run test/link-to-entity-dialog.test.js` — Expected: PASS.

- [ ] **Step 3: Strings** — in `lang/en.json` under `entityFromSelection`, add after `"menu"`:

```json
      "menuLink": "Link to Entity",
      "pickTitle": "Link to Entity",
      "pickLabel": "Entity",
      "link": "Link",
      "linked": "Linked the selection to {type} \"{name}\".",
      "linkedNot": "Could not link the selection to \"{name}\"; the page text changed.",
      "linkFailed": "Could not link the selection ({reason}).",
      "noGmLink": "No GM responded; nothing was linked.",
```

and under `rejected` add `"bad-entity": "that entity is not a match for the selection",` and `"link-failed": "linking failed",`.

- [ ] **Step 4: Write the failing e2e** — `tests/e2e/28-link-to-entity.spec.mjs`. Copy verbatim from `tests/e2e/24-entity-from-selection.spec.mjs` the imports, `IGNORE`, `MOD`, `VIEWPORT`, `setSettings`, `createCampaignFolder`, `textOf`, `openEntry`, `selectAndOpenMenu`, `newSeat` and `cleanup`; change `PREFIX` to `"TT-Lte"`; give `createMejPage` an `ownership = 2` parameter used as `ownership: { default: ownership }`. Then:

```js
// "Link to Entity" (spec 2026-09-26 §6). Names are run-unique single tokens
// in this spec's "TT-Lte" slice of the harness namespace.
const RUN = Date.now();
const PREFIX = "TT-Lte";
const N = {
  camp: `${PREFIX}Camp${RUN}`, place: `${PREFIX}Place${RUN}`,
  vex: `${PREFIX}Vex${RUN}`, twin: `${PREFIX}Twin${RUN}`, none: `${PREFIX}None${RUN}`
};
const CREATE = "Create Entity from Selection";
const LINK = "Link to Entity";
const item = (page, label) => page.locator("#context-menu li", { hasText: label });
const picker = (page) => page.locator("dialog.application", { hasText: LINK });
const journalCount = (page) => page.evaluate(() => game.journal.size);

test.describe("28 link to entity", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("one match: Link replaces Create and links the selection, whatever its casing", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const lower = N.vex.toLowerCase();
    const place = await createMejPage(page, N.place, `<p>Ask ${lower} now.</p>`, folder);
    const before = await journalCount(page);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, lower);
    await expect(item(page, LINK)).toHaveCount(1);
    await expect(item(page, CREATE)).toHaveCount(0);
    await item(page, LINK).click();

    await expect.poll(() => textOf(page, place.id), { timeout: 10_000 })
      .toBe(`<p>Ask @UUID[${vex.uuid}]{${lower}} now.</p>`);
    expect(await journalCount(page)).toBe(before);
    await expect(page.locator("#notifications li.notification.info", { hasText: "Linked the selection" }))
      .toHaveCount(1, { timeout: 10_000 });
    assertNoConsoleErrors(errors);
  });

  test("two matches: the picker links the chosen one; closing it writes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.twin, "<p>First.</p>", folder, "person");
    const second = await createMejPage(page, N.twin, "<p>Second.</p>", folder, "place");
    const html = `<p>Meet ${N.twin} here.</p>`;
    const place = await createMejPage(page, N.place, html, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.twin);
    await item(page, LINK).click();
    await expect(picker(page)).toBeVisible({ timeout: 10_000 });
    await expect(picker(page).locator("select[name='entity'] option")).toHaveCount(2);
    await picker(page).locator("button[data-action='close'], header button.close").first().click();
    await expect(picker(page)).toHaveCount(0, { timeout: 10_000 });
    await settle(page, 800);
    expect(await textOf(page, place.id)).toBe(html);

    await selectAndOpenMenu(page, N.twin);
    await item(page, LINK).click();
    await expect(picker(page)).toBeVisible({ timeout: 10_000 });
    await picker(page).locator("select[name='entity']").selectOption(second.uuid);
    await picker(page).locator("button[data-action='ok']").click();
    await expect.poll(() => textOf(page, place.id), { timeout: 10_000 })
      .toBe(`<p>Meet @UUID[${second.uuid}]{${N.twin}} here.</p>`);
    assertNoConsoleErrors(errors);
  });

  test("no match, or only the page's own entry: Create shows, Link does not", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>${N.none} and ${N.place}.</p>`, folder);

    await openEntry(page, place.id);
    for (const text of [N.none, N.place]) {
      await selectAndOpenMenu(page, text);
      await expect(item(page, CREATE)).toHaveCount(1);
      await expect(item(page, LINK)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.locator("#context-menu")).toHaveCount(0, { timeout: 5_000 });
    }
    assertNoConsoleErrors(errors);
  });

  test("a GM-only entity is not a match on a player-visible page", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.vex, "<p>Secret person.</p>", folder, "person", 0);
    const place = await createMejPage(page, N.place, `<p>Ask ${N.vex} now.</p>`, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.vex);
    await expect(item(page, CREATE)).toHaveCount(1);
    await expect(item(page, LINK)).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("a campaign contributor links through the GM", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const place = await createMejPage(page, N.place, `<p>Ask ${N.vex} now.</p>`, folder);
    await page.evaluate(async ({ folder, MOD }) => {
      const u1 = game.users.getName("User 1");
      await game.folders.get(folder).setFlag(MOD, "campaign.contributors", { userIds: [u1.id], groupIds: [] });
    }, { folder, MOD });

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.vex);
      await expect(item(u1.page, LINK)).toHaveCount(1);
      await expect(item(u1.page, CREATE)).toHaveCount(0);
      await item(u1.page, LINK).click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(`<p>Ask @UUID[${vex.uuid}]{${N.vex}} now.</p>`);
      await expect(u1.page.locator("#notifications li.notification.info", { hasText: "Linked the selection" }))
        .toHaveCount(1, { timeout: 15_000 });
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });
});
```

Run: `npx playwright test tests/e2e/28-link-to-entity.spec.mjs > "$WS/t5-red.txt" 2>&1; tail -20 "$WS/t5-red.txt"`
Expected: tests 1, 2, 5 FAIL (no "Link to Entity" item); tests 3 and 4 may pass already (they pin Create's existing presence) — record that in the ledger.

- [ ] **Step 5: Implement the hook** — in `scripts/hooks/entity-from-selection.mjs`:

Imports: add `import { runEntityFromSelection, runLinkSelection } from "../logic/entity-from-selection-run.mjs";` (replacing the single import), `import { promptLinkTarget } from "../apps/link-to-entity-dialog.mjs";`, `import { mejType } from "../integrations/mej-adapter.mjs";`.

In `eligibilityFromCapture`, compute matches once the field is known and return them in both branches:

```js
  const fieldKey = lastCapture.display.dataset.key;
  if (!linkableRegions(page).some((r) => r.key === fieldKey)) return null;
  const matches = () => matchesForField(page, fieldKey, capture.text);
  if (game.user.isGM) return sheet.isEditable ? { page, fieldKey, capture, relay: false, matches: matches() } : null;
  const campaign = campaignOf(page);
  if (!campaign || !game.users.activeGM) return null;
  const groups = game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING);
  return isContributor(game.user, campaignFlagOf(campaign), groups)
    ? { page, fieldKey, capture, relay: true, matches: matches() } : null;
```

Replace the Task 4 `showLinkOutcome` stub with:

```js
const typeLabelOf = (entry) => {
  const t = entry ? mejType(entry) : null;
  return t ? game.i18n.localize(game.MonksEnhancedJournal?.getTypeLabels?.()?.[t] ?? t) : "";
};

/** Link to Entity outcome (spec 2026-09-26 §2.5). */
export function showLinkOutcome(outcome, { name, sheet }) {
  const f = (k, d) => game.i18n.format(`${I18N}.entityFromSelection.${k}`, d);
  if (!outcome?.ok) {
    if (outcome?.reason === "no-gm") {
      ui.notifications.warn(game.i18n.localize(`${I18N}.entityFromSelection.noGmLink`));
      return;
    }
    const reason = game.i18n.localize(`${I18N}.entityFromSelection.rejected.${outcome?.reason ?? "link-failed"}`);
    ui.notifications.error(f("linkFailed", { reason }));
    return;
  }
  const entry = fromUuidSync(outcome.entryUuid);
  const shown = entry?.name ?? name;
  if (!outcome.linked) {
    ui.notifications.warn(f("linkedNot", { name: shown }));
    return;
  }
  ui.notifications.info(f("linked", { type: typeLabelOf(entry), name: shown }));
  const host = sheet?.enhancedjournal;
  if (entry && host && entry.testUserPermission(game.user, "OBSERVER")) {
    host.addTab(entry, { activate: false });
    host.render();
  }
}

async function startLinkFromSelection(sheet, target) {
  // Same stashed-capture contract as startFromSelection (ruling 2).
  const ctx = eligibilityFromCapture(sheet, target);
  lastCapture = null;
  if (!ctx?.matches.length) return;
  let match = ctx.matches.length === 1 ? ctx.matches[0] : null;
  try {
    if (!match) {
      const options = ctx.matches.map((m) => {
        const entry = fromUuidSync(m.uuid);
        return { uuid: m.uuid, name: m.name, type: typeLabelOf(entry), folder: entry?.folder?.name ?? "" };
      });
      const uuid = await promptLinkTarget(options);
      match = ctx.matches.find((m) => m.uuid === uuid) ?? null;
      if (!match) return;
    }
    const request = { pageUuid: ctx.page.uuid, fieldKey: ctx.fieldKey, ...ctx.capture, entityUuid: match.uuid, name: match.name };
    const outcome = ctx.relay ? await requestViaGm(request) : await runLinkSelection(request, pipelineDeps());
    showLinkOutcome(outcome, { name: match.name, sheet });
  } catch (err) {
    console.error(`${MODULE_ID} | link-to-entity: startLinkFromSelection failed`, err);
    showLinkOutcome({ ok: false, reason: "link-failed" }, { name: match?.name, sheet });
  }
}
```

In the wrap, replace the single `menu.push({...})` with two entries of complementary visibility:

```js
      const label = game.i18n.localize(`${I18N}.entityFromSelection.menu`);
      const linkLabel = game.i18n.localize(`${I18N}.entityFromSelection.menuLink`);
      // Labels are fixed per menu build, so Create and Link are two entries
      // whose visibility is complementary (spec 2026-09-26 §4.4).
      const canCreate = (t) => { const c = eligibilityFromCapture(sheet, t); return !!c && !c.matches.length; };
      const canLink = (t) => !!eligibilityFromCapture(sheet, t)?.matches.length;
      const create = (t) => startFromSelection(sheet, t);
      const link = (t) => startLinkFromSelection(sheet, t);
      menu.push({
        label, name: label, icon: '<i class="fas fa-user-plus"></i>',
        visible: canCreate, condition: canCreate,
        onClick: (event, t) => create(t), callback: (t) => create(t)
      }, {
        label: linkLabel, name: linkLabel, icon: '<i class="fas fa-link"></i>',
        visible: canLink, condition: canLink,
        onClick: (event, t) => link(t), callback: (t) => link(t)
      });
```

(Keep the existing "Both API shapes (ruling 1)" comment above it.)

- [ ] **Step 6: Run e2e and unit to verify pass**

Run: `npx vitest run > "$WS/t5-unit.txt" 2>&1; tail -5 "$WS/t5-unit.txt"` — Expected: all pass.
Run World A: `npx playwright test tests/e2e/28-link-to-entity.spec.mjs tests/e2e/24-entity-from-selection.spec.mjs > "$WS/t5-a.txt" 2>&1; tail -15 "$WS/t5-a.txt"` — Expected: 28: 5 passed; 24: same as main (0 failed).
Run World B: `FOUNDRY_TARGET=v13 npx playwright test --trace off tests/e2e/28-link-to-entity.spec.mjs tests/e2e/24-entity-from-selection.spec.mjs > "$WS/t5-b.txt" 2>&1; tail -15 "$WS/t5-b.txt"` — Expected: 28: 5 passed; 24: 0 failed.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/link-to-entity-dialog.mjs scripts/hooks/entity-from-selection.mjs lang/en.json test/link-to-entity-dialog.test.js tests/e2e/28-link-to-entity.spec.mjs
git commit -m "feat(link-to-entity): Link to Entity menu entry, picker and outcome toasts"
```

---

### Task 6: Docs, changelog, version

**Files:**
- Modify: `README.md` (section "Create Entity from Selection and campaign Contributors", after line 92's bullet), `docs/gm-guide.md` (after the dialog image near line 223's paragraph block), `docs/player-guide.md` (line 29's paragraph), `CHANGELOG.md`, `module.json`

- [ ] **Step 1: README** — add a bullet after the Create bullet:

```markdown
- When the selection is already the name of an entity (compared ignoring case and extra spaces, among the entities auto-link could link from that field: same campaign scope, visible to everyone who can see the page, not the page's own entry), the menu shows **Link to Entity** instead. With one match it links the selection to that entity at once; with several it asks which. No entity is created and no other mentions are touched.
```

- [ ] **Step 2: GM guide** — after the paragraphs describing the Create dialog and its result, add:

```markdown
If what you selected is already the name of one of your entities — ignoring capitals and extra spaces — the menu shows **Link to Entity** instead of Create Entity from Selection. Choosing it turns the selection into a link to that entity straight away; if more than one entity has that name, a small picker asks which one you mean. Only entities that auto-link could use there count: ones in the same campaign (or unfiled), visible to every player who can see the page, and not the page you're on. So a GM-only NPC named in a player-visible page still offers Create.
```

- [ ] **Step 3: Player guide** — append to line 29's paragraph:

```markdown
If the text you selected is already the name of an entry you can see in that campaign, the item reads **Link to Entity** instead, and choosing it links your selection to that entry rather than making a new one (a picker asks which, if several share the name).
```

- [ ] **Step 4: CHANGELOG and version** — insert above `## 0.22.1`:

```markdown
## 0.23.0 (2026-09-26)

Link to Entity from a selection.

- **Added:** when a right-clicked selection is already the name of an entity auto-link could link there, the description context menu offers **Link to Entity** instead of **Create Entity from Selection**. One match links at once; several open a picker. Campaign contributors get it through the GM, like Create.

```

Set `"version": "0.23.0"` in `module.json`, and update `download`/`manifest` URLs only if they embed the version (check `grep -n 0.22.1 module.json`).

- [ ] **Step 5: Verify**

Run: `npm run check:links && npx vitest run > "$WS/t6-unit.txt" 2>&1; tail -5 "$WS/t6-unit.txt"`
Expected: links pass; unit all pass.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/gm-guide.md docs/player-guide.md CHANGELOG.md module.json
git commit -m "docs: Link to Entity; 0.23.0"
```
