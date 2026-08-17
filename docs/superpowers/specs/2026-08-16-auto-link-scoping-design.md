# Auto-Link Scoping Expansion — Design

**Date:** 2026-08-16
**Status:** Approved (brainstorm decisions 2026-08-16)
**Ships as:** mej-campaign-companion 0.4.0

## Problem

Auto-linking today runs only on the typing path: `scripts/hooks/auto-link.mjs`
listens to `preUpdateJournalEntryPage`, diffs the saved `text.content` against
its baseline, and wraps newly-added mentions of MEJ entry names as `@UUID`
content links. Two gaps:

1. **Docx import** creates pages via `JournalEntry.create`, so the
   `preUpdate` hook never fires — imported text is never auto-linked.
2. **New entity creation** never links existing plain-prose mentions of the
   new entity's name retroactively.

Closing those gaps exposes a scoping problem the typing path never had to
face. Typing candidates are filtered by the *acting user's* visibility
(`isVisibleToUser`: GM, or `testUserPermission ≥ LIMITED`), which is correct
when a player types — a name matching only a GM-set entity does not link. But
the importer/creator in the new paths is usually the **GM, whose set is
everything**: a naive "acting-user visibility" rule would write GM-only links
into player-visible pages.

### How MEJ bounds visibility (analysis)

- MEJ has **no visibility system of its own** — it defers entirely to core
  Foundry document ownership (default level plus per-user overrides
  NONE/LIMITED/OBSERVER/OWNER on the JournalEntry). MEJ gates opening a sheet
  at OBSERVER; the companion's index/search/graph gate at LIMITED.
- **Every document syncs to every client**; permission is UI-enforced, not
  data-enforced. Candidate filtering is entirely the module's job.
- A `@UUID` link to an entry the viewer cannot see still **renders as a
  styled content link** (label = the prose already present; clicking yields a
  permission warning). Writing out-of-set links is therefore a soft metadata
  leak plus bad UX, not a hard content leak.
- Phase C secrets are block-level *within* visible entries — orthogonal to
  entity-level linking, which is bounded by ownership alone.

## Decisions (locked)

| # | Question | Decision |
|---|----------|----------|
| 1 | Boundary rule | **Audience containment**, uniform across typing, import, and retroactive paths |
| 2 | Retroactive actor | **Active GM client + catch-up queue** for entities created with no GM online |
| 3 | Scan surface | **Page `text.content` only** |
| 4 | Review UX | **World setting `retroLinkMode`: off / confirm / silent, default confirm** |
| 5 | Same-name ambiguity | **Skip + report**, never guess |
| 6 | Permission drift | **Import validates against the entry's finish-time audience; elsewhere documented caveat** |
| 7 | Implementation | **Reuse the existing engine (`autoLinkAdded` with empty baseline), stored links** |

## Part 1 — Boundary model: audience containment

**The rule.** A mention in page P may link to entity E only if **every non-GM
user who can view P can also view E**. "Can view" is the existing
`isVisibleToUser(entry, user)` predicate (GM, or `testUserPermission ≥
LIMITED`), evaluated on P's parent JournalEntry and on E — the same
entry-level threshold the Hub index, search, and graph use, so "your set"
means the same thing module-wide.

**New pure module `scripts/logic/link-audience.mjs`:**

- `viewerIds(entry, users, isVisibleToUser)` → array of non-GM user ids who
  can view the entry.
