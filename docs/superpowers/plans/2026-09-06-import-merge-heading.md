# Import Merge Keeps Heading (0.19.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Word import wizard, merging a section into the one above keeps the absorbed section's heading as a line of the merged text, and splitting right before a heading turns it back into a section name.

**Architecture:** `splitSections` records each section's boundary element as `headingHtml` (metadata, never in `blocks`). `mergeSections` and `buildImportPlan`'s legacy `merge` row re-insert it before the absorbed blocks. `splitSectionAt` takes an injected `parseBlock` and, when a later run's first block is a section boundary, consumes it as that run's title/metadata/`headingHtml`. All pure logic in one file; the wizard needs no change (browser default parser).

**Tech Stack:** Foundry VTT 13/14 module, vitest (+ JSDOM for DOM-shaped tests), Playwright e2e harness.

**Spec:** `docs/superpowers/specs/2026-09-06-import-merge-heading-design.md` (commit 49a7ffe)

## Global Constraints

- Companion features never patch MEJ: nothing under `/Users/danbularzik/Claude/Projects/monks-enhanced-journal` is modified.
- Worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/import-merge-heading`, branch `fix/import-merge-heading`, base main @ 6523ae7. Run every command from the worktree root.
- `headingHtml` is metadata only: never part of `blocks`, `html`, `wordCount` or `empty` — untouched sections import byte-identically (spec §1).
- Merge: `blocks = [...prev.blocks, ...(cur.headingHtml ? [cur.headingHtml] : []), ...cur.blocks]`; merged section keeps `prev`'s `title/level/isSession/date/headingHtml`; `html/wordCount/empty` re-measured (spec §2).
- Split: `splitSectionAt(sections, index, cutIndices, { parseBlock } = {})`; default parser uses `globalThis.DOMParser` when present, else returns `null` (today's behaviour). A later run whose first block is a section boundary (same `sectionBoundary` rule as the initial split) is consumed: `title: cleanTitle(text)`, `level: boundary.level`, `isSession`, `date`, `headingHtml: run[0]`, `blocks: run.slice(1)`. First run unchanged (spec §3).
- Release version `0.19.2`; no new zip paths.
- Shipped tests: no `retries`/`waitForTimeout`/`test.skip`; `--trace off`; one spec per command; respect `<FOUNDRY_DATA>/.claude-e2e-lock` (wait, never unlock). World A is the user's real world.
- Never `git stash`. Commit after every task with a conventional message.

---

### Task 1: `headingHtml` through split, merge and plan

**Files:**
- Modify: `scripts/logic/doc-import.mjs` (`mergeSections` ~106, `keepRun`/`newRun` ~123-138, `splitSectionAt` ~141, `splitSections` `open()` ~168, `buildImportPlan` merge branch ~279)
- Test: `test/doc-import.test.js`

**Interfaces:**
- Produces: section objects gain `headingHtml: string | null`; `splitSectionAt(sections, index, cutIndices, { parseBlock } = {})` where `parseBlock(html: string) => Element | null`.

- [ ] **Step 1: Write the failing tests**

In `test/doc-import.test.js`:

(a) Inside `describe("splitSections", …)` add:

```js
  it("records each section's heading element as headingHtml, outside its blocks", () => {
    const { sections } = splitSections(body(`
      <p>Lead-in.</p>
      <h2>Arc 2</h2>
      <p>Body two.</p>
      <p><strong>Session 3 4/1/25</strong></p>
      <p>Body three.</p>`));
    expect(sections.map((s) => s.headingHtml)).toEqual([
      null,
      "<h2>Arc 2</h2>",
      "<p><strong>Session 3 4/1/25</strong></p>"
    ]);
    expect(sections[1].blocks).toEqual(["<p>Body two.</p>"]);
    expect(sections[1].html).toBe("<p>Body two.</p>");
    expect(sections[2].blocks).toEqual(["<p>Body three.</p>"]);
  });
