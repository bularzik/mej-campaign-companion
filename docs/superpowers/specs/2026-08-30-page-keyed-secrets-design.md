# Page-keyed secret reveals — design

Sub-project 2 of the carried-items work
(`2026-08-29-carried-items-design.md` §"Deferred"). Evidence in
`2026-08-28-bugfix-sweep-design.md` §"Carried forward from the Round 3
re-review".

## Problem

Block-secret reveal records are stored on the **JournalEntry**:
`entry.flags.mej-campaign-companion.secretReveals[sectionId] = audience`.
The sections they name live in a **page's** body. Foundry mints
`secret-<randomID>` only when a block is created or pasted through the
editor (`common/prosemirror/menu.mjs`, `paste-transformer.mjs`); when it
parses stored HTML it keeps `el.id` (`schema/secret-node.mjs:29`). So
duplicating a page, importing, or pasting raw HTML carries a section id
into a second page of the same entry, and the entry-level record no
longer identifies one section. Three shipped defects follow:

1. **Wrong-page un-reveal.** The Hub tracker resolves the page by
   containment (first match). With `secret-dup` on pages A and B, acting
   on B's row edits A's class and leaves B untouched.
2. **`pruneOrphans` data loss.** It reads one page's body but rewrites
   the entry-level map with `recursive:false`, so opening page 1 of a
   two-page entry deletes every record belonging to page 2's secrets.
3. **`#secretSectionHtml` first-page fallback.** The tracker whisper
   searches only the first MEJ page, so a secret on any later page is
   whispered as the 140-character index preview instead of its HTML.

A fourth, silent consequence: the search index record is keyed by entry
with last-page-wins, so `meta.secrets` on a multi-page entry holds only
one page's secrets and the tracker never lists the others.

## Decisions taken in chat (2026-08-30)

- **Storage: page flag.** `page.flags.mej-campaign-companion.secretReveals
  = {[sectionId]: audience}`, mirroring `flags.<mod>.session.secrets`,
  which already lives on the page. Records live with their sections.
- **Migration of ambiguous records: every page holding the id gets a
  copy.** This preserves what players see today (`injectPlayerSecrets`
  reads the entry-wide map, so a player with a record for `secret-X`
  currently sees X on every page carrying it). Never drops a reveal.
- Rulings made without asking, open to veto: a record whose id is on
  **no** page is dropped by the migration (`pruneOrphans` would delete it
  on the next GM open anyway, and a page flag has nowhere to live); the
  old entry-level flag is **left in place, unread**, as a rollback copy,
  to be deleted by a later version.
- **Release:** 0.14.0. A stored-data schema change is a minor bump.

## Global constraints

- Companion features never patch MEJ; no edits outside this repo.
- World A is the user's real world: harness cleanup is id/flag-tracked
  only; anything not created by the run is surfaced, never deleted.
- Test fixes wait on real conditions — no `retries`, no `waitForTimeout`.
- Every product fix ships with a regression test and a **vacuity check**
  (disable the fix by hand-edit, watch the test fail, restore).
- Regression gate: a full 18-spec e2e run diffed against `main`'s
  baseline, not a green targeted suite.
- The migration runs once, on the elected `activeGM` client, behind the
  existing `dataVersion` world-setting gate. It must be idempotent and
  must never delete or rewrite the legacy entry flag.

## 1. Data model

```
page.flags["mej-campaign-companion"].secretReveals = {
  [sectionId]: { users: string[], groups: string[], all: boolean, revealedAt: number|null }
}
```

Audience shape and `normalizeAudience` are unchanged. `all` is still
never written true by new code; a legacy `all: true` copied by the
migration is honoured by `sectionRevealedAll(bodyHtml, id, record)`
exactly as before, now with the page's own body and record.

Consequences of living on the page, both intended and documented in the
GM guide:

- **Duplicating a page copies its reveals** (Foundry's page copy clones
  flags). The duplicate's players see what the original's did.
- **Deleting a page deletes its reveals.** No orphan buckets, no
  cross-page prune.

`CURRENT_DATA_VERSION` becomes **4**.

## 2. Migration (v3 → v4)

Appended to the existing runner in `scripts/campaign-companion.mjs` after
the v3 step, inside the same `activeGM && dataVersion < CURRENT` gate, so
a world jumping from v2 still runs v2 → v3 → v4 in order (v3 writes the
entry flag; v4 then copies it to pages).

**Pure planner** `planPageKeyedMigration(entries)` in
`scripts/logic/reveal-migration.mjs`:

```
input:  [{ entryUuid, reveals: {[id]: audience},
           pages: [{ pageUuid, sectionIds: string[], existing: {[id]: audience} }] }]
output: { steps: [{ pageUuid, reveals: {[id]: audience} }],
          dropped: [{ entryUuid, sectionId }] }
```

For each entry and each recorded id: every page whose `sectionIds`
contains the id gets the record in its step, **unless** `existing`
already has that id (idempotence — a re-run after a partial failure never
overwrites a record the GM may since have edited). An id found on no page
goes to `dropped`. Entries with no reveals, and pages that end up with an
empty map, produce no step. Junk input (`null` entries, non-object
reveals) is tolerated, never thrown — this runs during world load.

**Runner**: builds the input from `game.journal.contents` (MEJ pages
only, `sectionIds` via `extractSecretBlocks(bodyRegion(page).content)`,
`existing` from the page flag), then for each step
`page.update({ ["flags.<mod>.secretReveals"]: { ...existing, ...step.reveals } })`
inside per-step try/catch that logs and continues. One console line
summarises pages written and ids dropped (listing entry uuid + id for
each drop so the GM can audit). The entry flag is **not** touched.
`dataVersion` is set to 4 only after the loop, as today.

## 3. Consumers