- `audienceContains(pageViewerIds, targetViewerIds)` → boolean subset test
  (every page viewer appears in the target's viewers).

Pure and unit-testable; Foundry glue stays in the hooks.

**One rule, three paths.** The containment filter **replaces** the
acting-user visibility filter in the typing hook's `buildCandidates`, and is
the candidate/page filter for the two new paths. Behavioral notes:

- *Player typing:* identical to today — a player who can edit P is a viewer
  of P, so containment implies every permitted target is in their set.
- *GM typing:* deliberately **stricter** than today — typing a GM-only
  entity's name into a player-visible page no longer creates a link players
  can see but not open. GM-only pages still link everything.
- *Fully-private pages* (no player viewers): all entities are legal targets;
  GM prep notes link freely.

**Ambiguity.** If a matched name belongs to two or more entities that both
pass containment for the page, the mention stays plain text and is reported
("ambiguous — link manually"). For player-visible pages, a GM-only twin is
already excluded by containment, so the common duplicate case self-resolves.

**Drift caveat (documented, not engineered).** Containment is evaluated at
write time. Later permission changes (sharing a page more widely, hiding a
target) do not rewrite existing links. One guard: the import path evaluates
containment against the audience the entry will actually have when the wizard
finishes (Part 2). Same documented-caveat posture as Phase C group-membership
timing. README gets a "Scoping and permission changes" subsection.

## Part 2 — Mechanics

### Retroactive pass (new entity → existing pages)

**Trigger + queue in one mechanism.** The creating client stamps
`flags["mej-campaign-companion"].retroLinkPending = true` into the creation
data of every new MEJ-typed JournalEntry (`preCreateJournalEntry`, creating
client only). The **active GM's client** (`game.users.activeGM ===
game.user`, deduping multiple GMs) processes pending entries in two places:

1. the `createJournalEntry` hook — immediate when a GM is online;
2. a `ready`-time sweep over `game.journal` — catch-up for entities created
   while no GM was connected.

Processing clears the flag. This avoids the "players cannot write world
settings" problem (a creator always owns the document they just created) and
the queue self-heals when pending entities are deleted.

**Planner (`scripts/logic/retro-link.mjs`, pure).** Input: the new entity
descriptor (uuid, name, viewer ids), page descriptors (uuid, name, content,
parent-entry viewer ids, `noAutoLink` flag, self flag), and the names/viewer
ids of same-named entities. It scans every text page with non-empty
`text.content`, skipping:

- the new entity's own pages,
- pages flagged `noAutoLink`,
- pages failing `audienceContains(pageViewers, entityViewers)`.

Matching is `autoLinkAdded("", content, [entity])` — the empty baseline marks
the whole document as eligible, so the proven tokenizer/matcher/claiming
engine does whole-document linking and existing links/`<code>`/`<pre>` remain
opaque. If another same-named entity also passes containment for the page,
the page is reported ambiguous and not written. Output plan:
`[{pageUuid, pageName, matchCount, newHtml, ambiguous}]`.

**Review mode.** World setting `retroLinkMode` (`off | confirm | silent`,
world scope, default `confirm`):

- `confirm` → a GM dialog (only when the plan is non-empty) lists pages with
  match counts and checkboxes plus the ambiguous list; Apply writes the
  checked pages.
- `silent` → writes immediately, then whispers the GM a summary (entity,
  pages, counts, ambiguities).
- `off` → the pass never runs (pending flags are still cleared).

Page writes pass `options["mej-campaign-companion"].retroLink = true`; the
typing hook returns early on that flag so the pass never re-triggers itself.

### Docx import

- The import wizard gains an **Audience** select — `GM only` (default) or
  `All players (Observer)` — which both sets the created entry's ownership
  and defines the containment audience for import-time linking. This honors
  decision 6: links are validated against the audience the entry actually
  ends up with.
- Before `JournalEntry.create`, imported HTML runs through the same engine
  (`autoLinkAdded("", html, candidates)`) with candidates filtered by
  containment against that audience. Links land in the initial create — no
  second write, no typing-hook involvement. Ambiguous names are skipped and
  noted in the import summary. Gated by the existing `autoLink` world
  setting, like typing.
- Player-collab uploads already funnel through the GM's filing flow and
  inherit this unchanged.
- The imported entry is itself a new entity, so the retroactive pass then
  links *its* name across existing pages via the same pending-flag path.

### Settings summary

| Setting | Scope | Values | Default | Gates |
|---------|-------|--------|---------|-------|
| `autoLink` (existing) | world | boolean | existing default | typing path + import-time linking |
| `retroLinkMode` (new) | world | off / confirm / silent | confirm | retroactive pass |

### Error handling

Observer posture throughout (as with auto-link/auto-capture today): any
failure logs (`console.error` with module prefix) and skips that page — never
blocks the underlying create/import/save. Partial apply failures are reported
in the dialog/summary. `noAutoLink` page flag is respected on every path.

### Testing

- **Unit:** `link-audience` subset logic (GM-only pages, mixed audiences,
  empty users); `retro-link` planner (containment filter, self-page skip,
  `noAutoLink` skip, ambiguity skip, empty-baseline whole-document linking,
  plan shape); import candidate filtering against a chosen audience.
- **E2e:** GM creates a GM-only entity whose name appears in a GM page and a
  player-visible page → confirm dialog lists only the GM page → apply →
  link present in GM page, player page untouched. Docx import with audience
  "All players" links only player-visible targets. Ready-sweep processes an
  entity flagged pending. `retroLinkMode: silent` writes and whispers.

## Non-goals

- Renames do not trigger re-linking.
- No render-time link filtering; links are stored text.
- No link-stripping or re-validation on later permission changes (beyond the
  import-time audience guard).
- Scan surface is page `text.content` only — no MEJ subtype flag fields.
- No per-page audience granularity: containment is evaluated on the page's
  parent JournalEntry, matching the module's entry-level visibility model.