```

(b) Inside `describe("mergeSections", …)` add `headingHtml: null` to the `blk` default (`title: "S", level: 1, date: null, isSession: false, headingHtml: null, …`) and add:

```js
  it("re-inserts the absorbed section's heading before its blocks and counts its words", () => {
    const before = [
      blk({ title: "One", headingHtml: "<h2>One</h2>", blocks: ["<p>a</p>"], html: "<p>a</p>", wordCount: 1 }),
      blk({ title: "Two", headingHtml: "<h2>Two</h2>", blocks: ["<p>b</p>"], html: "<p>b</p>", wordCount: 1 })
    ];
    const after = mergeSections(before, 1);
    expect(after[0].blocks).toEqual(["<p>a</p>", "<h2>Two</h2>", "<p>b</p>"]);
    expect(after[0].html).toBe("<p>a</p>\n<h2>Two</h2>\n<p>b</p>");
    expect(after[0].wordCount).toBe(3);
    expect(after[0].headingHtml).toBe("<h2>One</h2>");
  });

  it("merges a heading-less section exactly as before", () => {
    const before = [blk({ blocks: ["<p>a</p>"] }), blk({ headingHtml: null, blocks: ["<p>b</p>"] })];
    expect(mergeSections(before, 1)[0].blocks).toEqual(["<p>a</p>", "<p>b</p>"]);
  });
```

(c) Inside `describe("buildImportPlan", …)` add:

```js
  it("a merge row carries its heading into the previous page", () => {
    const { pages } = buildImportPlan([
      sec({ title: "Intro" }),
      sec({ title: "Part 2", html: "<p>more</p>", headingHtml: "<h2>Part 2</h2>" })
    ], [
      { title: "Intro", type: "journalentry", timepoint: false },
      { title: "Part 2", type: "merge", timepoint: false }
    ], KINDS);
    expect(pages).toHaveLength(1);
    expect(pages[0].html).toBe("<p>x</p>\n<h2>Part 2</h2>\n<p>more</p>");
  });
```

(d) Inside `describe("splitSectionAt", …)` add `headingHtml: "<h1>Big</h1>"` to `base` and add:

```js
  const parseBlock = (html) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;

  it("consumes a heading block as the new run's title when a parser is given", () => {
    const sec = { ...base, blocks: ["<p>Alpha</p>", "<h2>Arc 2</h2>", "<p>Beta</p>"], html: "x", wordCount: 4 };
    const after = splitSectionAt([sec], 0, [1], { parseBlock });
    expect(after[0]).toMatchObject({ title: "Big", headingHtml: "<h1>Big</h1>", blocks: ["<p>Alpha</p>"] });
    expect(after[1]).toMatchObject({
      title: "Arc 2", level: 2, isSession: false, date: null,
      headingHtml: "<h2>Arc 2</h2>", blocks: ["<p>Beta</p>"], html: "<p>Beta</p>", wordCount: 1
    });
  });

  it("consumes a bold session-header paragraph with session/date detection", () => {
    const sec = { ...base, blocks: ["<p>Alpha</p>", "<p><strong>Session 3 4/1/25</strong></p>", "<p>Beta</p>"], html: "x", wordCount: 5 };
    const after = splitSectionAt([sec], 0, [1], { parseBlock });
    expect(after[1]).toMatchObject({
      title: "Session 3 4/1/25", level: 0, isSession: true, date: "2025-04-01",
      headingHtml: "<p><strong>Session 3 4/1/25</strong></p>", blocks: ["<p>Beta</p>"]
    });
  });

  it("leaves a non-heading first block in the body (title still derived from it)", () => {
    const after = splitSectionAt([base], 0, [2], { parseBlock });
    expect(after[1]).toMatchObject({ title: "Gamma", level: 1, headingHtml: null, blocks: ["<p>Gamma</p>"] });
  });

  it("a run that is only a consumed heading becomes an empty section", () => {
    const sec = { ...base, blocks: ["<p>Alpha</p>", "<h2>Tail</h2>"], html: "x", wordCount: 2 };
    const after = splitSectionAt([sec], 0, [1], { parseBlock });
    expect(after[1]).toMatchObject({ title: "Tail", headingHtml: "<h2>Tail</h2>", blocks: [], empty: true, wordCount: 0 });
  });

  it("without a DOM parser, behaviour is unchanged", () => {
    const sec = { ...base, blocks: ["<p>Alpha</p>", "<h2>Arc 2</h2>", "<p>Beta</p>"], html: "x", wordCount: 4 };
    const after = splitSectionAt([sec], 0, [1], { parseBlock: () => null });
    expect(after[1]).toMatchObject({ title: "Arc 2", level: 1, headingHtml: null, blocks: ["<h2>Arc 2</h2>", "<p>Beta</p>"] });
  });

  it("merge then split at the re-inserted heading is an exact round-trip", () => {
    const { sections } = splitSections(body(`
      <h2>One</h2><p>a</p>
      <h2>Two</h2><p>b</p><p>c</p>`));
    const merged = mergeSections(sections, 1);
    const headingIndex = merged[0].blocks.indexOf("<h2>Two</h2>");
    expect(splitSectionAt(merged, 0, [headingIndex], { parseBlock })).toEqual(sections);
  });