### `scripts/hooks/secrets-ui.mjs`

- `revealsOf(page)` → `page.getFlag(MODULE_ID, "secretReveals") ?? {}`.
  Every call site passes the page it is rendering.
- `editAudience` writes
  `page.update({ ["flags.<mod>.secretReveals.<id>"]: stored })`.
  `applyBlockReveal` is unchanged.
- `pruneOrphans(page)`: live ids from `bodyRegion(page)`; prunes the
  page's own map with `{ recursive: false }`. Defect 2 is gone by
  construction.
- `injectPlayerSecrets` and `injectGmOverlay` read the page's map only.
- Live refresh: the `updateJournalEntry` hook keeps watching
  `relReveals` only. The existing `updateJournalEntryPage` hook widens
  its check to `flags.<mod>.secretReveals !== undefined ||
  flags.<mod>.session?.secrets !== undefined` and refreshes via
  `refreshRevealViews(page.parent)` as it does today.

### `scripts/search/live-index.mjs`

`recordFor` sets `record.meta.secrets` from **every** MEJ page of the
entry, each block tagged: `{ id, preview, revealedAll, pageUuid }`.
Records stay entry-keyed (no re-keying of the index); only the secrets
payload becomes complete and page-aware. `gmSecretRecords()` is unchanged
in shape — the tag travels inside each secret. Note `revealedAll` is
already computed per block from that block's own page body.

### `scripts/apps/CampaignHubPage.mjs`

- `#secretsContext`: for each index secret, `fromUuidSync(s.pageUuid)`,
  read that page's flag, and push a row with a new `pageUuid` field and
  `revealedAll: sectionRevealedAll(bodyRegion(page).content, s.id, record)`.
  The "join every page body" workaround and its comment are deleted. A
  duplicate id yields one row per page. When the entry has more than one
  MEJ page the row's source label is `"<entry name> · <page name>"`.
- `onTrackerAudience` (block branch): page from `row.dataset.pageUuid`
  via `fromUuid`; the containment search and first-page fallback are
  deleted. If the page no longer exists the handler returns with a
  `ui.notifications.warn` (`secrets.pageGone`). Writes the page flag.
- `#secretSectionHtml(page, secretId)` takes the resolved page and uses
  `bodyRegion(page)`. Defect 3 is gone. The preview fallback remains only
  for a section deleted between render and click.
- `templates/hub.hbs` secret row gains `data-page-uuid="{{this.pageUuid}}"`.

### `scripts/constants.mjs`

`CURRENT_DATA_VERSION = 4`.

### Copy

`lang/en.json`: `secrets.pageGone` — "That page no longer exists."

### Out of scope

`relReveals` (relationship ids are unique per MEJ entry), docx export
(keys on the native class per page body, never the flag), checklist
`session.secrets` (already page-scoped), re-keying the search index by
page.

## 4. Testing

### Unit (vitest)

`test/reveal-migration.test.js`, `describe("planPageKeyedMigration")`:

- single page holding the id → one step;
- id on two pages → both steps carry it (chat decision);
- id on no page → `dropped` names entry + id, no step;
- page already holding the id → skipped; a second pass on its own output
  plans nothing (idempotence);
- an `all: true` legacy record is copied verbatim;
- entry with no reveals / page ending empty → no step;
- junk records and `null` entries are tolerated.

`test/secrets-tracker.test.js`: a row carrying `pageUuid` passes through
`filterTrackerRows` unchanged.

`test/secret-blocks.test.js`: no change (parser untouched).

### e2e (World A, `TT-` fixtures, cleanup by created id)

`tests/e2e/09-secrets.spec.mjs`, two new tests:

- **Duplicate id, two pages.** One `TT-` entry with two MEJ pages both
  containing `<section class="secret" id="secret-dup">`. GM reveals to a
  player from page 2. Assert: page 1's flag is absent; the player sees the
  block on page 2 only; un-revealing from page 2 strips only page 2's
  class. Vacuity: revert `editAudience` to the entry write → fails.
- **Opening page 1 keeps page 2's records.** Seed page 2's flag, open
  page 1's sheet as GM, assert page 2's record survives. Vacuity: revert
  `pruneOrphans` to an entry-scoped prune → fails.

`tests/e2e/10-secrets-hub.spec.mjs`:

- the tracker shows one row per page for the duplicate, labelled by page;
- acting on the page-2 row writes page 2's flag and class;
- the whisper carries page 2's real section HTML, not the preview.

New `tests/e2e/19-reveal-migration.spec.mjs`:

- snapshot `dataVersion`; seed a `TT-` entry with two pages and a
  **legacy entry-level** `secretReveals` (one id on both pages, one on
  page 1 only, one on neither); set `dataVersion` to 3; `reloadGame` as
  GM; assert page 1 holds two records, page 2 holds one, the orphan is on
  neither page, the entry flag is unchanged, `dataVersion` is 4. Restore
  `dataVersion` and delete the fixture by id in `finally`.
- Before the seeded reload, the spec records every **pre-existing**
  entry-level `secretReveals` flag in World A (entry uuid + map) to
  `$CLAUDE_JOB_DIR/tmp/reveal-migration-backup.json` so a bad migration
  is reversible by id. Pre-existing records are never deleted; the report
  lists them.

Existing 09/10 setup that writes `entry.flags…secretReveals` directly is
rewritten to page flags.

Regression gate: full 18 (now 19) spec run diffed against `main`.

### Docs

`docs/gm-guide.md` Secrets section: reveals belong to the page; a
duplicated page keeps its reveals; a deleted page's reveals go with it;
the Secrets tracker labels rows by page when an entry has several.
`CHANGELOG.md` 0.14.0 opens with the migration note (what moves, what is
left in place, what is dropped and where it is logged).
