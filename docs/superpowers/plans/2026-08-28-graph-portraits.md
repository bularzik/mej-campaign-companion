# Relationship Graph Portraits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub Graph-tab nodes show the entity's picture (or MEJ's per-type placeholder) clipped into the node circle, instead of a plain colored dot.

**Architecture:** An `img` URL is threaded through the two pure logic modules (`graph-rows` → `graph-data`) via an injected `imageOf(page, type)` accessor, keeping them Foundry-free and vitest-testable. `drawGraphPane` renders an SVG `<image>` under a circular `<clipPath>` on top of the existing ring `<circle>`, which stays as the load-failure fallback. Node radius goes 10 → 14 everywhere.

**Tech Stack:** Vanilla ES modules, SVG DOM, vendored d3-force, vitest (unit), Playwright (e2e against World A on Foundry v14).

**Spec:** `docs/superpowers/specs/2026-08-28-graph-portraits-design.md`

## Global Constraints

- Companion-only: no file under `monks-enhanced-journal/` is touched.
- Placeholder path is exactly `modules/monks-enhanced-journal/assets/${type}.png`.
- `NODE_R = 14`; every node-geometry literal derives from it.
- No CSS changes; `.mej-cc-graph-node circle` / `.center circle` selectors keep matching the ring circle.
- Clip ids are `mej-cc-clip-<nonce>-<i>`.
- Full vitest suite stays green (baseline 602). All work in worktree `.claude/worktrees/graph-portraits`, branch `feature/graph-portraits`.
- Run unit tests with `npx vitest run <file>`; run e2e with `npx playwright test tests/e2e/08-query-graph.spec.mjs` (needs the World A Foundry instance; `tests/e2e/README.md`).

---

### Task 1: `graphRowsFor` emits `img` via `imageOf`

**Files:**
- Modify: `scripts/logic/graph-rows.mjs:25-43`
- Test: `test/graph-rows.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `graphRowsFor(entries, ctx)` where `ctx.imageOf?: (page, type) => string | null`; each row is `{ uuid, name, type, img: string | null, relationships }`.

- [ ] **Step 1: Update the shape assertion and add the new tests**

In `test/graph-rows.test.js`, change the `toEqual` at line 34 so both rows include `img: null`:

```js
    expect(rows).toEqual([
      { uuid: "J.a", name: "A", type: "person", img: null, relationships: [] },
      { uuid: "J.b", name: "B", type: "quest", img: null, relationships: [] }
    ]);
