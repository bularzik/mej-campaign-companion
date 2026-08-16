# Campaign Companion Phase B (Knowledge Layer) + Phase A Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mej-campaign-companion` 0.2.0: backlinks, tags + attributes, a relationship graph, query dashboards/embeds, and all five Phase A known-issue fixes.

**Architecture:** Phase B is built entirely inside the companion (no MEJ-side changes). The existing search scan pipeline (`scripts/logic/search-index.mjs` + `scripts/search/live-index.mjs` + `scripts/logic/field-extractors.mjs`) grows a second derived output — an in-memory backlink index — plus structured `meta` (tags/attributes) on each index record. One pure query grammar feeds the Hub dashboards and a `@CampaignQuery` enricher. UI injection uses hooks MEJ already fires (`renderJournalPageSheet` from the shell's `renderSubSheet`, `renderEnhancedJournalSheet` for popped-out sheets, `getDocumentSheetHeaderButtons` for header buttons) — no libWrapper.

**Tech Stack:** Foundry VTT v14 (ApplicationV2/DialogV2), plain ES modules (no build step), vitest, Playwright, vendored `d3-force` (ESM bundle generated one-off with esbuild and committed, like `vendor/docx.iife.js`).

## Global Constraints

- Foundry **v14**; requires MEJ with the extension API (`setupMonksEnhancedJournal`). **No MEJ-side code or API changes** (spec §2).
- All stored companion data lives in `flags["mej-campaign-companion"]` on journal pages or in world settings — **zero writes to MEJ's flag namespace** (spec §3).
- **Permission rule (spec §2, verbatim):** "a backlink row, query result, graph node, or tag is shown only if the viewing user has OBSERVER permission on that entry"; graph edges render only when both endpoints are visible; `playerHidden` attributes index under the `gm:` prefix and are GM-only end to end.
- Plain ES modules, no build step. Vendored artifacts are generated one-off and committed; generators stay devDependencies.
- **Circular-import hazard:** never statically import any `/modules/monks-enhanced-journal/...` file from a module that is (transitively) statically imported by `scripts/campaign-companion.mjs`. MEJ imports are allowed only in modules that are exclusively dynamic-imported from inside the `setupMonksEnhancedJournal` handler (the SessionSheet/CampaignHubPage pattern — see campaign-companion.mjs:91-116's comment).
- `scripts/logic/*.mjs` must stay loadable by vitest directly: no Foundry globals, no `game`, no `foundry.utils`.
- All user-facing strings via i18n keys under the `MEJCampaignCompanion` prefix in `lang/en.json` (en only).
- Unit tests: `npm test` (vitest, `test/*.test.js`). E2e: `npm run test:e2e` (Playwright, `tests/e2e/*.spec.mjs`, world content prefixed `TT-`, GM + player clients). E2e requires a live Foundry at the URL in `playwright.config.mjs` — do not run it during plain unit-test tasks.
- `module.json` `"version"` stays `0.1.0` until Task 14 bumps it to `0.2.0`.
- Commit after each green test cycle; commit messages follow the repo's `feat:`/`fix:`/`test:`/`docs:`/`chore:` convention.

---

### Task 1: Phase A cleanup — media-relay disclaimer + `handleUploadRequest` unit tests

**Files:**
- Modify: `scripts/hooks/media-relay.mjs` (header comment only)
- Test: `test/media-relay-hooks.test.js` (new)

**Interfaces:**
- Consumes: `handleUploadRequest(payload)` and `relayFilename(name)` from `scripts/hooks/media-relay.mjs`; `chunkBase64` from `scripts/logic/media-relay.mjs`.
- Produces: nothing new — tests + docs only.

- [ ] **Step 1: Add the senderId trust-model disclaimer to the module header**

Append this bullet to the header comment block of `scripts/hooks/media-relay.mjs` (after the existing "Reply/upload destination" bullet, before the imports):

```js
//  - Trust model: module sockets carry no authenticated sender, so the
//    payload's `senderId` is a CLAIM, not a verified identity - a malicious
//    client can put any user id there. The GM-side checks below (sender
//    exists, sender can observe the session context) therefore bound what an
//    honest client can do, not what a hostile one can spoof; the real
//    security floor is that uploads are still image-MIME-validated,
//    size-capped, extension-forced, and land only in RELAY_UPLOAD_DIR().
//    Same honest-trust posture as hooks/player-recap.mjs.
```

- [ ] **Step 2: Write failing unit tests for `handleUploadRequest`**

Create `test/media-relay-hooks.test.js`. The module under test touches `game`, `fromUuid`, `atob`, and `foundry.utils.randomID` at call time, so stub globals in `beforeEach` (this repo's tests run under jsdom, where `atob`/`btoa` exist). Model the payload shape on `chunkProblem`/`createRelayAssembler` in `scripts/logic/media-relay.mjs` (already unit-tested in `test/media-relay.test.js` — read it for a valid single-chunk payload fixture). Cover at minimum:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

// Import AFTER stubbing globals if module-eval needs them; media-relay.mjs
// only touches Foundry globals inside functions, so top-level import is safe.
import { handleUploadRequest, handleUploadResult, RelayUploadError } from "../scripts/hooks/media-relay.mjs";

function validPayload(overrides = {}) {
  // Single-chunk upload request: a tiny valid base64 PNG body.
  const data = btoa("fake-png-bytes");
  return {
    action: "relay-upload-media", requestId: "req1", senderId: "user1",
    groupId: "JournalEntry.j1.JournalEntryPage.p1", name: "photo.png",
    type: "image/png", seq: 0, total: 1, data, ...overrides
  };
}

describe("handleUploadRequest", () => {
  let emitted;
  beforeEach(() => {
    emitted = [];
    globalThis.foundry = { utils: { randomID: () => "rid" } };
    globalThis.game = {
      socket: { emit: (channel, msg) => emitted.push({ channel, msg }) },
      users: { get: (id) => (id === "user1" ? { id: "user1" } : undefined) }
    };
    globalThis.JournalEntryPage = class JournalEntryPage {};
    globalThis.fromUuid = vi.fn(async () => {
      const page = new JournalEntryPage();
      page.type = "mej-campaign-companion.session";
      page.parent = { testUserPermission: () => true };
      return page;
    });
  });

  it("replies bad-sender for an unknown senderId", async () => {
    await handleUploadRequest(validPayload({ senderId: "ghost" }));
    expect(emitted[0].msg.error).toBe("bad-sender");
  });

  it("replies bad-context when the uuid is not a session page", async () => {
    globalThis.fromUuid = vi.fn(async () => null);
    await handleUploadRequest(validPayload());
    expect(emitted[0].msg.error).toBe("bad-context");
  });

  it("replies bad-context when the sender cannot observe the session", async () => {
    globalThis.fromUuid = vi.fn(async () => {
      const page = new JournalEntryPage();
      page.type = "mej-campaign-companion.session";
      page.parent = { testUserPermission: () => false };
      return page;
    });
    await handleUploadRequest(validPayload());
    expect(emitted[0].msg.error).toBe("bad-context");
  });

  it("replies an error for an invalid assembled request (bad MIME)", async () => {
    await handleUploadRequest(validPayload({ type: "text/html", name: "evil.html" }));
    expect(emitted[0].msg.error).toBeTruthy();
  });

  it("uploads and replies {path} on the success path", async () => {
    // uploadCompanionFile hits Foundry's FilePicker - mock the module import.
    // vi.mock must reference the specifier exactly as media-relay.mjs imports it.
    // (Hoist this mock to the top of the file, above the imports:)
    // vi.mock("../scripts/apps/import-upload.mjs", () => ({
    //   uploadCompanionFile: vi.fn(async () => "worlds/w/mej-campaign-companion/uploads/rid-photo.png")
    // }));
    await handleUploadRequest(validPayload());
    expect(emitted[0].msg.path).toContain("uploads/");
  });
});
```

Notes for the implementer: the success-path test needs `vi.mock("../scripts/apps/import-upload.mjs", ...)` hoisted to the top of the file (vitest hoists `vi.mock` calls automatically), plus `globalThis.File`/`Uint8Array` behavior — jsdom provides `File`. If `game.world` or other globals turn out to be touched (run and see), stub minimally. Do not modify `media-relay.mjs`'s logic to make tests pass — stubs only. Each test uses a distinct `requestId` (the module-level assembler is shared across tests) — adjust `validPayload` per test (`req1`, `req2`, …) or reset by completing each request.

- [ ] **Step 3: Run the new tests; verify they fail only for the right reason**

Run: `npx vitest run test/media-relay-hooks.test.js`
Expected: tests fail before stubs are complete / pass once stubs are right. Iterate until green — the production code is already written; this task is characterization coverage.

- [ ] **Step 4: Run the whole unit suite**

Run: `npm test`
Expected: all tests pass (375 existing + new).

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/media-relay.mjs test/media-relay-hooks.test.js
git commit -m "test: unit-cover handleUploadRequest validation; document senderId trust model"
```

---

### Task 2: Phase A cleanup — dead-module removal + export-dialog run-segmentation coverage

**Files:**
- Delete: `scripts/logic/auto-link-baseline.mjs`, `test/auto-link-baseline.test.js` (pending Step 1 verification)
- Create: `scripts/logic/docx-runs.mjs`
- Modify: `scripts/apps/export-dialog.mjs` (use the extracted helpers)
- Test: `test/docx-runs.test.js` (new)

**Interfaces:**
- Produces: `segmentRunText(text) -> {text: string, lineBreak: boolean}[]` and `subtitleRuns(node) -> run[]` in `scripts/logic/docx-runs.mjs`.

- [ ] **Step 1: Verify which logic modules are truly dead**

Run, from the repo root:

```bash
for f in scripts/logic/*.mjs; do b=$(basename "$f"); \
  n=$(grep -rl "from \".*logic/$b\"" scripts | grep -v "^$f$" | wc -l | tr -d ' '); \
  echo "$b: $n real importers"; done
```

This matches actual `from "…"` import specifiers (single- or multi-line imports both end with the specifier on the `from` line), not comment mentions. Expected result: only `auto-link-baseline.mjs` has 0 real importers (a prior single-line-`import`-pattern check falsely flagged `doc-export-snapshot.mjs`, which `scripts/apps/export-dialog.mjs` imports via a multi-line import — do not delete it). Delete each 0-importer module **and its test file**, and remove the stale reference to `auto-link-baseline.mjs` from the comment at `scripts/hooks/auto-link.mjs:36` (reword the comment to describe the behavior without naming the deleted file). If a module unexpectedly has importers, keep it and note that in the task report.

- [ ] **Step 2: Write failing tests for the extracted run-segmentation helpers**

Create `test/docx-runs.test.js`. The rules under test are exactly the ones documented in `export-dialog.mjs`'s `toRuns` comment (a run's text splits on `"\n"`; segments after the first carry a line break; an empty FIRST segment is dropped, so text `"\n"` becomes one empty-text segment with a break):

```js
import { describe, it, expect } from "vitest";
import { segmentRunText, subtitleRuns } from "../scripts/logic/docx-runs.mjs";

describe("segmentRunText", () => {
  it("passes plain text through as one non-breaking segment", () => {
    expect(segmentRunText("hello")).toEqual([{ text: "hello", lineBreak: false }]);
  });
  it("splits on \\n with breaks on every segment after the first", () => {
    expect(segmentRunText("a\nb\nc")).toEqual([
      { text: "a", lineBreak: false },
      { text: "b", lineBreak: true },
      { text: "c", lineBreak: true }
    ]);
  });
  it("drops an empty first segment: '\\n' becomes one empty breaking segment", () => {
    expect(segmentRunText("\n")).toEqual([{ text: "", lineBreak: true }]);
  });
  it("keeps empty middle/trailing segments as break-only segments", () => {
    expect(segmentRunText("a\n\nb")).toEqual([
      { text: "a", lineBreak: false },
      { text: "", lineBreak: true },
      { text: "b", lineBreak: true }
    ]);
  });
});

describe("subtitleRuns", () => {
  it("forces italics on every run of a subtitle paragraph", () => {
    const node = { kind: "paragraph", style: "subtitle", runs: [{ text: "x", bold: true }] };
    expect(subtitleRuns(node)).toEqual([{ text: "x", bold: true, italics: true }]);
  });
  it("returns runs unchanged for non-subtitle paragraphs", () => {
    const node = { kind: "paragraph", runs: [{ text: "x" }] };
    expect(subtitleRuns(node)).toBe(node.runs);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/docx-runs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `scripts/logic/docx-runs.mjs`**

```js
/**
 * Pure run-shaping helpers for the docx export (scripts/apps/export-dialog.mjs).
 * Extracted so the <br>-handling rules (documented on export-dialog.mjs's
 * toRuns) are unit-testable without the vendored docx bundle.
 */

/**
 * Split a doc-model run's text on "\n" into docx-ready segments.
 * Segments after the first carry `lineBreak: true` (a break BEFORE the
 * text); an empty FIRST segment is dropped, so "\n" yields exactly one
 * empty-text breaking segment.
 * @param {string} text
 * @returns {{text: string, lineBreak: boolean}[]}
 */
export function segmentRunText(text) {
  return String(text ?? "").split("\n")
    .map((seg, i) => (i === 0 ? (seg ? { text: seg, lineBreak: false } : null) : { text: seg, lineBreak: true }))
    .filter(Boolean);
}

/** Subtitle paragraphs render italic ("IntenseQuote" is absent from the vendored docx build). */
export function subtitleRuns(node) {
  return node.style === "subtitle" ? node.runs.map((r) => ({ ...r, italics: true })) : node.runs;
}
```

- [ ] **Step 5: Wire export-dialog.mjs through the helpers**

In `scripts/apps/export-dialog.mjs`:
1. Add `import { segmentRunText, subtitleRuns } from "../logic/docx-runs.mjs";`
2. Replace `toRuns`'s inline `r.text.split("\n").map(...)` body with:

```js
  const toRuns = (runs) => runs.map((r) => {
    const make = (text, extra = {}) => new TextRun({
      text, bold: r.bold, italics: r.italics,
      underline: r.underline ? {} : undefined, strike: r.strike, ...extra
    });
    const segments = segmentRunText(r.text).map((seg) => make(seg.text, seg.lineBreak ? { break: 1 } : {}));
    return r.link ? new ExternalHyperlink({ children: segments, link: r.link }) : segments;
  }).flat();
```

3. In the `node.kind === "paragraph"` branch, replace the inline subtitle ternary with `const runs = subtitleRuns(node);` (drop the now-duplicated comment into docx-runs.mjs if not already there).

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass (including the deleted test file no longer running).

- [ ] **Step 7: Commit**

```bash
git add -A scripts/logic test scripts/apps/export-dialog.mjs scripts/hooks/auto-link.mjs
git commit -m "chore: remove dead auto-link-baseline module; extract+test docx run segmentation"
```

---

### Task 3: Phase A cleanup — GitHub Actions CI (unit suite)

**Files:**
- Create: `.github/workflows/test.yml`
- Possibly create: `package-lock.json` (if absent)

**Interfaces:** none.

- [ ] **Step 1: Ensure a lockfile exists**

Run: `ls package-lock.json || npm install --package-lock-only`
If it was just generated, verify `git status` shows only `package-lock.json` as new.

- [ ] **Step 2: Create the workflow**

`.github/workflows/test.yml`:

```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Playwright e2e (npm run test:e2e) is intentionally NOT run here:
      # it needs a live, unlocked local Foundry v14 world (see README).
      - run: npm test
```

- [ ] **Step 3: Verify the suite passes with a clean install locally**

Run: `npm ci && npm test`
Expected: install succeeds from the lockfile; all tests pass.

- [ ] **Step 4: Commit and push, then confirm the run**

```bash
git add .github/workflows/test.yml package-lock.json
git commit -m "chore: add GitHub Actions CI running the unit suite"
git push origin main
```

Then run `gh run watch --exit-status $(gh run list --workflow=test --limit 1 --json databaseId -q '.[0].databaseId')` (or `gh run list --workflow=test --limit 1` and poll) to confirm the first CI run is green. If it fails for an environment reason, fix the workflow and re-push before marking this task complete.

---

### Task 4: Tags + attributes — flags helpers and index integration

**Files:**
- Create: `scripts/logic/knowledge-flags.mjs`
- Modify: `scripts/logic/search-index.mjs` (store `meta` on records)
- Modify: `scripts/search/live-index.mjs` (`recordFor`: tags, attribute fields, meta)
- Test: `test/knowledge-flags.test.js` (new), `test/search-index.test.js` (extend)

**Interfaces:**
- Produces (`scripts/logic/knowledge-flags.mjs`):
  - `getTags(page) -> string[]` — reads `page.flags["mej-campaign-companion"].tags`, returns trimmed, non-empty, case-preserving, deduped (case-insensitive) strings.
  - `getAttributes(page) -> {id: string, key: string, value: string, playerHidden: boolean}[]` — reads `page.flags["mej-campaign-companion"].attributes`, drops malformed rows (non-string key/value or empty key).
  - `splitAttributeText(attributes) -> {visible: string, hidden: string}` — joins `"key value"` pairs into two searchable strings by `playerHidden`.
  - `normalizeTagInput(raw) -> string[]` — splits a comma-separated input string into normalized tags.
- Produces (`scripts/logic/search-index.mjs`): indexed records now carry `meta: {tags: string[], attrs: {key,value,playerHidden}[]}` (defaults `{tags: [], attrs: []}` when the incoming record has none).
- Produces (`scripts/search/live-index.mjs`): every indexed record has `tags`, `meta`, and (when attributes exist) `fields.companionAttributes` / `gmFields.companionAttributes`.

- [ ] **Step 1: Write failing tests for knowledge-flags**

`test/knowledge-flags.test.js`:

```js
import { describe, it, expect } from "vitest";
import { getTags, getAttributes, splitAttributeText, normalizeTagInput } from "../scripts/logic/knowledge-flags.mjs";

const FLAGS = "mej-campaign-companion";
const page = (cc) => ({ flags: { [FLAGS]: cc } });

describe("getTags", () => {
  it("returns [] for missing flags", () => {
    expect(getTags({})).toEqual([]);
    expect(getTags(page({}))).toEqual([]);
  });
  it("trims, drops empties, and dedupes case-insensitively keeping first casing", () => {
    expect(getTags(page({ tags: [" Villain ", "", "villain", "ally", 7] }))).toEqual(["Villain", "ally"]);
  });
});

describe("getAttributes", () => {
  it("returns [] for missing flags and drops malformed rows", () => {
    expect(getAttributes({})).toEqual([]);
    const rows = getAttributes(page({ attributes: [
      { id: "a1", key: "faction", value: "Zhentarim", playerHidden: false },
      { id: "a2", key: "", value: "x" },
      { id: "a3", key: "secret", value: "yes", playerHidden: true },
      "junk"
    ] }));
    expect(rows).toEqual([
      { id: "a1", key: "faction", value: "Zhentarim", playerHidden: false },
      { id: "a3", key: "secret", value: "yes", playerHidden: true }
    ]);
  });
});

describe("splitAttributeText", () => {
  it("routes playerHidden rows to hidden", () => {
    expect(splitAttributeText([
      { id: "a1", key: "faction", value: "Zhentarim", playerHidden: false },
      { id: "a2", key: "patron", value: "Asmodeus", playerHidden: true }
    ])).toEqual({ visible: "faction Zhentarim", hidden: "patron Asmodeus" });
  });
});

describe("normalizeTagInput", () => {
  it("splits on commas, trims, dedupes", () => {
    expect(normalizeTagInput(" a, b ,, a ")).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/knowledge-flags.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `scripts/logic/knowledge-flags.mjs`**

```js
/**
 * Pure readers/normalizers for the companion's Phase B knowledge flags
 * (tags + attributes) on MEJ journal pages. Foundry-free (vitest-loadable).
 * Flag shapes (spec §3, all under flags["mej-campaign-companion"]):
 *   tags:       string[]
 *   attributes: [{id, key, value, playerHidden}]
 */
const COMPANION_FLAGS = "mej-campaign-companion";

function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function getTags(page) {
  return dedupeTags(page?.flags?.[COMPANION_FLAGS]?.tags ?? []);
}

export function getAttributes(page) {
  const rows = page?.flags?.[COMPANION_FLAGS]?.attributes ?? [];
  return (Array.isArray(rows) ? rows : []).filter(
    (r) => r && typeof r === "object" && typeof r.key === "string" && r.key.length && typeof r.value === "string"
  ).map((r) => ({ id: String(r.id ?? ""), key: r.key, value: r.value, playerHidden: r.playerHidden === true }));
}

export function splitAttributeText(attributes) {
  const join = (rows) => rows.map((r) => `${r.key} ${r.value}`.trim()).join(" ");
  const hidden = (attributes ?? []).filter((r) => r.playerHidden);
  const visible = (attributes ?? []).filter((r) => !r.playerHidden);
  return { visible: join(visible), hidden: join(hidden) };
}

export function normalizeTagInput(raw) {
  return dedupeTags(String(raw ?? "").split(","));
}
```

- [ ] **Step 4: Run** — `npx vitest run test/knowledge-flags.test.js` → PASS.

- [ ] **Step 5: Extend search-index to store `meta`; test first**

Append to `test/search-index.test.js`:

```js
describe("record meta", () => {
  it("stores meta on the record and defaults it", () => {
    const index = createIndex();
    indexRecord(index, { uuid: "u1", name: "A", type: "person", tags: ["x"], fields: {}, gmFields: {},
      meta: { tags: ["x"], attrs: [{ key: "k", value: "v", playerHidden: false }] } });
    indexRecord(index, { uuid: "u2", name: "B", type: "place", fields: {}, gmFields: {} });
    expect(index.records.get("u1").meta.attrs[0].key).toBe("k");
    expect(index.records.get("u2").meta).toEqual({ tags: [], attrs: [] });
  });
});
```

Run it (FAIL), then in `scripts/logic/search-index.mjs`'s `indexRecord`, extend the stored record object:

```js
  index.records.set(record.uuid, {
    uuid: record.uuid, name: record.name, type: record.type, texts, gmOnly, tokens,
    meta: record.meta ?? { tags: record.tags ?? [], attrs: [] }
  });
```

Run again → PASS.

- [ ] **Step 6: Wire tags/attributes into `recordFor` in `scripts/search/live-index.mjs`**

Add the import `import { getTags, getAttributes, splitAttributeText } from "../logic/knowledge-flags.mjs";` and, in `recordFor(page, type)`, after the person-attributes block and before `return record;`:

```js
  // Phase B knowledge flags: tags feed the already-supported record.tags
  // field (search-index.mjs joins them into fields.tags), companion
  // attributes get their own public/GM field pair, and both land in
  // record.meta for the query grammar's structured type:/tag:/attr: filters.
  record.tags = getTags(page);
  const ccAttrs = getAttributes(page);
  const { visible, hidden } = splitAttributeText(ccAttrs);
  if (visible) record.fields.companionAttributes = visible;
  if (hidden) record.gmFields.companionAttributes = hidden;
  record.meta = { tags: record.tags, attrs: ccAttrs };
```

- [ ] **Step 7: Run the whole suite** — `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/knowledge-flags.mjs scripts/logic/search-index.mjs scripts/search/live-index.mjs test/knowledge-flags.test.js test/search-index.test.js
git commit -m "feat: tags + attributes flags, indexed and carried as record meta"
```

---

### Task 5: Backlink index — pure module

**Files:**
- Create: `scripts/logic/backlink-index.mjs`
- Test: `test/backlink-index.test.js` (new)

**Interfaces:**
- Produces (`scripts/logic/backlink-index.mjs`):
  - `normalizeTargetUuid(uuid) -> string` — `"JournalEntry.X.JournalEntryPage.Y"` → `"JournalEntry.X"`; anything else unchanged.
  - `extractRefs(record) -> {refs: Map<string, number>, gmRefs: Map<string, number>}` — parses `@UUID[...]` from every value of `record.fields` / `record.gmFields`; targets normalized; refs to `record.uuid` itself excluded; a target already present in `refs` is not duplicated into `gmRefs`.
  - `createBacklinkIndex() -> {outbound: Map, inbound: Map}`
  - `setSourceRefs(bidx, sourceUuid, {refs, gmRefs})` — replaces the source's outbound set and patches `inbound` accordingly.
  - `removeSourceRefs(bidx, sourceUuid)`
  - `backlinksFor(bidx, targetUuid, {gm}) -> {uuid, count, gmOnly}[]` — sources mentioning `targetUuid`; `gmOnly` rows only when `gm: true`; sorted by count desc then uuid.
  - `visibleMentionCounts(bidx, {gm, canSee}) -> Map<string, number>` — per-target count of mentions from sources where `(gm || !gmOnly) && canSee(sourceUuid)`.

- [ ] **Step 1: Write failing tests**

`test/backlink-index.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  normalizeTargetUuid, extractRefs, createBacklinkIndex,
  setSourceRefs, removeSourceRefs, backlinksFor, visibleMentionCounts
} from "../scripts/logic/backlink-index.mjs";

describe("normalizeTargetUuid", () => {
  it("collapses page uuids to the parent entry", () => {
    expect(normalizeTargetUuid("JournalEntry.a1.JournalEntryPage.p1")).toBe("JournalEntry.a1");
    expect(normalizeTargetUuid("JournalEntry.a1")).toBe("JournalEntry.a1");
    expect(normalizeTargetUuid("Actor.x9")).toBe("Actor.x9");
  });
});

describe("extractRefs", () => {
  const record = {
    uuid: "JournalEntry.self",
    fields: {
      text: 'Met @UUID[JournalEntry.npc1]{Bob} and @UUID[JournalEntry.npc1.JournalEntryPage.p]{Bob again} at @UUID[JournalEntry.place1]',
      other: "@UUID[JournalEntry.self]{me} nothing"
    },
    gmFields: { gmNotes: "@UUID[JournalEntry.secret1]{S} and @UUID[JournalEntry.npc1]" }
  };
  it("counts public refs per normalized target, excluding self-links", () => {
    const { refs } = extractRefs(record);
    expect(refs.get("JournalEntry.npc1")).toBe(2);
    expect(refs.get("JournalEntry.place1")).toBe(1);
    expect(refs.has("JournalEntry.self")).toBe(false);
  });
  it("routes gm-field refs to gmRefs unless already publicly referenced", () => {
    const { refs, gmRefs } = extractRefs(record);
    expect(gmRefs.get("JournalEntry.secret1")).toBe(1);
    expect(gmRefs.has("JournalEntry.npc1")).toBe(false); // already public
    expect(refs.has("JournalEntry.secret1")).toBe(false);
  });
});

describe("backlink index CRUD + queries", () => {
  const seeded = () => {
    const bidx = createBacklinkIndex();
    setSourceRefs(bidx, "JournalEntry.a", { refs: new Map([["JournalEntry.t", 2]]), gmRefs: new Map() });
    setSourceRefs(bidx, "JournalEntry.b", { refs: new Map(), gmRefs: new Map([["JournalEntry.t", 1]]) });
    return bidx;
  };
  it("backlinksFor hides gmOnly sources from players", () => {
    const bidx = seeded();
    expect(backlinksFor(bidx, "JournalEntry.t", { gm: false })).toEqual([{ uuid: "JournalEntry.a", count: 2, gmOnly: false }]);
    expect(backlinksFor(bidx, "JournalEntry.t", { gm: true })).toEqual([
      { uuid: "JournalEntry.a", count: 2, gmOnly: false },
      { uuid: "JournalEntry.b", count: 1, gmOnly: true }
    ]);
  });
  it("setSourceRefs replaces prior refs; removeSourceRefs clears them", () => {
    const bidx = seeded();
    setSourceRefs(bidx, "JournalEntry.a", { refs: new Map([["JournalEntry.z", 1]]), gmRefs: new Map() });
    expect(backlinksFor(bidx, "JournalEntry.t", { gm: false })).toEqual([]);
    expect(backlinksFor(bidx, "JournalEntry.z", { gm: false })).toHaveLength(1);
    removeSourceRefs(bidx, "JournalEntry.a");
    expect(backlinksFor(bidx, "JournalEntry.z", { gm: false })).toEqual([]);
  });
  it("visibleMentionCounts honors gm and canSee", () => {
    const bidx = seeded();
    const counts = visibleMentionCounts(bidx, { gm: true, canSee: (u) => u !== "JournalEntry.b" });
    expect(counts.get("JournalEntry.t")).toBe(2); // b's gm mention filtered by canSee
    const playerCounts = visibleMentionCounts(bidx, { gm: false, canSee: () => true });
    expect(playerCounts.get("JournalEntry.t")).toBe(2); // gmOnly source excluded, a's count=2
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/backlink-index.test.js` → FAIL.

- [ ] **Step 3: Implement `scripts/logic/backlink-index.mjs`**

```js
/**
 * Pure backlink ("mentioned in") index derived from search-index records.
 * A mention is an @UUID[...] reference inside any indexed field's raw value
 * (auto-link converts plain-prose names into @UUID links, so prose mentions
 * arrive here transitively - spec §2). Never persisted; rebuilt/maintained
 * alongside the search index by scripts/search/live-index.mjs.
 *
 * Structure:
 *   outbound: Map<sourceUuid, {refs: Map<target,count>, gmRefs: Map<target,count>}>
 *   inbound:  Map<targetUuid, Map<sourceUuid, {count, gmOnly}>>
 */

const UUID_RE = /@UUID\[([^\]#]+)(?:#[^\]]*)?\](?:\{[^}]*\})?/g;
const PAGE_RE = /^(JournalEntry\.[^.]+)\.JournalEntryPage\.[^.]+$/;

export function normalizeTargetUuid(uuid) {
  const match = PAGE_RE.exec(uuid);
  return match ? match[1] : uuid;
}

function countRefs(values, sourceUuid) {
  const counts = new Map();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    for (const match of raw.matchAll(UUID_RE)) {
      const target = normalizeTargetUuid(match[1]);
      if (target === sourceUuid) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

/** Parse a search-index record's raw field values into public/GM ref maps. */
export function extractRefs(record) {
  const refs = countRefs(Object.values(record.fields ?? {}), record.uuid);
  const gmRefs = countRefs(Object.values(record.gmFields ?? {}), record.uuid);
  for (const target of refs.keys()) gmRefs.delete(target); // public wins
  return { refs, gmRefs };
}

export function createBacklinkIndex() {
  return { outbound: new Map(), inbound: new Map() };
}

export function removeSourceRefs(bidx, sourceUuid) {
  const prev = bidx.outbound.get(sourceUuid);
  if (!prev) return;
  bidx.outbound.delete(sourceUuid);
  for (const target of [...prev.refs.keys(), ...prev.gmRefs.keys()]) {
    const bySource = bidx.inbound.get(target);
    if (!bySource) continue;
    bySource.delete(sourceUuid);
    if (!bySource.size) bidx.inbound.delete(target);
  }
}

export function setSourceRefs(bidx, sourceUuid, { refs, gmRefs }) {
  removeSourceRefs(bidx, sourceUuid);
  if (!refs.size && !gmRefs.size) return;
  bidx.outbound.set(sourceUuid, { refs, gmRefs });
  const add = (map, gmOnly) => {
    for (const [target, count] of map) {
      let bySource = bidx.inbound.get(target);
      if (!bySource) bidx.inbound.set(target, (bySource = new Map()));
      bySource.set(sourceUuid, { count, gmOnly });
    }
  };
  add(refs, false);
  add(gmRefs, true);
}

export function backlinksFor(bidx, targetUuid, { gm = false } = {}) {
  const bySource = bidx.inbound.get(targetUuid);
  if (!bySource) return [];
  const rows = [];
  for (const [uuid, { count, gmOnly }] of bySource) {
    if (gmOnly && !gm) continue;
    rows.push({ uuid, count, gmOnly });
  }
  return rows.sort((a, b) => b.count - a.count || a.uuid.localeCompare(b.uuid));
}

export function visibleMentionCounts(bidx, { gm = false, canSee = () => true } = {}) {
  const counts = new Map();
  for (const [target, bySource] of bidx.inbound) {
    let n = 0;
    for (const [source, { count, gmOnly }] of bySource) {
      if (gmOnly && !gm) continue;
      if (!canSee(source)) continue;
      n += count;
    }
    if (n) counts.set(target, n);
  }
  return counts;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/backlink-index.test.js` → PASS; then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/backlink-index.mjs test/backlink-index.test.js
git commit -m "feat: pure backlink index (extract @UUID refs, inbound/outbound maps)"
```

---

### Task 6: Backlinks — live glue in `scripts/search/live-index.mjs`

**Files:**
- Modify: `scripts/search/live-index.mjs`

**Interfaces:**
- Consumes: everything Task 5 produced.
- Produces (new exports from `scripts/search/live-index.mjs`; all lazily build the index first):
  - `backlinksForEntry(targetUuid) -> {uuid, name, type, count, gmOnly}[]` — permission-filtered for `game.user` (source resolvable + GM or OBSERVER; gmOnly rows GM-only).
  - `mentionBadgeCounts() -> Map<entryUuid, number>` — permission-filtered per current user.
  - `backlinkPairs() -> {source, target, count, gmOnly}[]` — raw pairs for the graph, GM-filtered only (`gmOnly` pairs dropped for non-GM); node-level permission filtering happens in the graph assembly (Task 11/12).

- [ ] **Step 1: Maintain the backlink index alongside the search index**

In `scripts/search/live-index.mjs`:

1. Add imports:
```js
import { createBacklinkIndex, extractRefs, setSourceRefs, removeSourceRefs, backlinksFor, visibleMentionCounts } from "../logic/backlink-index.mjs";
```
2. Add module state next to `let index = null;`: `let backlinks = null;`
3. In `indexPage(page)`, after `indexRecord(index, ...)` — restructure so the record is computed once:
```js
function indexPage(page) {
  const type = mejType(page);
  if (!type) return;
  const record = recordFor(page, type);
  indexRecord(index, record);
  setSourceRefs(backlinks, record.uuid, extractRefs(record));
}
```
4. In `unindexPage(page)`, add `removeSourceRefs(backlinks, uuid);` after `removeRecord(index, uuid);`
5. In `buildIndex()`, build both: at the top `const blx = createBacklinkIndex();`, inside the loop compute `const record = recordFor(page, type);` then `indexRecord(idx, record); setSourceRefs(blx, record.uuid, extractRefs(record));`, and change the function to `return { idx, blx };`. Update `ensureIndex`/`rebuildIndex`:
```js
export function ensureIndex() {
  if (!index) {
    const built = buildIndex();
    index = built.idx;
    backlinks = built.blx;
  }
  return index;
}
export function rebuildIndex() {
  const built = buildIndex();
  index = built.idx;
  backlinks = built.blx;
  return index;
}
```

- [ ] **Step 2: Add the three permission-aware exports**

Append to `scripts/search/live-index.mjs`:

```js
/** Can the current user see this entry uuid at all (spec §2's OBSERVER gate)? */
function userCanSee(uuid) {
  const entry = fromUuidSync(uuid);
  if (!entry) return false;
  return game.user.isGM || entry.testUserPermission(game.user, "OBSERVER") === true;
}

/**
 * "Mentioned in" rows for one entry, permission-filtered for the current
 * user: gmOnly mentions are GM-only, and a source entry the user can't
 * observe is dropped entirely (its existence must not leak).
 */
export function backlinksForEntry(targetUuid) {
  const idx = ensureIndex();
  return backlinksFor(backlinks, targetUuid, { gm: game.user.isGM })
    .filter(({ uuid }) => userCanSee(uuid))
    .map(({ uuid, count, gmOnly }) => {
      const rec = idx.records.get(uuid);
      return { uuid, count, gmOnly, name: rec?.name ?? fromUuidSync(uuid)?.name ?? uuid, type: rec?.type ?? "" };
    });
}

/** Per-entry visible-mention counts for the Hub index badges. */
export function mentionBadgeCounts() {
  ensureIndex();
  return visibleMentionCounts(backlinks, { gm: game.user.isGM, canSee: (uuid) => userCanSee(uuid) });
}

/** Raw source→target pairs for the graph overlay (gmOnly pairs GM-only). */
export function backlinkPairs() {
  ensureIndex();
  const pairs = [];
  for (const [source, { refs, gmRefs }] of backlinks.outbound) {
    for (const [target, count] of refs) pairs.push({ source, target, count, gmOnly: false });
    if (game.user.isGM) for (const [target, count] of gmRefs) pairs.push({ source, target, count, gmOnly: true });
  }
  return pairs;
}
```

- [ ] **Step 3: Run the unit suite** — `npm test` → PASS (live-index isn't unit-covered; this confirms no import breakage).

- [ ] **Step 4: Commit**

```bash
git add scripts/search/live-index.mjs
git commit -m "feat: maintain backlink index alongside the live search index"
```

---

### Task 7: Query grammar

**Files:**
- Create: `scripts/logic/query-grammar.mjs`
- Modify: `scripts/search/live-index.mjs` (add `runQueryAll`)
- Test: `test/query-grammar.test.js` (new)

**Interfaces:**
- Produces (`scripts/logic/query-grammar.mjs`):
  - `parseQuery(str) -> {types: string[], tags: string[], attrs: {key: string, value: string|null}[], text: string}` — tokens `type:person`, `tag:villain`, `attr:faction` / `attr:faction=Zhentarim`; everything else joins into `text`. Prefixes case-insensitive; values keep case. Throws `new Error("empty-query")` when nothing remains after parsing.
  - `matchesMeta(rec, parsed, {gm}) -> boolean` — `rec` is a search-index record (`{type, meta:{tags, attrs}}`). All conditions AND. Tag matching case-insensitive; attr key case-insensitive, value (when given) case-insensitive substring; `playerHidden` attrs only match when `gm`.
  - `runQuery(index, queryString, {gm}) -> {uuid, name, type, matches}[]` — with `text`: results of `search(index, text, {gm})` filtered by `matchesMeta`; without: every record matching meta (sorted by name), `matches: []`.
- Produces (`scripts/search/live-index.mjs`): `runQueryAll(queryString) -> hits[]` — `runQuery` + the same per-entry permission filter `searchAll` uses.

- [ ] **Step 1: Write failing tests**

`test/query-grammar.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parseQuery, matchesMeta, runQuery } from "../scripts/logic/query-grammar.mjs";
import { createIndex, indexRecord } from "../scripts/logic/search-index.mjs";

describe("parseQuery", () => {
  it("splits typed tokens from free text", () => {
    expect(parseQuery("type:person tag:villain attr:faction=Zhentarim red wizard")).toEqual({
      types: ["person"], tags: ["villain"], attrs: [{ key: "faction", value: "Zhentarim" }], text: "red wizard"
    });
  });
  it("supports valueless attr tokens and case-insensitive prefixes", () => {
    expect(parseQuery("Attr:patron TAG:ally")).toEqual({ types: [], tags: ["ally"], attrs: [{ key: "patron", value: null }], text: "" });
  });
  it("throws on empty/whitespace queries", () => {
    expect(() => parseQuery("   ")).toThrow("empty-query");
  });
});

describe("matchesMeta", () => {
  const rec = { type: "person", meta: { tags: ["Villain"], attrs: [
    { key: "faction", value: "Zhentarim", playerHidden: false },
    { key: "patron", value: "Asmodeus", playerHidden: true }
  ] } };
  it("matches type, tag (case-insensitive), and attr key=value substring", () => {
    expect(matchesMeta(rec, parseQuery("type:person tag:villain attr:faction=zhent x"), { gm: false })).toBe(true);
    expect(matchesMeta(rec, parseQuery("type:place x"), { gm: false })).toBe(false);
    expect(matchesMeta(rec, parseQuery("tag:hero x"), { gm: false })).toBe(false);
  });
  it("playerHidden attrs match only for GMs", () => {
    const q = parseQuery("attr:patron x");
    expect(matchesMeta(rec, q, { gm: false })).toBe(false);
    expect(matchesMeta(rec, q, { gm: true })).toBe(true);
  });
});

describe("runQuery", () => {
  const index = createIndex();
  indexRecord(index, { uuid: "u1", name: "Manshoon", type: "person", tags: ["villain"],
    fields: { text: "red wizard rival" }, gmFields: {}, meta: { tags: ["villain"], attrs: [] } });
  indexRecord(index, { uuid: "u2", name: "Elminster", type: "person", tags: [],
    fields: { text: "red robed sage" }, gmFields: {}, meta: { tags: [], attrs: [] } });
  it("intersects full-text results with meta filters", () => {
    const hits = runQuery(index, "tag:villain red", { gm: false });
    expect(hits.map((h) => h.uuid)).toEqual(["u1"]);
    expect(hits[0].matches.length).toBeGreaterThan(0);
  });
  it("meta-only queries return all matching records with empty matches", () => {
    const hits = runQuery(index, "type:person", { gm: false });
    expect(hits.map((h) => h.uuid)).toEqual(["u2", "u1"]); // name-sorted
    expect(hits[0].matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/query-grammar.test.js` → FAIL.

- [ ] **Step 3: Implement `scripts/logic/query-grammar.mjs`**

```js
/**
 * The companion's single query grammar (spec §4): consumed by the Hub
 * dashboards, the @CampaignQuery page enricher, and any future filter
 * surface, so they can't drift apart. Pure (vitest-loadable).
 *
 * Grammar: whitespace-separated tokens.
 *   type:<key>            merged-registry type key, e.g. type:person
 *   tag:<tag>             companion tag (case-insensitive match)
 *   attr:<key>            has an attribute with this key
 *   attr:<key>=<value>    ...whose value contains <value> (case-insensitive)
 *   anything else         free text, forwarded to search-index.mjs's search()
 * All conditions AND together.
 */
import { search } from "./search-index.mjs";

export function parseQuery(str) {
  const parsed = { types: [], tags: [], attrs: [], text: "" };
  const free = [];
  for (const token of String(str ?? "").trim().split(/\s+/).filter(Boolean)) {
    const m = /^(type|tag|attr):(.+)$/i.exec(token);
    if (!m) {
      free.push(token);
      continue;
    }
    const prefix = m[1].toLowerCase();
    const rest = m[2];
    if (prefix === "type") parsed.types.push(rest.toLowerCase());
    else if (prefix === "tag") parsed.tags.push(rest);
    else {
      const eq = rest.indexOf("=");
      parsed.attrs.push(eq === -1
        ? { key: rest, value: null }
        : { key: rest.slice(0, eq), value: rest.slice(eq + 1) });
    }
  }
  parsed.text = free.join(" ");
  if (!parsed.text && !parsed.types.length && !parsed.tags.length && !parsed.attrs.length) {
    throw new Error("empty-query");
  }
  return parsed;
}

export function matchesMeta(rec, parsed, { gm = false } = {}) {
  if (parsed.types.length && !parsed.types.includes(rec.type)) return false;
  const meta = rec.meta ?? { tags: [], attrs: [] };
  const tagSet = new Set(meta.tags.map((t) => t.toLowerCase()));
  for (const tag of parsed.tags) {
    if (!tagSet.has(tag.toLowerCase())) return false;
  }
  const visibleAttrs = meta.attrs.filter((a) => gm || !a.playerHidden);
  for (const { key, value } of parsed.attrs) {
    const keyLc = key.toLowerCase();
    const hit = visibleAttrs.some((a) =>
      a.key.toLowerCase() === keyLc &&
      (value === null || a.value.toLowerCase().includes(value.toLowerCase()))
    );
    if (!hit) return false;
  }
  return true;
}

export function runQuery(index, queryString, { gm = false } = {}) {
  const parsed = parseQuery(queryString);
  if (parsed.text) {
    return search(index, parsed.text, { gm })
      .filter((hit) => matchesMeta(index.records.get(hit.uuid), parsed, { gm }));
  }
  const hits = [];
  for (const rec of index.records.values()) {
    if (!matchesMeta(rec, parsed, { gm })) continue;
    hits.push({ uuid: rec.uuid, name: rec.name, type: rec.type, matches: [] });
  }
  return hits.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run** — `npx vitest run test/query-grammar.test.js` → PASS.

- [ ] **Step 5: Add `runQueryAll` to `scripts/search/live-index.mjs`**

Add `import { runQuery } from "../logic/query-grammar.mjs";` and (near `searchAll`):

```js
/**
 * Run a grammar query (logic/query-grammar.mjs) against the live index and
 * drop hits the current user can't observe - same gate as searchAll().
 * Throws Error("empty-query") for blank queries (callers surface it).
 */
export function runQueryAll(queryString) {
  const hits = runQuery(ensureIndex(), queryString, { gm: game.user.isGM });
  return hits.filter((hit) => userCanSee(hit.uuid));
}
```

- [ ] **Step 6: Run the whole suite** — `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/query-grammar.mjs scripts/search/live-index.mjs test/query-grammar.test.js
git commit -m "feat: query grammar (type:/tag:/attr:/text) over the live index"
```

---

### Task 8: Knowledge panel — tags/attributes/backlinks injected into every MEJ sheet

**Files:**
- Create: `scripts/hooks/knowledge-ui.mjs`, `templates/knowledge-panel.hbs`
- Modify: `scripts/campaign-companion.mjs` (register), `lang/en.json`, the module's stylesheet in `styles/`
- Test: none new here (pure pieces were Tasks 4-6; DOM behavior lands in Task 13's e2e)

**Interfaces:**
- Consumes: `getTags`, `getAttributes`, `normalizeTagInput` (Task 4); `backlinksForEntry` (Task 6); `MODULE_ID`, `I18N` (constants).
- Produces: `registerKnowledgePanel()` from `scripts/hooks/knowledge-ui.mjs`, called from the `setupMonksEnhancedJournal` handler in `campaign-companion.mjs`. Also `openGraphForPage` action placeholder is NOT part of this task (graph buttons come in Task 12).

- [ ] **Step 1: Create `templates/knowledge-panel.hbs`**

```handlebars
<section class="mej-cc-knowledge" data-page-uuid="{{pageUuid}}">
    <details class="mej-cc-knowledge-tags" open>
        <summary><i class="fa-solid fa-tags"></i> {{localize "MEJCampaignCompanion.knowledge.tags"}}</summary>
        <div class="mej-cc-tag-chips">
            {{#each tags}}
            <span class="mej-cc-tag-chip">{{this}}{{#if @root.canEdit}}<a class="mej-cc-tag-remove" data-tag="{{this}}" title="{{localize 'MEJCampaignCompanion.knowledge.removeTag'}}"><i class="fa-solid fa-xmark"></i></a>{{/if}}</span>
            {{/each}}
            {{#if canEdit}}
            <input type="text" class="mej-cc-tag-input" placeholder="{{localize 'MEJCampaignCompanion.knowledge.addTag'}}">
            {{/if}}
            {{#unless tags}}{{#unless canEdit}}<span class="mej-cc-knowledge-empty">{{localize "MEJCampaignCompanion.knowledge.noTags"}}</span>{{/unless}}{{/unless}}
        </div>
    </details>
    <details class="mej-cc-knowledge-attrs">
        <summary><i class="fa-solid fa-table-list"></i> {{localize "MEJCampaignCompanion.knowledge.attributes"}}</summary>
        <table class="mej-cc-attr-table">
            {{#each attributes}}
            <tr data-attr-id="{{this.id}}">
                {{#if @root.canEdit}}
                <td><input type="text" class="mej-cc-attr-key" value="{{this.key}}"></td>
                <td><input type="text" class="mej-cc-attr-value" value="{{this.value}}"></td>
                <td><label title="{{localize 'MEJCampaignCompanion.knowledge.playerHidden'}}"><input type="checkbox" class="mej-cc-attr-hidden" {{#if this.playerHidden}}checked{{/if}}><i class="fa-solid fa-eye-slash"></i></label></td>
                <td><a class="mej-cc-attr-delete" title="{{localize 'MEJCampaignCompanion.knowledge.deleteAttribute'}}"><i class="fa-solid fa-trash"></i></a></td>
                {{else}}
                <td class="mej-cc-attr-key-ro">{{this.key}}</td>
                <td class="mej-cc-attr-value-ro">{{this.value}}</td>
                {{/if}}
            </tr>
            {{/each}}
        </table>
        {{#if canEdit}}<a class="mej-cc-attr-add"><i class="fa-solid fa-plus"></i> {{localize "MEJCampaignCompanion.knowledge.addAttribute"}}</a>{{/if}}
    </details>
    <details class="mej-cc-knowledge-backlinks" open>
        <summary><i class="fa-solid fa-link"></i> {{localize "MEJCampaignCompanion.knowledge.mentionedIn"}} ({{backlinks.length}})</summary>
        <ol class="mej-cc-backlink-list">
            {{#each backlinks}}
            <li class="mej-cc-backlink-row" data-uuid="{{this.uuid}}">
                <i class="{{this.icon}}"></i>
                <span class="mej-cc-backlink-name">{{this.name}}</span>
                {{#if this.gmOnly}}<i class="fa-solid fa-eye-slash mej-cc-backlink-gm" title="{{localize 'MEJCampaignCompanion.knowledge.gmOnlyMention'}}"></i>{{/if}}
                <span class="mej-cc-backlink-count">×{{this.count}}</span>
            </li>
            {{/each}}
        </ol>
        {{#unless backlinks}}<span class="mej-cc-knowledge-empty">{{localize "MEJCampaignCompanion.knowledge.noMentions"}}</span>{{/unless}}
    </details>
</section>
```

- [ ] **Step 2: Implement `scripts/hooks/knowledge-ui.mjs`**

Key constraints baked in below: MEJ's shell fires `renderJournalPageSheet(subsheet, subsheetElement, {enhancedjournal, ...context})` at the end of `renderSubSheet` (apps/enhanced-journal.js:691); popped-out MEJ sheets fire the ApplicationV2 chain hook `renderEnhancedJournalSheet`. Both handlers funnel into one idempotent injector. **No static MEJ imports** (Global Constraints) — the sheet is identified via `sheet.document` being a JournalEntryPage with an MEJ type, not via `instanceof EnhancedJournalSheet`.

```js
// Injects the Phase B "knowledge panel" (tags, attributes, Mentioned in)
// into every MEJ-typed journal sheet, both shell-hosted and popped out.
// Injection hooks (no libWrapper - see the spec's §5 refinement):
//  - "renderJournalPageSheet": fired by MEJ's shell at the end of
//    renderSubSheet (apps/enhanced-journal.js:691) with the subsheet, its
//    root element, and a context carrying `enhancedjournal`.
//  - "renderEnhancedJournalSheet": the standard ApplicationV2 inheritance-
//    chain render hook, fired when an MEJ sheet renders standalone
//    (popped out) - the shell path never calls _onRender, so these two
//    hooks are disjoint in practice; the injector is idempotent anyway.
import { MODULE_ID, I18N } from "../constants.mjs";
import { getTags, getAttributes, normalizeTagInput } from "../logic/knowledge-flags.mjs";
import { backlinksForEntry } from "../search/live-index.mjs";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null; // jQuery
}

/** The page this sheet fronts, only if it's a real MEJ-typed JournalEntryPage. */
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  return game.MonksEnhancedJournal?.getMEJType?.(doc) ? doc : null;
}

async function injectPanel(sheet, element) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  element.querySelector(":scope .mej-cc-knowledge")?.remove();

  const entryUuid = page.parent?.uuid ?? page.uuid;
  const canEdit = game.user.isGM;
  const backlinks = backlinksForEntry(entryUuid).map((row) => ({
    ...row, icon: `fas ${game.MonksEnhancedJournal.getIcon(row.type)}`
  }));
  const html = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/knowledge-panel.hbs`,
    { pageUuid: page.uuid, canEdit, tags: getTags(page), attributes: getAttributes(page), backlinks }
  );
  const panel = document.createRange().createContextualFragment(html).firstElementChild;
  bindPanel(panel, page, sheet);
  element.appendChild(panel);
}

async function saveAttributes(panel, page) {
  const rows = [...panel.querySelectorAll("[data-attr-id]")].map((tr) => ({
    id: tr.dataset.attrId,
    key: tr.querySelector(".mej-cc-attr-key")?.value?.trim() ?? "",
    value: tr.querySelector(".mej-cc-attr-value")?.value ?? "",
    playerHidden: tr.querySelector(".mej-cc-attr-hidden")?.checked === true
  })).filter((r) => r.key);
  await page.update({ [`flags.${MODULE_ID}.attributes`]: rows });
}

function bindPanel(panel, page, sheet) {
  if (!game.user.isGM) {
    bindBacklinks(panel);
    return;
  }
  const rerender = () => queueMicrotask(() => sheet.render?.({ parts: ["main"] }));

  panel.querySelector(".mej-cc-tag-input")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const added = normalizeTagInput(event.target.value);
    if (!added.length) return;
    const tags = [...new Set([...getTags(page), ...added])];
    await page.update({ [`flags.${MODULE_ID}.tags`]: tags });
  });
  panel.querySelectorAll(".mej-cc-tag-remove").forEach((a) => a.addEventListener("click", async () => {
    const tags = getTags(page).filter((t) => t !== a.dataset.tag);
    await page.update({ [`flags.${MODULE_ID}.tags`]: tags });
  }));
  panel.querySelector(".mej-cc-attr-add")?.addEventListener("click", async () => {
    const rows = [...getAttributes(page), { id: foundry.utils.randomID(8), key: game.i18n.localize(`${I18N}.knowledge.newKey`), value: "", playerHidden: false }];
    await page.update({ [`flags.${MODULE_ID}.attributes`]: rows });
  });
  panel.querySelectorAll(".mej-cc-attr-delete").forEach((a) => a.addEventListener("click", async () => {
    a.closest("[data-attr-id]").remove();
    await saveAttributes(panel, page);
  }));
  panel.querySelectorAll(".mej-cc-attr-key, .mej-cc-attr-value, .mej-cc-attr-hidden").forEach((input) =>
    input.addEventListener("change", () => saveAttributes(panel, page))
  );
  bindBacklinks(panel);
  void rerender; // page.update triggers updateJournalEntryPage -> MEJ re-renders the sheet
}

function bindBacklinks(panel) {
  panel.querySelectorAll(".mej-cc-backlink-row").forEach((li) => li.addEventListener("click", async () => {
    const entry = await fromUuid(li.dataset.uuid);
    if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
  }));
}

export function registerKnowledgePanel() {
  Hooks.on("renderJournalPageSheet", (sheet, html) => {
    injectPanel(sheet, asElement(html)).catch((err) => console.error(`${MODULE_ID} | knowledge panel injection failed`, err));
  });
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => {
    injectPanel(sheet, asElement(html)).catch((err) => console.error(`${MODULE_ID} | knowledge panel injection failed`, err));
  });
}
```

Implementer notes: (a) if `page.update(...)` does not cause MEJ to re-render the shell-hosted subsheet with the panel's new state during live testing, re-render explicitly after each update via `sheet.render({ parts: ["main"] })` — verify live in Task 13, not now; (b) failures must log-and-skip (Global Constraints / spec §6) — the `.catch` on `injectPanel` is that guarantee; (c) the panel appends at the end of the sheet's root element by design (spec: "appended to the bottom of every MEJ sheet").

- [ ] **Step 3: Register it**

In `scripts/campaign-companion.mjs`'s `setupMonksEnhancedJournal` handler, after `registerAutoCapture();` add:

```js
    // Injects the Phase B knowledge panel (tags/attributes/backlinks) into
    // every MEJ-typed sheet. Dynamic import: knowledge-ui.mjs imports
    // live-index.mjs (safe) but keep the pattern consistent and cheap.
    const { registerKnowledgePanel } = await import("./hooks/knowledge-ui.mjs");
    registerKnowledgePanel();
```

- [ ] **Step 4: Add i18n keys to `lang/en.json`** (inside the existing `MEJCampaignCompanion` object, new `"knowledge"` section):

```json
"knowledge": {
  "tags": "Tags",
  "addTag": "Add tag…",
  "removeTag": "Remove tag",
  "noTags": "No tags",
  "attributes": "Attributes",
  "addAttribute": "Add attribute",
  "deleteAttribute": "Delete attribute",
  "playerHidden": "Hidden from players",
  "newKey": "key",
  "mentionedIn": "Mentioned in",
  "noMentions": "No mentions yet",
  "gmOnlyMention": "Mentioned only in GM-only content"
}
```

- [ ] **Step 5: Style it** — append to the module's stylesheet in `styles/` (match the existing `.mej-cc-*` conventions): `.mej-cc-knowledge` (border-top separator, margin, padding), chip styling for `.mej-cc-tag-chip`, compact table for `.mej-cc-attr-table`, hover cursor on `.mej-cc-backlink-row`. Keep it minimal and consistent with existing rules.

- [ ] **Step 6: Run unit suite** — `npm test` → PASS (no regressions; this task's behavior is e2e-covered in Task 13).

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/knowledge-ui.mjs templates/knowledge-panel.hbs scripts/campaign-companion.mjs lang/en.json styles
git commit -m "feat: knowledge panel (tags, attributes, mentioned-in) on every MEJ sheet"
```

---

### Task 9: Hub — mention badges, saved queries, Dashboards tab

**Files:**
- Modify: `scripts/constants.mjs`, `scripts/campaign-companion.mjs` (setting), `scripts/apps/CampaignHubPage.mjs`, `templates/hub.hbs`, `lang/en.json`, stylesheet

**Interfaces:**
- Consumes: `mentionBadgeCounts`, `runQueryAll` (Tasks 6-7); `parseQuery` (Task 7).
- Produces: `SAVED_QUERIES_SETTING = "savedQueries"` in constants; world setting `mej-campaign-companion.savedQueries` holding `[{id, name, query, showPlayers}]`; Hub gains a `dashboards` tab.

- [ ] **Step 1: Add the constant and setting**

`scripts/constants.mjs`:
```js
/** World setting: saved dashboard queries [{id, name, query, showPlayers}] (GM-managed; world settings replicate to all clients). */
export const SAVED_QUERIES_SETTING = "savedQueries";
```

`scripts/campaign-companion.mjs` init hook (import the constant; alongside the other registrations):
```js
  game.settings.register(MODULE_ID, SAVED_QUERIES_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
```

- [ ] **Step 2: Add the Dashboards tab + badges to `CampaignHubPage.mjs`**

1. Imports: add `SAVED_QUERIES_SETTING` to the constants import; add `import { mentionBadgeCounts, runQueryAll } from "../search/live-index.mjs";` and `import { parseQuery } from "../logic/query-grammar.mjs";`
2. `static TABS.primary.tabs`: append `{ id: "dashboards", icon: "fa-solid fa-table-columns" }`.
3. `static DEFAULT_OPTIONS.actions`: add `addDashboard: CampaignHubPage.onAddDashboard, editDashboard: CampaignHubPage.onEditDashboard, deleteDashboard: CampaignHubPage.onDeleteDashboard`.
4. `_prepareBodyContext`: add `context.dashboards = this.#dashboardsContext(isGM);`
5. `#indexContext()`: after computing `rows`, decorate with badges:
```js
    const mentionCounts = mentionBadgeCounts();
    for (const row of rows) row.mentions = mentionCounts.get(row.uuid) ?? 0;
```
6. New context + actions:
```js
  #dashboardsContext(isGM) {
    const saved = game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? [];
    const rows = saved.filter((q) => isGM || q.showPlayers === true).map((q) => {
      try {
        const results = runQueryAll(q.query).map((hit) => ({
          uuid: hit.uuid, name: hit.name,
          icon: this.#typeIcon(hit.type), typeLabel: this.#typeLabel(hit.type)
        }));
        return { ...q, error: null, results };
      } catch (err) {
        // A stored query that no longer parses renders as an error row, not a crash (spec §6).
        return { ...q, error: game.i18n.localize(`${I18N}.hub.dashboards.badQuery`), results: [] };
      }
    });
    return { rows, isGM };
  }

  /** Name + query + showPlayers prompt; returns {name, query, showPlayers} or null. */
  static async #promptDashboard(initial = {}, { titleKey }) {
    const esc = foundry.utils.escapeHTML;
    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `
        <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.dashboards.name`)}</label>
          <input type="text" name="name" value="${esc(initial.name ?? "")}" required autofocus></div>
        <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.dashboards.query`)}</label>
          <input type="text" name="query" value="${esc(initial.query ?? "")}" placeholder="type:person tag:villain text"></div>
        <p class="hint">${game.i18n.localize(`${I18N}.hub.dashboards.queryHint`)}</p>
        <div class="form-group"><label><input type="checkbox" name="showPlayers"${initial.showPlayers ? " checked" : ""}>
          ${game.i18n.localize(`${I18N}.hub.dashboards.showPlayers`)}</label></div>`,
      ok: {
        label: `${I18N}.hub.save`,
        callback: (event, button) => {
          const form = button.form.elements;
          const name = form.name.value.trim();
          const query = form.query.value.trim();
          if (!name || !query) return null;
          try {
            parseQuery(query);
          } catch {
            ui.notifications.warn(game.i18n.localize(`${I18N}.hub.dashboards.badQuery`));
            return null;
          }
          return { name, query, showPlayers: form.showPlayers.checked === true };
        }
      },
      rejectClose: false
    });
  }

  static async onAddDashboard() {
    if (!game.user.isGM) return;
    const result = await CampaignHubPage.#promptDashboard({}, { titleKey: `${I18N}.hub.dashboards.add` });
    if (!result) return;
    const saved = [...(game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? [])];
    saved.push({ id: foundry.utils.randomID(8), ...result });
    await game.settings.set(MODULE_ID, SAVED_QUERIES_SETTING, saved);
    this.render({ parts: ["main"] });
  }

  static async onEditDashboard(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-dashboard-id]")?.dataset.dashboardId;
    const saved = [...(game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? [])];
    const existing = saved.find((q) => q.id === id);
    if (!existing) return;
    const result = await CampaignHubPage.#promptDashboard(existing, { titleKey: `${I18N}.hub.dashboards.edit` });
    if (!result) return;
    Object.assign(existing, result);
    await game.settings.set(MODULE_ID, SAVED_QUERIES_SETTING, saved);
    this.render({ parts: ["main"] });
  }

  static async onDeleteDashboard(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-dashboard-id]")?.dataset.dashboardId;
    const saved = (game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? []).filter((q) => q.id !== id);
    await game.settings.set(MODULE_ID, SAVED_QUERIES_SETTING, saved);
    this.render({ parts: ["main"] });
  }
```

- [ ] **Step 3: Template — badge + dashboards tab in `templates/hub.hbs`**

1. Index rows (`.mej-cc-index-row`, after the name span): `{{#if this.mentions}}<span class="mej-cc-mention-badge" title="{{localize 'MEJCampaignCompanion.hub.mentions'}}"><i class="fa-solid fa-link"></i>{{this.mentions}}</span>{{/if}}`
2. Add a fourth tab pane after the search pane, following the same structure and scrollable conventions (add `.mej-cc-dashboards-list` to `PARTS.main.scrollable` in the class):

```handlebars
<div class="tab{{#if subtabs.dashboards.active}} active{{/if}}" data-group="primary" data-tab="dashboards">
    <div class="tab-inner flexcol mej-cc-dashboards">
        {{#if dashboards.isGM}}
        <div class="mej-cc-dashboards-controls">
            <button type="button" data-action="addDashboard"><i class="fa-solid fa-plus"></i> {{localize "MEJCampaignCompanion.hub.dashboards.add"}}</button>
        </div>
        {{/if}}
        <ol class="mej-cc-dashboards-list scrollable">
            {{#each dashboards.rows}}
            <li class="mej-cc-dashboard" data-dashboard-id="{{this.id}}">
                <div class="mej-cc-dashboard-head">
                    <span class="mej-cc-dashboard-name">{{this.name}}</span>
                    <code class="mej-cc-dashboard-query">{{this.query}}</code>
                    {{#if @root.dashboards.isGM}}
                    {{#if this.showPlayers}}<i class="fa-solid fa-eye" title="{{localize 'MEJCampaignCompanion.hub.dashboards.visibleToPlayers'}}"></i>{{/if}}
                    <a data-action="editDashboard" title="{{localize 'MEJCampaignCompanion.hub.dashboards.edit'}}"><i class="fa-solid fa-pen"></i></a>
                    <a data-action="deleteDashboard" title="{{localize 'MEJCampaignCompanion.hub.dashboards.delete'}}"><i class="fa-solid fa-trash"></i></a>
                    {{/if}}
                </div>
                {{#if this.error}}
                <p class="mej-cc-dashboard-error">{{this.error}}</p>
                {{else}}
                <ol class="mej-cc-dashboard-results">
                    {{#each this.results}}
                    <li class="mej-cc-index-row item flexrow" data-uuid="{{this.uuid}}" data-action="openIndexRow">
                        <i class="mej-cc-index-icon {{this.icon}}"></i>
                        <span class="mej-cc-index-name">{{this.name}}</span>
                        <span class="mej-cc-index-type">{{this.typeLabel}}</span>
                    </li>
                    {{/each}}
                    {{#unless this.results}}<li class="mej-cc-knowledge-empty">{{localize "MEJCampaignCompanion.hub.dashboards.noResults"}}</li>{{/unless}}
                </ol>
                {{/if}}
            </li>
            {{/each}}
            {{#unless dashboards.rows}}<li class="mej-cc-knowledge-empty">{{localize "MEJCampaignCompanion.hub.dashboards.empty"}}</li>{{/unless}}
        </ol>
    </div>
</div>
```

- [ ] **Step 4: i18n keys** — add to `lang/en.json` under the hub section: `"mentions": "Mentions"`, and a `"dashboards"` object with `"add": "Add dashboard"`, `"edit": "Edit dashboard"`, `"delete": "Delete dashboard"`, `"name": "Name"`, `"query": "Query"`, `"queryHint": "Tokens: type:<key>, tag:<tag>, attr:<key>=<value>; anything else is full-text search."`, `"showPlayers": "Visible to players"`, `"visibleToPlayers": "Visible to players"`, `"badQuery": "That query can't be parsed."`, `"noResults": "No matches."`, `"empty": "No dashboards yet."`. Also add the tab label the Hub's `labelPrefix` expects: `"hub.tabs.dashboards": "Dashboards"` in the same shape as the existing `index`/`timeline`/`search` tab labels.

- [ ] **Step 5: Styles** — append badge (`.mej-cc-mention-badge`: small pill) and dashboard styling consistent with existing hub rules.

- [ ] **Step 6: Run unit suite** — `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json styles
git commit -m "feat: hub mention badges, saved queries, dashboards tab"
```

---

### Task 10: `@CampaignQuery[...]` text enricher

**Files:**
- Create: `scripts/hooks/query-enricher.mjs`
- Modify: `scripts/campaign-companion.mjs`, `lang/en.json`, stylesheet

**Interfaces:**
- Consumes: `runQueryAll` (Task 7).
- Produces: `registerQueryEnricher()` from `scripts/hooks/query-enricher.mjs`.

- [ ] **Step 1: Implement `scripts/hooks/query-enricher.mjs`**

```js
// @CampaignQuery[<grammar string>] text enricher (spec §5): embeds a live,
// permission-filtered query result list inside any journal page. Enrichment
// runs per-viewer at render time, so permission filtering is inherent and
// results refresh whenever the page re-renders (documented limitation: not
// push-live mid-view). Failures render an inert placeholder, never break
// the page (spec §6).
import { MODULE_ID, I18N } from "../constants.mjs";
import { runQueryAll } from "../search/live-index.mjs";

function resultAnchor(hit) {
  // Standard content-link anchor: Foundry's global click handler resolves
  // data-uuid, and MEJ's own document-open interception routes MEJ-typed
  // entries into the enhanced browser - identical behavior to a plain
  // @UUID link on the page.
  const a = document.createElement("a");
  a.classList.add("content-link");
  a.draggable = true;
  a.dataset.link = "";
  a.dataset.uuid = hit.uuid;
  a.dataset.type = "JournalEntry";
  a.dataset.tooltip = hit.name;
  const icon = document.createElement("i");
  icon.className = "fas fa-book-open";
  a.append(icon, ` ${hit.name}`);
  return a;
}

async function enrichCampaignQuery(match) {
  const container = document.createElement("div");
  container.classList.add("mej-cc-query-embed");
  const query = match[1].trim();
  try {
    const hits = runQueryAll(query);
    const header = document.createElement("div");
    header.classList.add("mej-cc-query-embed-header");
    header.textContent = query;
    container.append(header);
    const list = document.createElement("ul");
    for (const hit of hits) {
      const li = document.createElement("li");
      li.append(resultAnchor(hit));
      list.append(li);
    }
    if (!hits.length) {
      const empty = document.createElement("li");
      empty.classList.add("mej-cc-knowledge-empty");
      empty.textContent = game.i18n.localize(`${I18N}.enricher.noResults`);
      list.append(empty);
    }
    container.append(list);
  } catch (err) {
    console.debug(`${MODULE_ID} | @CampaignQuery enrichment failed`, err);
    container.classList.add("mej-cc-query-embed-error");
    container.textContent = game.i18n.localize(`${I18N}.enricher.badQuery`);
  }
  return container;
}

export function registerQueryEnricher() {
  CONFIG.TextEditor.enrichers.push({
    pattern: /@CampaignQuery\[([^\]]+)\]/g,
    enricher: enrichCampaignQuery
  });
}
```

- [ ] **Step 2: Register it** — in `campaign-companion.mjs`'s `setupMonksEnhancedJournal` handler (after the knowledge-panel registration):

```js
    const { registerQueryEnricher } = await import("./hooks/query-enricher.mjs");
    registerQueryEnricher();
```

(Registered from the setup handler rather than init so `runQueryAll`'s import graph stays out of the top-level module graph — same deferred-import posture as the rest.)

- [ ] **Step 3: i18n + styles** — `lang/en.json`: `"enricher": { "noResults": "No matches.", "badQuery": "Invalid @CampaignQuery." }`. Stylesheet: `.mej-cc-query-embed` (bordered block, subdued header), `.mej-cc-query-embed-error` (muted italic).

- [ ] **Step 4: Run unit suite** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/query-enricher.mjs scripts/campaign-companion.mjs lang/en.json styles
git commit -m "feat: @CampaignQuery page enricher with live permission-filtered results"
```

---

### Task 11: Vendored d3-force + graph data assembly

**Files:**
- Create: `vendor/d3-force.esm.js` (generated, committed), `scripts/logic/graph-data.mjs`
- Modify: `package.json` (devDependencies)
- Test: `test/graph-data.test.js` (new)

**Interfaces:**
- Produces (`vendor/d3-force.esm.js`): ESM exports `forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY`.
- Produces (`scripts/logic/graph-data.mjs`):
  - `normalizeRelationships(flagValue) -> {id: string, uuid: string, hidden: boolean}[]` — accepts MEJ's dict form (`{relId: {uuid, hidden, ...}}`), legacy array form, or nullish; drops rows without a string `uuid`.
  - `buildGraph(rows, backlinkPairs, opts) -> {nodes: {uuid,name,type}[], edges: {source,target,kind}[], truncated: boolean}` where `rows = {uuid, name, type, relationships}[]` (already permission-filtered by the caller), `backlinkPairs = {source,target,gmOnly}[]`, `opts = {mode: "ego"|"all", centerUuid, includeBacklinks, isGM, maxNodes = 200}`.

- [ ] **Step 1: Generate the vendored bundle**

```bash
npm i -D esbuild d3-force
mkdir -p vendor
printf 'export { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from "d3-force";\n' > /tmp/d3-force-entry.mjs
npx esbuild /tmp/d3-force-entry.mjs --bundle --format=esm --minify --outfile=vendor/d3-force.esm.js
```

Then prepend a one-line header comment to `vendor/d3-force.esm.js`: `// d3-force (ISC License, https://github.com/d3/d3-force) + deps, bundled ESM via esbuild - see docs for regeneration.` Verify the bundle loads: `node -e 'import("./vendor/d3-force.esm.js").then(m => console.log(typeof m.forceSimulation))'` → `function`.

- [ ] **Step 2: Write failing tests for graph-data**

`test/graph-data.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizeRelationships, buildGraph } from "../scripts/logic/graph-data.mjs";

describe("normalizeRelationships", () => {
  it("handles the dict form, the legacy array form, and nullish", () => {
    expect(normalizeRelationships({ r1: { uuid: "JournalEntry.a", hidden: true } }))
      .toEqual([{ id: "r1", uuid: "JournalEntry.a", hidden: true }]);
    expect(normalizeRelationships([{ id: "x", uuid: "JournalEntry.b" }]))
      .toEqual([{ id: "x", uuid: "JournalEntry.b", hidden: false }]);
    expect(normalizeRelationships(undefined)).toEqual([]);
    expect(normalizeRelationships({ r2: { hidden: false } })).toEqual([]);
  });
});

describe("buildGraph", () => {
  const rows = [
    { uuid: "JournalEntry.a", name: "A", type: "person", relationships: [{ id: "r1", uuid: "JournalEntry.b", hidden: false }, { id: "r2", uuid: "JournalEntry.c", hidden: true }] },
    { uuid: "JournalEntry.b", name: "B", type: "place", relationships: [] },
    { uuid: "JournalEntry.c", name: "C", type: "person", relationships: [] },
    { uuid: "JournalEntry.d", name: "D", type: "quest", relationships: [] }
  ];
  const pairs = [{ source: "JournalEntry.d", target: "JournalEntry.a", gmOnly: false }];

  it("whole-campaign mode: relationship edges, hidden edges GM-only, edges only between present nodes", () => {
    const player = buildGraph(rows, [], { mode: "all", isGM: false });
    expect(player.nodes).toHaveLength(4);
    expect(player.edges).toEqual([{ source: "JournalEntry.a", target: "JournalEntry.b", kind: "relationship" }]);
    const gm = buildGraph(rows, [], { mode: "all", isGM: true });
    expect(gm.edges).toHaveLength(2);
  });

  it("backlink overlay adds dashed pairs without duplicating relationship edges", () => {
    const g = buildGraph(rows, [...pairs, { source: "JournalEntry.a", target: "JournalEntry.b", gmOnly: false }], { mode: "all", isGM: false, includeBacklinks: true });
    expect(g.edges).toEqual([
      { source: "JournalEntry.a", target: "JournalEntry.b", kind: "relationship" },
      { source: "JournalEntry.d", target: "JournalEntry.a", kind: "backlink" }
    ]);
  });

  it("ego mode keeps the center and its direct neighbors only", () => {
    const g = buildGraph(rows, pairs, { mode: "ego", centerUuid: "JournalEntry.a", isGM: false, includeBacklinks: true });
    expect(g.nodes.map((n) => n.uuid).sort()).toEqual(["JournalEntry.a", "JournalEntry.b", "JournalEntry.d"]);
  });

  it("caps nodes deterministically and reports truncation", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ uuid: `JournalEntry.n${i}`, name: `N${i}`, type: "person", relationships: [] }));
    const g = buildGraph(many, [], { mode: "all", isGM: true, maxNodes: 5 });
    expect(g.nodes).toHaveLength(5);
    expect(g.truncated).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run test/graph-data.test.js` → FAIL.

- [ ] **Step 4: Implement `scripts/logic/graph-data.mjs`**

```js
/**
 * Pure graph assembly for the relationship graph app (spec §5). The caller
 * (apps/graph-app.mjs) supplies permission-filtered rows - every row here
 * is already visible to the viewing user, so edge visibility reduces to
 * "both endpoints present" (spec §2) plus the hidden-relationship GM gate.
 */

export function normalizeRelationships(flagValue) {
  let entries;
  if (Array.isArray(flagValue)) entries = flagValue.map((rel) => [rel?.id ?? "", rel]);
  else if (flagValue && typeof flagValue === "object") entries = Object.entries(flagValue);
  else return [];
  return entries
    .filter(([, rel]) => rel && typeof rel.uuid === "string" && rel.uuid.length)
    .map(([id, rel]) => ({ id: String(rel.id ?? id), uuid: rel.uuid, hidden: rel.hidden === true }));
}

const pairKey = (a, b) => (a < b ? `${a} ${b}` : `${b} ${a}`);

export function buildGraph(rows, backlinkPairs, { mode = "all", centerUuid = null, includeBacklinks = false, isGM = false, maxNodes = 200 } = {}) {
  const byUuid = new Map(rows.map((r) => [r.uuid, r]));

  // Relationship edges (undirected, deduped), hidden ones GM-only.
  const edges = [];
  const seenPairs = new Set();
  for (const row of rows) {
    for (const rel of row.relationships ?? []) {
      if (rel.hidden && !isGM) continue;
      if (!byUuid.has(rel.uuid)) continue;
      const key = pairKey(row.uuid, rel.uuid);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      edges.push({ source: row.uuid, target: rel.uuid, kind: "relationship" });
    }
  }
  if (includeBacklinks) {
    for (const { source, target } of backlinkPairs ?? []) {
      if (!byUuid.has(source) || !byUuid.has(target)) continue;
      const key = pairKey(source, target);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      edges.push({ source, target, kind: "backlink" });
    }
  }

  let nodes = rows.map(({ uuid, name, type }) => ({ uuid, name, type }));

  if (mode === "ego" && centerUuid) {
    const keep = new Set([centerUuid]);
    for (const e of edges) {
      if (e.source === centerUuid) keep.add(e.target);
      if (e.target === centerUuid) keep.add(e.source);
    }
    nodes = nodes.filter((n) => keep.has(n.uuid));
  }

  let truncated = false;
  if (nodes.length > maxNodes) {
    truncated = true;
    const degree = new Map();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    nodes = [...nodes]
      .sort((a, b) => (degree.get(b.uuid) ?? 0) - (degree.get(a.uuid) ?? 0) || a.name.localeCompare(b.name))
      .slice(0, maxNodes);
  }

  const present = new Set(nodes.map((n) => n.uuid));
  return { nodes, edges: edges.filter((e) => present.has(e.source) && present.has(e.target)), truncated };
}
```

- [ ] **Step 5: Run** — `npx vitest run test/graph-data.test.js` → PASS; `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add vendor/d3-force.esm.js scripts/logic/graph-data.mjs test/graph-data.test.js package.json package-lock.json
git commit -m "feat: vendor d3-force (ESM bundle) and pure graph assembly"
```

---

### Task 12: Relationship graph app + entry points

**Files:**
- Create: `scripts/apps/graph-app.mjs`, `templates/graph.hbs`
- Modify: `scripts/campaign-companion.mjs` (header-button hook), `scripts/apps/CampaignHubPage.mjs` + `templates/hub.hbs` (toolbar button), `lang/en.json`, stylesheet

**Interfaces:**
- Consumes: `buildGraph`, `normalizeRelationships` (Task 11); `backlinkPairs` (Task 6); `vendor/d3-force.esm.js`.
- Produces: `RelationshipGraphApp` and `openGraph({centerUuid} = {}) -> Promise<void>` from `scripts/apps/graph-app.mjs`.

- [ ] **Step 1: Create `templates/graph.hbs`**

```handlebars
<div class="mej-cc-graph-body">
    <div class="mej-cc-graph-controls">
        <button type="button" data-action="setMode" data-mode="ego" class="{{#if isEgo}}active{{/if}}" {{#unless centerUuid}}disabled{{/unless}}>
            <i class="fa-solid fa-bullseye"></i> {{localize "MEJCampaignCompanion.graph.ego"}}</button>
        <button type="button" data-action="setMode" data-mode="all" class="{{#unless isEgo}}active{{/unless}}">
            <i class="fa-solid fa-circle-nodes"></i> {{localize "MEJCampaignCompanion.graph.all"}}</button>
        <label class="mej-cc-graph-backlinks"><input type="checkbox" data-action-change="toggleBacklinks" {{#if includeBacklinks}}checked{{/if}}>
            {{localize "MEJCampaignCompanion.graph.backlinks"}}</label>
        {{#if truncated}}<span class="mej-cc-graph-truncated">{{localize "MEJCampaignCompanion.graph.truncated"}}</span>{{/if}}
    </div>
    <svg class="mej-cc-graph-svg"></svg>
</div>
```

- [ ] **Step 2: Implement `scripts/apps/graph-app.mjs`**

```js
// Relationship graph (spec §5): standalone ApplicationV2, vendored d3-force
// layout, self-rendered SVG. Read-only visualization - relationships stay
// edited on MEJ sheets. All rows are pre-filtered to what the current user
// can observe (spec §2's gate); hidden relationships are excluded for
// non-GMs inside buildGraph.
import { MODULE_ID, I18N } from "../constants.mjs";
import { buildGraph, normalizeRelationships } from "../logic/graph-data.mjs";
import { backlinkPairs } from "../search/live-index.mjs";
import * as d3 from "../../vendor/d3-force.esm.js";

const MEJ_FLAGS = "monks-enhanced-journal";
const MAX_NODES = 200;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** One row per visible MEJ-typed entry (single-page convention: first MEJ-typed page). */
function graphRows() {
  const rows = [];
  for (const entry of game.journal?.contents ?? []) {
    if (!game.user.isGM && entry.testUserPermission(game.user, "OBSERVER") !== true) continue;
    for (const page of entry.pages?.contents ?? []) {
      const type = game.MonksEnhancedJournal.getMEJType(page);
      if (!type) continue;
      rows.push({
        uuid: entry.uuid, name: entry.name, type,
        relationships: normalizeRelationships(page.flags?.[MEJ_FLAGS]?.relationships)
      });
      break;
    }
  }
  return rows;
}

/** Deterministic per-type hue so nodes of one type share a color. */
function typeHue(type) {
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export class RelationshipGraphApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mej-cc-graph",
    classes: ["mej-cc-graph-app"],
    window: { title: `${I18N}.graph.title`, icon: "fa-solid fa-circle-nodes", resizable: true },
    position: { width: 820, height: 620 },
    actions: { setMode: RelationshipGraphApp.onSetMode }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/graph.hbs` }
  };

  #centerUuid;
  #mode;
  #includeBacklinks = false;
  #sim = null;

  constructor({ centerUuid = null } = {}) {
    super();
    this.#centerUuid = centerUuid;
    this.#mode = centerUuid ? "ego" : "all";
  }

  async _prepareContext() {
    return {
      isEgo: this.#mode === "ego",
      centerUuid: this.#centerUuid,
      includeBacklinks: this.#includeBacklinks,
      truncated: this.#lastTruncated === true
    };
  }

  #lastTruncated = false;

  static onSetMode(event, target) {
    const mode = target.dataset.mode;
    if (!["ego", "all"].includes(mode)) return;
    this.#mode = mode;
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const checkbox = this.element.querySelector('[data-action-change="toggleBacklinks"]');
    checkbox?.addEventListener("change", () => {
      this.#includeBacklinks = checkbox.checked;
      this.render();
    });
    this.#draw();
  }

  _onClose(options) {
    this.#sim?.stop();
    this.#sim = null;
    super._onClose?.(options);
  }

  #draw() {
    const svg = this.element.querySelector(".mej-cc-graph-svg");
    if (!svg) return;
    svg.replaceChildren();
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 540;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const graph = buildGraph(graphRows(), this.#includeBacklinks ? backlinkPairs() : [], {
      mode: this.#mode, centerUuid: this.#centerUuid,
      includeBacklinks: this.#includeBacklinks, isGM: game.user.isGM, maxNodes: MAX_NODES
    });
    this.#lastTruncated = graph.truncated;

    const NS = "http://www.w3.org/2000/svg";
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const byUuid = new Map(nodes.map((n) => [n.uuid, n]));
    const links = graph.edges.map((e) => ({ ...e, source: e.source, target: e.target }));

    const edgeEls = links.map((link) => {
      const line = document.createElementNS(NS, "line");
      line.classList.add("mej-cc-graph-edge", link.kind);
      svg.append(line);
      return line;
    });
    const nodeEls = nodes.map((node) => {
      const g = document.createElementNS(NS, "g");
      g.classList.add("mej-cc-graph-node");
      if (node.uuid === this.#centerUuid) g.classList.add("center");
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("r", "10");
      circle.style.fill = `hsl(${typeHue(node.type)} 55% 45%)`;
      const label = document.createElementNS(NS, "text");
      label.setAttribute("dy", "22");
      label.textContent = node.name;
      g.append(circle, label);
      g.addEventListener("click", async () => {
        if (this.#dragged) return;
        const entry = await fromUuid(node.uuid);
        if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
      });
      this.#bindDrag(g, node);
      svg.append(g);
      return g;
    });

    this.#sim?.stop();
    this.#sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.uuid).distance(90))
      .force("charge", d3.forceManyBody().strength(-220))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(26))
      .on("tick", () => {
        links.forEach((link, i) => {
          edgeEls[i].setAttribute("x1", link.source.x);
          edgeEls[i].setAttribute("y1", link.source.y);
          edgeEls[i].setAttribute("x2", link.target.x);
          edgeEls[i].setAttribute("y2", link.target.y);
        });
        nodes.forEach((node, i) => {
          nodeEls[i].setAttribute("transform", `translate(${node.x},${node.y})`);
        });
      });

    // Wheel zoom: scale the viewBox around its center.
    if (!svg.dataset.ccZoomBound) {
      svg.dataset.ccZoomBound = "1";
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
        const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
        const nw = Math.min(Math.max(w * factor, 200), 8000);
        const nh = nw * (h / w);
        svg.setAttribute("viewBox", `${x + (w - nw) / 2} ${y + (h - nh) / 2} ${nw} ${nh}`);
      }, { passive: false });
    }
  }

  #dragged = false;

  /** Drag to pin (sets fx/fy, per the d3-force convention). */
  #bindDrag(g, node) {
    g.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      this.#dragged = false;
      const svg = g.ownerSVGElement;
      const toSvg = (event) => {
        const point = new DOMPoint(event.clientX, event.clientY);
        return point.matrixTransform(svg.getScreenCTM().inverse());
      };
      const move = (event) => {
        this.#dragged = true;
        const p = toSvg(event);
        node.fx = p.x;
        node.fy = p.y;
        this.#sim.alphaTarget(0.3).restart();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.#sim.alphaTarget(0);
        setTimeout(() => { this.#dragged = false; }, 0); // let click see the flag
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }
}

export async function openGraph({ centerUuid = null } = {}) {
  new RelationshipGraphApp({ centerUuid }).render(true);
}
```

- [ ] **Step 3: Entry point 1 — MEJ sheet header button**

In `scripts/campaign-companion.mjs`, add a top-level hook (next to the `activateControls` hook; the shell fires `getDocumentSheetHeaderButtons(subsheet, buttons)` while building subsheet header buttons — apps/enhanced-journal.js:567 — with v1-style `{label, class, icon, onclick}` button objects whose `label` passes through MEJ's `i18n()`):

```js
// "Open graph" header button on every MEJ subsheet (spec §5). MEJ's shell
// fires this hook while assembling v1-style header buttons for the mounted
// subsheet; label is an i18n key (MEJ's i18n() localizes it).
Hooks.on("getDocumentSheetHeaderButtons", (subsheet, buttons) => {
  const doc = subsheet?.document;
  if (!(doc instanceof JournalEntryPage)) return;
  if (!game.MonksEnhancedJournal?.getMEJType?.(doc)) return;
  buttons.unshift({
    label: `${I18N}.graph.open`,
    class: "mej-cc-open-graph",
    icon: "fas fa-circle-nodes",
    onclick: async () => {
      const { openGraph } = await import("./apps/graph-app.mjs");
      openGraph({ centerUuid: doc.parent?.uuid ?? doc.uuid });
    }
  });
});
```

- [ ] **Step 4: Entry point 2 — Hub toolbar button**

`scripts/apps/CampaignHubPage.mjs`: add action `openGraph: CampaignHubPage.onOpenGraph` and:

```js
  static async onOpenGraph() {
    const { openGraph } = await import("./graph-app.mjs");
    openGraph();
  }
```

`templates/hub.hbs`: in the index-tab controls row (next to the import/export buttons, but NOT GM-gated — the graph is player-visible):

```handlebars
<button type="button" class="mej-cc-graph-open" data-action="openGraph"
    title="{{localize 'MEJCampaignCompanion.graph.open'}}"><i class="fa-solid fa-circle-nodes"></i></button>
```

- [ ] **Step 5: i18n + styles** — `lang/en.json`: `"graph": { "title": "Relationship Graph", "open": "Graph", "ego": "Focus", "all": "Whole campaign", "backlinks": "Show mention links", "truncated": "Too many entries to draw — filter to reduce (showing the most-connected 200)." }`. Stylesheet: `.mej-cc-graph-app` (svg fills the body), `.mej-cc-graph-edge` (stroke gray; `.backlink` dashed via `stroke-dasharray: 4 3`), `.mej-cc-graph-node text` (small, `text-anchor: middle`, theme-colored), `.mej-cc-graph-node.center circle` (thicker outline), controls row styling.

- [ ] **Step 6: Run unit suite** — `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/graph-app.mjs templates/graph.hbs scripts/campaign-companion.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json styles
git commit -m "feat: relationship graph app (d3-force, ego/whole-campaign, backlink overlay)"
```

---

### Task 13: E2e specs — knowledge panel, dashboards/enricher, graph smoke, leak checks

**Files:**
- Create: `tests/e2e/07-knowledge.spec.mjs`, `tests/e2e/08-query-graph.spec.mjs`
- Possibly modify: any Task 8-12 file where live behavior exposes a bug (fix with `fix(e2e-found):` commits, matching Phase A's convention)

**Interfaces:** consumes the whole Phase B feature set through the browser.

- [ ] **Step 1: Read the existing harness conventions**

Read `tests/e2e/03-search.spec.mjs`, `tests/e2e/auth.setup.mjs`, and `tests/e2e/helpers/` before writing anything. Follow them exactly: same fixture/login pattern, GM + player contexts, `TT-` prefix for all created world content, cleanup in the spec itself. The Foundry test env must be running (World A, port 30000 — see README/`playwright.config.mjs`).

- [ ] **Step 2: Write `tests/e2e/07-knowledge.spec.mjs`**

Cover, as GM unless stated:
1. **Backlinks appear after linking:** create `TT-Backlink-Target` (person) and `TT-Backlink-Source` (place) whose text contains an `@UUID[...]` link to the target (set via API in `page.evaluate` for reliability); open the target in the MEJ shell; assert `.mej-cc-knowledge-backlinks` lists `TT-Backlink-Source` with count.
2. **Tags round-trip:** on the target sheet, type `villain` into `.mej-cc-tag-input` + Enter; assert the chip renders after re-render; assert Hub search finds the entry for query `villain` (tags are indexed); remove the tag; assert chip gone.
3. **Attributes + playerHidden leak check:** add attribute `faction=Zhentarim` (visible) and `patron=Asmodeus` (playerHidden) via the widget; as **player**: open the same entry (grant OBSERVER via ownership update in setup), assert the attributes table shows `faction` but never the string `Asmodeus`; assert Hub search for `Asmodeus` returns nothing as player and does return the entry as GM.
4. **Backlink permission leak check:** create `TT-Backlink-Secret` (GM-only ownership) whose text links to `TT-Backlink-Target`; as player, assert the target's Mentioned-in list does NOT contain `TT-Backlink-Secret`; as GM it does.

- [ ] **Step 3: Write `tests/e2e/08-query-graph.spec.mjs`**

1. **Dashboard CRUD + rendering:** as GM open Hub → Dashboards; add dashboard `TT-Dash` with query `tag:villain`; assert the result list contains `TT-Backlink-Target`-style seeded entries (seed within this spec, `TT-` prefixed); toggle `showPlayers` off/on via edit; as player assert the dashboard is hidden/shown accordingly.
2. **Enricher:** create a journal page whose text contains `@CampaignQuery[tag:villain]`; open it; assert `.mej-cc-query-embed` renders with a result anchor; click the anchor and assert the entry opens in the MEJ shell.
3. **Graph smoke:** seed two `TT-` entries related via MEJ relationships (set `flags["monks-enhanced-journal"].relationships` via API); open the Hub → graph button; assert the graph window renders ≥2 `.mej-cc-graph-node` elements and ≥1 `.mej-cc-graph-edge`; click a node; assert the entry opens.
4. **Graph hidden-relationship gate:** mark the relationship `hidden: true`; as player assert the edge is absent, as GM present.

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e`
Expected: all specs pass (old 24 + new). Fix any live-only bugs found in Tasks 8-12's code with `fix(e2e-found):` commits; keep each fix minimal and re-run.

- [ ] **Step 5: Run the unit suite once more** — `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/07-knowledge.spec.mjs tests/e2e/08-query-graph.spec.mjs
git commit -m "test(e2e): knowledge panel, dashboards, enricher, graph, permission leaks"
```

---

### Task 14: Docs, version bump, changelog

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `module.json`, `docs/manual-test-checklist.md`

**Interfaces:** none.

- [ ] **Step 1: README** — add a "Knowledge layer (0.2.0)" feature section (backlinks, tags + attributes with `playerHidden`, relationship graph, dashboards + `@CampaignQuery[...]` with the grammar one-liner). Update **Known issues**: remove the five fixed Phase A items if listed; add: enricher results refresh on page re-render only (not push-live); graph caps at the 200 most-connected entries; backlinks count only `@UUID` links (plain-text names are caught only once auto-link has converted them).

- [ ] **Step 2: CHANGELOG** — add a `## 0.2.0` section at the top: Added (backlinks panel + Hub badges, tags/attributes, relationship graph, dashboards, `@CampaignQuery` enricher), Fixed/Internal (senderId trust-model docs, `handleUploadRequest` + docx-run-segmentation unit coverage, dead module removal, CI).

- [ ] **Step 3: Version bump** — in `module.json`, set `"version": "0.2.0"` by editing that line only (do not reformat the file; the `download` URL gets re-pinned at release time, as with 0.1.0).

- [ ] **Step 4: Manual test checklist** — append a Phase B section to `docs/manual-test-checklist.md`: graph rendering sanity across themes/system styles, wheel-zoom/drag-pin feel, dashboards under a non-dnd5e system, enricher inside chat messages (enrichers run there too — verify it degrades acceptably), knowledge panel on every MEJ type incl. session.

- [ ] **Step 5: Full check** — `npm test` → PASS. `git status` clean apart from intended changes.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md module.json docs/manual-test-checklist.md
git commit -m "docs: 0.2.0 changelog, README knowledge layer, version bump"
```

---

## Self-review notes (writing-plans checklist, resolved)

- **Spec coverage:** §2 pipeline/permissions → Tasks 4-7; §3 data model → Tasks 4, 9; §4 grammar → Task 7; §5 backlinks UI → Task 8, badges/dashboards → Task 9, enricher → Task 10, graph → Tasks 11-12; §6 error handling → baked into Tasks 8-12 (log-and-skip catch, error rows, node cap, inert enricher placeholder); §7 cleanup items 1-5 → Tasks 1, 1, 2, 2, 3; §8 testing → per-task vitest + Task 13 e2e + Task 3 CI; §9 release prep → Task 14 (the actual GitHub release is cut on request, per the 0.1.0 process); §10 exclusions honored (no attribute templates, no graph editing, no MEJ changes).
- **Type consistency:** `meta: {tags, attrs}` (Tasks 4→7), `{refs, gmRefs}` Maps (Tasks 5→6), `backlinksForEntry -> {uuid,name,type,count,gmOnly}[]` (Tasks 6→8), `runQueryAll` (Tasks 7→9→10), `buildGraph(rows, pairs, opts)` (Tasks 11→12), `SAVED_QUERIES_SETTING` (Task 9 only) — all cross-checked.
- **Known judgment calls recorded for reviewers:** Task 1 tests are characterization (code already exists — TDD's failing-first step doesn't apply cleanly); Task 8's re-render-after-update behavior is deliberately deferred to live verification in Task 13; `renderJournalPageSheet` fires only from MEJ's shell in v14 (core AppV2 page sheets fire class-named hooks), so no double-injection with `renderEnhancedJournalSheet`.
