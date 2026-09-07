# Import: merged sections keep their heading (0.19.2) — design

**Date:** 2026-09-06 · **Base:** main @ 6523ae7 (0.19.1) · **Release:** 0.19.2 (patch)

## Background

The Word import wizard splits a document into sections at headings
(`h1`–`h3`) and at paragraphs that look like session headers (fully bold or
plain text matching `detectSessionHeader`). `splitSections`
(`scripts/logic/doc-import.mjs`) uses the boundary element only to derive
`title`, `level`, `isSession` and `date`; the element itself is never added
to the section's `blocks`.

So when the GM clicks **Merge into previous** (`mergeSections`), the result
is `prev.blocks + cur.blocks` and the absorbed section's heading exists
nowhere — the words the importer had used as that section's name are lost
from the journal page. The legacy plan-time `merge` row type in
`buildImportPlan` has the same hole. **Split** is asymmetric: a later run's
first block stays in the body *and* becomes its title, so merge → split does
not restore the original sections.

## Decisions (user, 2026-09-06)

- A merge re-inserts the absorbed section's **original heading element**
  (its own `h2`/`h3`, or the bold session-header paragraph), not a demoted
  or plain paragraph.
- A split whose new run starts with a heading-shaped block **consumes** it
  as the run's title (and metadata) instead of leaving it in the body, so
  merge → split is an exact round-trip. Non-heading first blocks keep
  today's behaviour.

## §1 Sections remember their heading

`splitSections` stores the boundary element's `outerHTML` on the section as
`headingHtml`; the synthetic "Introduction" section (content before any
heading) gets `headingHtml: null`. `headingHtml` is metadata: it is never
part of `blocks`, `html`, `wordCount` or `empty`, so untouched sections
import exactly as they do today.

Section shape after this change:

```
{ title, level, isSession, date, headingHtml, blocks, html, wordCount, empty }
```

## §2 Merge re-inserts it

`mergeSections(sections, index)`:

```js
const blocks = [...prev.blocks, ...(cur.headingHtml ? [cur.headingHtml] : []), ...cur.blocks];
```

The merged section keeps `prev`'s `title`, `level`, `isSession`, `date` and
`headingHtml`. `html`/`wordCount`/`empty` are re-measured from the new
`blocks` (so the heading's words count).

`buildImportPlan` (`row.type === "merge"`): the appended html becomes
`[previous.html, section.headingHtml, html].filter(Boolean).join("\n")`.

The absorbed row's edited title in the wizard table is discarded, as today:
the heading that survives is the document's own.

## §3 Split consumes a heading block

`splitSectionAt(sections, index, cutIndices, { parseBlock } = {})`:

- `parseBlock(html) → Element | null` parses one block string into its
  root element. Default: when `globalThis.DOMParser` exists,
  `new DOMParser().parseFromString(html, "text/html").body.firstElementChild`;
  otherwise `() => null` (no consumption — pure environments without a DOM
  keep today's behaviour). The wizard passes nothing (the browser default
  applies); unit tests inject JSDOM's `DOMParser`.
- The first run keeps the original section's `title`, `level`, `isSession`,
  `date` and `headingHtml` (as today).
- Each later run: let `el = parseBlock(run[0])`. If `el` and
  `sectionBoundary(el)` is non-null (the same rule the initial split uses:
  `h1`–`h3`, or a `p` that is fully bold or has no child elements and whose
  text passes `detectSessionHeader`), the run becomes
  `{ title: cleanTitle(el.textContent), level: boundary.level, isSession:
  detectSessionHeader(el.textContent), date: parseSectionDate(el.textContent),
  headingHtml: run[0], blocks: run.slice(1) }`. Otherwise today's `newRun`:
  title from the first block's text, `level: 1`, `headingHtml: null`, all
  blocks kept.
- A run whose only block is a consumed heading yields an empty section
  (`blocks: []`, `empty: true`) — the wizard already renders empty sections
  as **Skip**, which is the right default for a stray heading.

Cut indices are unchanged: the split dialog still lists every block
(including a re-inserted heading) and cuts *before* the chosen block.

## Versioning, docs

- `module.json` 0.19.2; CHANGELOG 0.19.2 — Fixed: merging a section in the
  import wizard no longer drops its heading; Changed: splitting at a heading
  block uses it as the new section's name.
- `docs/gm-guide.md` Word import step 4, after the sentence describing the
  Adjust column's two buttons: "Merging keeps the lower section's heading as
  a line in the merged text, and splitting right before that heading turns
  it back into a section name."

## Testing

Unit (`test/doc-import.test.js`, JSDOM where a DOM is needed):

- `splitSections`: an `h2` section has `headingHtml` equal to the heading's
  `outerHTML`; a bold session-header section has the paragraph's
  `outerHTML`; the "Introduction" section has `null`; `blocks`/`html` do not
  contain the heading.
- `mergeSections`: the merged `blocks` are `[...prev, heading, ...cur]`;
  `wordCount` counts the heading; a `headingHtml: null` section merges as
  today; result keeps `prev.headingHtml`.
- `buildImportPlan` `merge` row: previous page html contains the heading
  between the two bodies.
- `splitSectionAt` with an injected JSDOM parser: a run starting with
  `<h2>Arc 2</h2>` gets `title "Arc 2"`, `level 2`, `headingHtml` set and
  the heading removed from `blocks`; a run starting with
  `<p><strong>Session 3 4/1/25</strong></p>` gets `isSession true`, a
  `date`, `level 0`; a run starting with `<p>Gamma</p>` keeps today's result
  (title "Gamma", block kept, `headingHtml null`); without a parser (default
  in node) behaviour is unchanged from today.
- Round-trip: `splitSectionAt(mergeSections(S, 1), 0, [k])` where `k` is the
  index of the re-inserted heading returns sections deep-equal to `S`.

E2E: none added — spec 05 already exercises the import path end to end and
the merge/split editing is pure logic; v14 spec 05 is run once as the
regression check, plus v13 stock smoke.

## Out of scope

- Honouring an edited row title when merging.
- Any change to how the initial split detects boundaries.

## Deviations (final review, 2026-09-06)

- `newRun` keeps a `|| "Untitled"` fallback when a consumed heading has no text (image-only or entity-only headings), while `splitSections` records `title: ""` for such a heading. The merge → split round-trip claim in §3 therefore holds for headings with text; a text-free heading comes back titled "Untitled". Kept deliberately — a blank row title is worse UX than "Untitled".