```

Then add, inside `describe("graphRowsFor", …)` after the "skips untyped entries entirely" case:

```js
  it("carries img from imageOf, called with the winning typed page and its type", () => {
    const calls = [];
    const rows = graphRowsFor(
      [entry("J.a", "A", [page(null), page("person"), page("place")])],
      ctx({ imageOf: (p, type) => { calls.push([p, type]); return "worlds/x/a.png"; } })
    );
    expect(rows[0].img).toBe("worlds/x/a.png");
    expect(calls).toHaveLength(1);
    expect(calls[0][0].__type).toBe("person");
    expect(calls[0][1]).toBe("person");
  });

  it("img is null when imageOf is absent or returns nothing", () => {
    const es = [entry("J.a", "A", [page("person")])];
    expect(graphRowsFor(es, ctx()).map((r) => r.img)).toEqual([null]);
    expect(graphRowsFor(es, ctx({ imageOf: () => undefined })).map((r) => r.img)).toEqual([null]);
    expect(graphRowsFor(es, ctx({ imageOf: () => "" })).map((r) => r.img)).toEqual([null]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/graph-rows.test.js`
Expected: 3 failures — the shape test (missing `img`) and the two new cases (`rows[0].img` is `undefined`).

- [ ] **Step 3: Implement**

In `scripts/logic/graph-rows.mjs`, update the JSDoc `ctx:` line and the row push:

```js
 * ctx: { isGM, userId, groups, getType(page), canObserve(entry),
 *        relRevealsOf(entry), relationshipsOf(page), imageOf?(page, type) }
 */
export function graphRowsFor(entries, { isGM, userId, groups, getType, canObserve, relRevealsOf, relationshipsOf, imageOf }) {
```

and replace the `rows.push(...)` line with:

```js
      const img = typeof imageOf === "function" ? imageOf(page, type) : null;
      rows.push({ uuid: entry.uuid, name: entry.name, type, img: typeof img === "string" && img.length ? img : null, relationships });
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/graph-rows.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/graph-rows.mjs test/graph-rows.test.js
git commit -m "feat(graph): graphRowsFor carries img via injected imageOf accessor"
```

---

### Task 2: `buildGraph` passes `img` onto nodes

**Files:**
- Modify: `scripts/logic/graph-data.mjs:55`
- Test: `test/graph-data.test.js`

**Interfaces:**
- Consumes: rows from Task 1 (`row.img: string | null`, may be absent on legacy rows).
- Produces: `buildGraph(...).nodes[i]` = `{ uuid, name, type, img: string | null }`.

- [ ] **Step 1: Add tests**

In `test/graph-data.test.js`, inside `describe("buildGraph", …)` after the "caps nodes deterministically" case:

```js
  it("copies img onto nodes, null when the row has none, through ego mode and truncation", () => {
    const withImg = rows.map((r) => (r.uuid === "JournalEntry.a" ? { ...r, img: "worlds/x/a.png" } : r));
    const all = buildGraph(withImg, [], { mode: "all", isGM: true });
    expect(all.nodes.find((n) => n.uuid === "JournalEntry.a").img).toBe("worlds/x/a.png");
    expect(all.nodes.find((n) => n.uuid === "JournalEntry.b").img).toBeNull();

    const ego = buildGraph(withImg, pairs, { mode: "ego", centerUuid: "JournalEntry.a", isGM: false, includeBacklinks: true });
    expect(ego.nodes.find((n) => n.uuid === "JournalEntry.a").img).toBe("worlds/x/a.png");

    const many = Array.from({ length: 10 }, (_, i) => ({ uuid: `JournalEntry.n${i}`, name: `N${i}`, type: "person", img: `n${i}.png`, relationships: [] }));
    const capped = buildGraph(many, [], { mode: "all", isGM: true, maxNodes: 5 });
    expect(capped.nodes.every((n) => typeof n.img === "string")).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/graph-data.test.js`
Expected: 1 failure — `img` is `undefined` on nodes.

- [ ] **Step 3: Implement**

In `scripts/logic/graph-data.mjs`, replace

```js
  let nodes = rows.map(({ uuid, name, type }) => ({ uuid, name, type }));
```

with

```js
  let nodes = rows.map(({ uuid, name, type, img }) => ({ uuid, name, type, img: img ?? null }));
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/graph-data.test.js test/graph-rows.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/graph-data.mjs test/graph-data.test.js
git commit -m "feat(graph): buildGraph carries img onto nodes"
```

---

### Task 3: Hub pane supplies `imageOf` and draws clipped portraits

**Files:**
- Modify: `scripts/apps/hub-graph-pane.mjs:16-30` (constants + `prepareGraphContext`), `:114-131` (`drawGraphPane` node creation)
- Test: full suite (`npx vitest run`) — this file has no unit coverage; Task 4 covers it end-to-end.

**Interfaces:**
- Consumes: `graphRowsFor` `imageOf` (Task 1); `node.img` (Task 2).
- Produces: per node, `<g.mej-cc-graph-node>` containing `<circle r=14>`, then when `node.img` a `<clipPath id="mej-cc-clip-<nonce>-<i>">` and `<image>`, then `<text dy=26>`.

- [ ] **Step 1: Constants and `imageOf`**

In `scripts/apps/hub-graph-pane.mjs`, after `const MAX_NODES = 200;` add:

```js
const NODE_R = 14;
const MEJ_ASSET_PATH = "modules/monks-enhanced-journal/assets";
```

In `prepareGraphContext`, add `imageOf` to the `graphRowsFor` ctx object after `relationshipsOf`:

```js
    relationshipsOf: (page) => page.flags?.[MEJ_FLAGS]?.relationships,
    // Entity picture is the typed page's src (MEJ's own convention, see
    // EnhancedJournalSheet relationship rendering); MEJ's generic per-type
    // placeholder otherwise, so every typed node draws an image.
    imageOf: (page, type) => page.src || `${MEJ_ASSET_PATH}/${type}.png`
```

- [ ] **Step 2: Render clipped image per node**

In `drawGraphPane`, replace the block from `const nodeEls = nodes.map((node) => {` through `g.append(circle, label);` with:

```js
  const clipNonce = Math.random().toString(36).slice(2, 8);
  const nodeEls = nodes.map((node, i) => {
    const g = document.createElementNS(NS, "g");
    g.classList.add("mej-cc-graph-node");
    if (node.uuid === centerUuid) g.classList.add("center");
    // Ring: type-hued fill (visible only when there is no image or it fails
    // to load), border stroke and ego-center stroke come from CSS.
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("r", String(NODE_R));
    circle.style.fill = `hsl(${typeHue(node.type)} 55% 45%)`;
    const label = document.createElementNS(NS, "text");
    label.setAttribute("dy", String(NODE_R + 12));
    label.textContent = node.name;
    g.append(circle);
    if (node.img) {
      // Cover-fit the picture into the ring: clip to the circle, "slice"
      // fills and crops rather than squashing. Ids carry a per-draw nonce
      // because url(#id) resolves document-wide and two Hub windows may be
      // open at once. A failed load removes the image, leaving the ring.
      const clipId = `mej-cc-clip-${clipNonce}-${i}`;
      const clip = document.createElementNS(NS, "clipPath");
      clip.setAttribute("id", clipId);
      const clipCircle = document.createElementNS(NS, "circle");
      clipCircle.setAttribute("r", String(NODE_R));
      clip.append(clipCircle);
      const image = document.createElementNS(NS, "image");
      image.setAttribute("href", node.img);
      image.setAttribute("x", String(-NODE_R));
      image.setAttribute("y", String(-NODE_R));
      image.setAttribute("width", String(NODE_R * 2));
      image.setAttribute("height", String(NODE_R * 2));
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      image.setAttribute("clip-path", `url(#${clipId})`);
      image.addEventListener("error", () => image.remove());
      g.append(clip, image);
    }
    g.append(label);
```

The lines that follow (`g.addEventListener("click", …)`, `bindDrag(g, node)`, `svg.append(g)`, `return g;`) stay as they are.

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run`
Expected: 602 + 3 new = 605 pass (Task 1 added 2, Task 2 added 1), 0 failures.

- [ ] **Step 4: Syntax check**

Run: `node --check scripts/apps/hub-graph-pane.mjs`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub-graph-pane.mjs
git commit -m "feat(graph): draw entity picture clipped into node circle, r=14, placeholder fallback"
```

---

### Task 4: E2E assertion, visual check, changelog

**Files:**
- Modify: `tests/e2e/08-query-graph.spec.mjs:216-220` (graph smoke test)
- Modify: `CHANGELOG.md:1-3`

**Interfaces:**
- Consumes: DOM produced by Task 3 (`.mej-cc-graph-node image[href]`).
- Produces: nothing downstream.

- [ ] **Step 1: Add the e2e assertion**

In the "graph smoke" test, directly after

```js
    const nodeA = graphApp.locator(".mej-cc-graph-node", { hasText: nameA });
    await expect(nodeA).toHaveCount(1);
```

add:

```js
    // Every typed node draws its picture clipped into the ring; a person
    // created without a src gets MEJ's per-type placeholder.
    await expect(nodeA.locator("image")).toHaveCount(1);
    await expect(nodeA.locator("image")).toHaveAttribute("href", /modules\/monks-enhanced-journal\/assets\/person\.png$/);
    await expect(nodeA.locator("image")).toHaveAttribute("clip-path", /^url\(#mej-cc-clip-/);
    await expect(nodeA.locator("circle")).toHaveAttribute("r", "14");
```

- [ ] **Step 2: Run the e2e spec**

Run: `npx playwright test tests/e2e/08-query-graph.spec.mjs`
Expected: every test in the file passes, including the extended smoke test. (`guide-screenshots.spec.mjs`'s `circle` opacity check is unaffected — the ring circle remains.) If the run fails on `#interface intercepts pointer events`, that is the pre-existing d3 timing race documented in the test comment — re-run once before investigating.

- [ ] **Step 3: Visual check**

Add a temporary screenshot line before `assertNoConsoleErrors(errors);` in the smoke test — do NOT commit it:

```js
    await shell.screenshot({ path: "test-results/graph-portraits.png" });
```

Run the spec again, open `test-results/graph-portraits.png`, and confirm: nodes are visibly larger than before, placeholder icons are cropped to circles (not squashed), the ego/center ring (if any node is centered) draws over the image, and labels sit clear below the circle. Then remove the screenshot line. If any of these is wrong, fix it in `hub-graph-pane.mjs` and re-run Task 3's Step 3 and this task's Step 2. Keep the PNG — it is attached to the PR.

- [ ] **Step 4: Changelog**

At the top of `CHANGELOG.md`, insert before `## 0.12.0 (2026-08-28)`:

```md
## Unreleased

- New: **Relationship graph nodes show the entity's picture**, clipped
  into the node circle — a person's portrait, a place's illustration, or
  Monk's Enhanced Journal's per-type icon when no picture is set. Nodes
  are slightly larger to make the pictures legible.

```

- [ ] **Step 5: Full gate and commit**

Run: `npx vitest run && git status --short`
Expected: 605 pass; only `tests/e2e/08-query-graph.spec.mjs` and `CHANGELOG.md` modified (no stray screenshot line).

```bash
git add tests/e2e/08-query-graph.spec.mjs CHANGELOG.md
git commit -m "test(graph): assert clipped node image in graph smoke e2e; changelog"
```

---

## After the plan

Use superpowers:finishing-a-development-branch: push `feature/graph-portraits`, open a PR against `main` with the visual-check PNG attached, note the guide-screenshot refresh (`docs/images/graph-*.png`) as an out-of-scope follow-up.