```

Note the round-trip test needs `body` and `splitSections` from the earlier import block in the same file (they are module-level, so already in scope).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/doc-import.test.js`
Expected: the new tests FAIL (`headingHtml` undefined; blocks/titles as today).

- [ ] **Step 3: Implement**

In `scripts/logic/doc-import.mjs`:

`splitSections` — change `open` to take the element and record its outerHTML; the synthetic Introduction passes `null`:

```js
  const open = (heading, level, headingHtml) => {
    current = { title: cleanTitle(heading), level, headingHtml, htmlParts: [] };
    current.isSession = detectSessionHeader(heading);
    current.date = parseSectionDate(heading);
    sections.push(current);
  };

  for (const el of nodes) {
    const boundary = sectionBoundary(el);
    if (boundary) {
      // The heading itself is metadata, not body: it lives in headingHtml
      // so a later merge can put it back as a line of the merged text.
      open(el.textContent, boundary.level, el.outerHTML);
      continue;
    }
    if (!current) open("Introduction", 1, null), current.isSession = false, current.date = null;
    current.htmlParts.push(el.outerHTML);
  }
```

`mergeSections`:

```js
/**
 * Merge sections[index] into sections[index-1]. The absorbed section's
 * heading element comes back as a block between the two bodies - without
 * it the words the importer used for that section's name would vanish
 * from the page (spec 2026-09-06 §2).
 */
export function mergeSections(sections, index) {
  if (index <= 0 || index >= sections.length) return sections.slice();
  const prev = sections[index - 1];
  const cur = sections[index];
  const blocks = [...prev.blocks, ...(cur.headingHtml ? [cur.headingHtml] : []), ...cur.blocks];
  const merged = {
    title: prev.title, level: prev.level, isSession: prev.isSession, date: prev.date,
    headingHtml: prev.headingHtml ?? null,
    blocks, ...measureBlocks(blocks)
  };
  return [...sections.slice(0, index - 1), merged, ...sections.slice(index + 1)];
}
```

`keepRun` adds `headingHtml: orig.headingHtml ?? null`. Replace `newRun` and `splitSectionAt`:

```js
// Later runs derive title + detection from their own first block. When
// that block is itself a section boundary (a heading a merge put back, or
// one the GM cut right before), it is consumed as the run's name and
// metadata rather than duplicated into the body (spec 2026-09-06 §3).
function newRun(blocks, parseBlock) {
  const el = blocks.length ? parseBlock(blocks[0]) : null;
  const boundary = el ? sectionBoundary(el) : null;
  if (boundary) {
    const text = el.textContent ?? "";
    const rest = blocks.slice(1);
    return {
      title: cleanTitle(text) || "Untitled", level: boundary.level,
      isSession: detectSessionHeader(text), date: parseSectionDate(text),
      headingHtml: blocks[0], blocks: rest, ...measureBlocks(rest)
    };
  }
  const title = firstBlockTitle(blocks);
  return {
    title, level: 1, isSession: detectSessionHeader(title), date: parseSectionDate(title),
    headingHtml: null, blocks, ...measureBlocks(blocks)
  };
}

/** Parse one block string to its root element with the host DOM, or null where there is none (pure node). */
function defaultParseBlock(html) {
  const Parser = globalThis.DOMParser;
  if (!Parser) return null;
  return new Parser().parseFromString(html, "text/html").body.firstElementChild;
}

/** Split sections[index] into contiguous runs at the given block cut indices. */
export function splitSectionAt(sections, index, cutIndices, { parseBlock = defaultParseBlock } = {}) {
  const section = sections[index];
  if (!section) return sections.slice();
  const n = section.blocks.length;
  const cuts = [...new Set(cutIndices)]
    .filter((i) => Number.isInteger(i) && i > 0 && i < n)
    .sort((a, b) => a - b);
  if (!cuts.length) return sections.slice();
  const bounds = [0, ...cuts, n];
  const runs = [];
  for (let i = 0; i < bounds.length - 1; i++) runs.push(section.blocks.slice(bounds[i], bounds[i + 1]));
  const rebuilt = runs.map((run, i) => (i === 0 ? keepRun(run, section) : newRun(run, parseBlock)));
  return [...sections.slice(0, index), ...rebuilt, ...sections.slice(index + 1)];
}
```

