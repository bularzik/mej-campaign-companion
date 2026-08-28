# Relationship Graph Portraits — Design

**Date:** 2026-08-28
**Status:** Design approved in discussion; spec pending user review
**Branch:** `feature/graph-portraits` (worktree `.claude/worktrees/graph-portraits`)
**Scope:** Companion-only. No MEJ changes (per the companion-only ruling).

## Problem

The Hub's Graph tab (`scripts/apps/hub-graph-pane.mjs`) draws every node as
a 10px `<circle>` filled with a per-type hue. Entities in MEJ have a picture
— a person's portrait, a place's illustration — and the graph throws that
away, so a graph of twenty people is twenty identical blue dots
distinguished only by their labels.

## Decisions

| Question | Decision |
|---|---|
| Which picture | The typed page's `src` — the same field MEJ itself uses for the entity image (`EnhancedJournalSheet.js:938`, which also mirrors it to the entry's `flags.monks-enhanced-journal.img`). |
| No picture set | **Show MEJ's generic per-type placeholder** (`modules/monks-enhanced-journal/assets/<type>.png`) — user-selected after initially preferring the plain circle. Every typed node therefore carries an image; the plain colored circle is now only the failure fallback. |
| Shape | Clip the image to the node circle ("cover" fit: fill the circle and crop, never squash). |
| Radius | All nodes go from r=10 to **r=14** so portraits are legible. Uniform, not mixed — mixed radii read as a meaning that isn't there. `forceCollide(26)` already leaves room; unchanged. |
| Ring | The existing `<circle>` stays underneath the image as the ring: type-hued fill (visible only if the image fails), 1px border stroke, 3px orange stroke for the ego center. CSS selectors are unchanged. |
| Failure | `<image>` `error` event removes the image element, revealing the plain circle. A renamed MEJ asset or a dead portrait path degrades to today's rendering, never a broken-image glyph. |
| Data | Image URL is threaded through the two pure logic modules as a plain `img` string so it stays vitest-testable and Foundry-free. |

## 1. Data

**`scripts/logic/graph-rows.mjs` — `graphRowsFor(entries, ctx)`**

- New injected accessor on `ctx`: **`imageOf(page, type)`** → string URL or
  `null`. Called once per row for the winning typed page.
- Row gains `img` (string | null). Existing row fields unchanged.
- Absent `imageOf` (older callers, tests that don't care) → `img: null`.

**`scripts/logic/graph-data.mjs` — `buildGraph(rows, …)`**

- Node projection `({ uuid, name, type })` becomes `({ uuid, name, type, img })`,
  `img` defaulting to `null` when the row has none. Ego filtering and
  truncation are unaffected (they key on `uuid`/degree only).

**`scripts/apps/hub-graph-pane.mjs` — `prepareGraphContext`**

- Supplies:

  ```js
  imageOf: (page, type) => page.src || `modules/monks-enhanced-journal/assets/${type}.png`
  ```
- `page.src` is trusted as-is (it is whatever MEJ / the file picker stored;
  the graph only *displays* it, the same as MEJ's own sheet). No new write
  surface, no new permission surface — rows are already permission-filtered
  before this point.

## 2. Render (`drawGraphPane`)

Per node, inside the existing `<g class="mej-cc-graph-node">`:

```
<circle r="14" style="fill: hsl(<type hue>)">        ← existing, radius bumped
<clipPath id="mej-cc-clip-<nonce>-<i>"><circle r="14"/></clipPath>   ← new, when node.img
<image href=img x=-14 y=-14 width=28 height=28
       preserveAspectRatio="xMidYMid slice"
       clip-path="url(#mej-cc-clip-<nonce>-<i>)"/>            ← new, when node.img
<text dy="26">name</text>                            ← existing, dy 22 → 26
```

- `NODE_R = 14` is a module constant; every literal above derives from it.
- `clipPath` ids are `mej-cc-clip-<nonce>-<i>`: `<i>` is the node index,
  `<nonce>` a random token generated once per `drawGraphPane` call. SVG
  resolves `url(#id)` document-wide, so the nonce keeps ids unique when two
  Hub windows (two `<svg>`s) are open at once; `svg.replaceChildren()` at
  the top of the draw discards the previous draw's ids within one window.
- `image.addEventListener("error", () => image.remove())` — failure
  fallback per Decisions.
- Pointer events: the `<image>` sits inside `g`, so click-to-open and
  drag-to-pin keep working with no listener changes. The `<text>` label
  already has `pointer-events: none`.
- No CSS changes required. `.mej-cc-graph-node circle` /
  `.center circle` selectors still match the ring circle (the clipPath's
  inner circle is not rendered and takes no style).

## 3. Testing

**Unit (vitest, TDD):**

- `test/graph-rows.test.js`
  - row carries `img` from `imageOf(page, type)`; accessor receives the
    winning typed page and its type;
  - `img: null` when `imageOf` is absent or returns null.
- `test/graph-data.test.js`
  - node carries `img` through `buildGraph`; `null` when the row has none;
  - ego-mode and truncation still return the `img` field (one assertion
    each, piggybacking on existing cases).

Existing `toEqual` assertions on row/node shape are updated to include
`img: null`.

**E2E (Playwright, `tests/e2e/08-query-graph.spec.mjs`):**

- Extend the existing graph smoke test: each node has exactly one `image`
  element, and for a person page with no `src` its `href` ends in
  `assets/person.png`. (Portrait-set case is the same code path with a
  different string; the unit tests cover the selection logic, the e2e
  proves the element is drawn.)
- `tests/e2e/guide-screenshots.spec.mjs:233` asserts the node `circle` has
  non-zero opacity — still true (the ring circle remains), no change.

**Visual:** screenshot the Graph tab in World A with at least one entry
that has a real portrait and one that does not; confirm cover-fit
cropping and the ego-center ring over an image. Attach to the PR.

**Gate:** full vitest suite green (baseline 602), e2e spec 08 green.

## 4. Out of scope

- Refreshing the guide screenshots (`docs/images/graph-*.png`) — they will
  look stale after this change; regenerate via `guide-screenshots.spec.mjs`
  as a follow-up, not in this branch.
- Hover/zoomed portrait preview, image nodes for untyped (plain journal)
  entries, and any MEJ-side change.

## 5. Files

| File | Change |
|---|---|
| `scripts/logic/graph-rows.mjs` | `imageOf` accessor, `img` on rows |
| `scripts/logic/graph-data.mjs` | `img` on nodes |
| `scripts/apps/hub-graph-pane.mjs` | supply `imageOf`; `NODE_R`; clipPath + image per node; error fallback |
| `test/graph-rows.test.js`, `test/graph-data.test.js` | new assertions |
| `tests/e2e/08-query-graph.spec.mjs` | image-element assertion in smoke test |
| `CHANGELOG.md` | Unreleased entry |