`buildImportPlan` merge branch:

```js
    if (row.type === "merge") {
      const previous = pages[pages.length - 1];
      if (!previous) {
        warnings.push(`Section "${name}" had nothing to merge into and was skipped`);
        return;
      }
      // Keep the absorbed section's heading, as the wizard's Merge button does.
      previous.html = [previous.html, section.headingHtml, html].filter(Boolean).join("\n");
      return;
    }
```

- [ ] **Step 4: Run the file, then the full suite**

Run: `npx vitest run test/doc-import.test.js` → PASS. Then `npx vitest run` → all green (830 + 9 new).

If the existing test "re-detects session/date on new runs and ignores invalid cuts" fails: it passes no parser, so `defaultParseBlock` runs — vitest's node environment has no `DOMParser`, so it must return `null` and the test must still pass; if `DOMParser` IS present in this environment, the plain `<p>Session Zero 10/6/2024</p>` block is a boundary and gets consumed — then update that test's expectations to `headingHtml: "<p>Session Zero 10/6/2024</p>", blocks: ["<p>We begin.</p>"]` and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-import.mjs test/doc-import.test.js
git commit -m "fix(import): merged sections keep their heading; split consumes a heading block"
```

---

### Task 2: Docs, version, regression runs

**Files:**
- Modify: `module.json:5`, `CHANGELOG.md:1-3`, `docs/gm-guide.md` (Word import step 4)

- [ ] **Step 1: Version and changelog**

`module.json`: `"version": "0.19.2"`. Insert after `# Changelog` and a blank line:

```markdown
## 0.19.2 (2026-09-06)

Import wizard: merging keeps the heading.

- **Fixed:** merging a section into the one above (the Adjust column's merge button, or the legacy merge row type) dropped the absorbed section's heading — the words the importer had used as its name vanished from the page. The heading now comes back as a line of the merged text, in its original form (h2/h3, or the bold session line).
- **Changed:** splitting a section right before a heading-shaped block turns that block back into the new section's name (with session/date detection) instead of leaving it duplicated as the first line — so merge then split restores the original sections.
```

- [ ] **Step 2: GM guide**

In `docs/gm-guide.md`, Word import step 4, after the sentence "The **Adjust** column's two icon buttons merge a row into the section above it, or split one section into two." append:

```markdown
 Merging keeps the lower section's heading as a line in the merged text, and splitting right before that heading turns it back into a section name.
```

- [ ] **Step 3: Checks**

Run: `npm run check:links && npm run check:vendor && npx vitest run` → all OK / green.

- [ ] **Step 4: Regression runs (one spec per command, `--trace off`, 600000 ms timeout; check `ls /Users/danbularzik/FoundryVTT-14/Data/.claude-e2e-lock` first — wait if present, never unlock)**

`npx playwright test tests/e2e/05-docx-import.spec.mjs --trace off` → expected PASS (1/1).
`FOUNDRY_TARGET=v13 STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs --trace off` → expected 8/8.
If 05 fails, A/B by running the same spec from the main checkout `/Users/danbularzik/Claude/Projects/mej-campaign-companion` (never stash) and report both.

- [ ] **Step 5: Commit**

```bash
git add module.json CHANGELOG.md docs/gm-guide.md
git commit -m "chore(release): 0.19.2 — changelog, guide, version"
```

---

## Self-review

- **Spec coverage:** §1 (`headingHtml` recorded, metadata only) → Task 1 `splitSections` + test (a). §2 (merge re-inserts; plan-time merge) → Task 1 `mergeSections`/`buildImportPlan` + tests (b)(c). §3 (injected parser, consumption rule, first run unchanged, empty-heading run, no-DOM fallback) → Task 1 `newRun`/`defaultParseBlock`/`splitSectionAt` + tests (d). Round-trip → test (d) last case. Docs/version → Task 2. E2E regression (05 + v13 smoke) → Task 2 Step 4. The wizard needs no change (browser default parser) — consistent with spec §3.
- **Placeholders:** none.
- **Type consistency:** `headingHtml` name and `{ parseBlock }` option identical across implementation and tests; `parseBlock` returns `Element|null` in both the JSDOM test helper and `defaultParseBlock`.
