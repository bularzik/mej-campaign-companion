# Secrets layer: native reveal semantics — design

**Date:** 2026-08-28
**Branch:** `feature/secrets-native-reveal`
**Baseline:** `main` @ `e125de8` (0.13.2)
**Parent:** Round 3 of the bugfix sweep — see
`2026-08-28-bugfix-sweep-design.md` for the inventory this is drawn from.

## Purpose

Two carried defects in the secrets layer, which turn out to be one problem
seen twice: the companion's reveal engine and Foundry's own secret model
disagree about what "revealed" means.

1. **"Everyone" is companion-private.** Choosing it stores `audience.all` on
   a companion flag. Foundry, core sheets, viewers without this module, and
   the player-safe docx export all key on a `revealed` CSS class in the page
   HTML, and know nothing about that flag. A GM reveals a secret to everyone
   and it still exports as unrevealed.
2. **Recap-sourced block secrets have no reveal path at all.** A secret
   written in a Session page's recap can be seen in the GM's tracker but
   never revealed to anyone.

## Current behaviour, as verified

Established by reading, not assumed:

- Foundry strips unrevealed secrets with the selector `.secret:not(.revealed)`
  and reads state via `classList.contains`. Native reveal state is therefore a
  **class inside the stored page HTML**, not a flag.
- Foundry exposes `HTMLSecretBlockElement#toggleRevealed(content)`: given the
  stored content string, it returns that string with the block's revealed
  state flipped. Core sheets apply it as
  `document.update({[key]: el.toggleRevealed(content)})`.
- **MEJ already renders those native controls.** `EnhancedJournalSheet.js:1122`
  does `element.querySelectorAll("secret-block").forEach(b => b.revealable = !disabled)`,
  so a GM on an MEJ sheet has a working native Reveal toggle today, sitting
  right beside the companion's weaker "Everyone".
- The companion already reads the native class in one place:
  `secret-blocks.mjs:39` sets `revealedAll` from `classesOf(block).includes("revealed")`.
- **The player-safe export already honours the class.**
  `doc-export-snapshot.mjs:142` calls
  `stripSecretSections(page.system?.recap ?? "", { includeAll: includeGM })`,
  and `secret-blocks.mjs:55` keeps any block carrying `revealed`. So export
  needs no change here — it starts working the moment a secret can carry the
  class.
- The recap gap is two hardcoded selectors, not a missing surface:
  `secrets-ui.mjs:48` and `:140` both pin `.editor-display[data-key="text.content"]`,
  while `session.hbs:15` renders the recap into `data-key="system.recap"`.
  The body-region convention already exists as `field-extractors.bodyText()`
  (`system.recap ?? text.content`), and `pruneOrphans` already uses it.

## Decisions taken

Both settled with the user before this document was written.

**"Everyone" writes the native class.** The companion's checkbox toggles the
same `revealed` class the native control does. Rejected alternatives: dropping
"Everyone" and deferring to the native toggle (splits the GM's workflow across
two controls for the commonest case, and makes the tracker unable to show or
set that state), and relabelling it "Everyone (this module only)" (cheap, but
leaves the divergence that is the actual complaint).

**Migrate once, and keep reading the legacy flag forever.** A dataVersion-3
migration converts existing `all: true` records; the reader also keeps
honouring a leftover `all: true` indefinitely. Rejected alternatives: no
migration (every already-revealed secret keeps exporting wrong until redone by
hand), and a button-triggered migration (safer, but leaves every world wrong
until someone notices a banner).

## Design

### 1. Division of responsibility

After this change there is exactly one home for each concept:

| Concept | Stored as | Owned by |
|---|---|---|
| Revealed to everyone | `revealed` class on the `<section>` in page HTML | Foundry |
| Revealed to specific users/groups | `flags.<module>.secretReveals.<sectionId>` | the companion |
| Legacy "everyone" | `…secretReveals.<sectionId>.all === true` | read-only compatibility |

`audience.all` stops being written. It is still *read*, permanently, as a
fallback meaning "everyone".

### 2. The write path

Two surfaces reveal a block secret, and they differ in what is on screen:

- `secrets-ui.editAudience` — the per-block button on a rendered sheet, where
  a `<secret-block>` element exists.
- `CampaignHubPage.onTrackerAudience` — the Hub's Secrets tab, which acts on
  rows whose page sheet may not be open at all, so no element exists.

Rather than branching on whether an element happens to be present, both use
one pure helper added to `logic/secret-blocks.mjs` — the module that already
owns parsing this exact shape:

```js
/** Add or remove Foundry's `revealed` class on one secret section. */
export function setSectionRevealed(html, sectionId, revealed) // -> string
```

Returns the input unchanged when the section id is absent or the body is
empty, so a caller can always write back what it gets.

**Guarding against drift from core.** A pure reimplementation of core
behaviour can silently diverge as Foundry changes. The e2e suite therefore
includes an equivalence check: for a representative set of bodies, assert
`setSectionRevealed(html, id, !current)` produces the same string as the live
`HTMLSecretBlockElement#toggleRevealed(html)`. If core changes its markup,
that test fails rather than the module quietly writing something Foundry no
longer recognises.

**Audience semantics.** In `promptAudience`'s result, `all: true` now means
"set the native class"; `all: false` means "remove it". On write:

1. Compute the new body with `setSectionRevealed`.
2. If it differs from the current body, `page.update({[bodyKey]: next})`,
   where `bodyKey` is the page's body region — `system.recap` or
   `text.content`, see §6.
3. Write the users/groups audience to the flag with `all` forced to `false`.

**Un-revealing a legacy record** falls out of this without a special case: the
section carries no class to remove (so the body write is skipped as a no-op),
and step 3 writes `all: false`, which clears the legacy flag. The secret stops
reading as "everyone" from both sources at once.

### 3. Concurrency

The body write is read-modify-write, so it re-reads the page's **current**
body at write time rather than reusing a render-time snapshot — the same
discipline `onSecretAudience` already applies to the session secrets array,
and for the same reason (a co-GM or another window may have edited in the
meantime). If the section id is no longer present in the current body, the
body write is skipped and only the flag is written.

The operation only ever adds or removes a class on one `<section>` open tag.
It never rewrites prose, and never touches a section other than the one named.

### 4. Reading

"Is this revealed to everyone?" becomes one helper, used by the tracker, the
sheet overlay, and the player path:

```js
revealedToEveryone = nativeRevealedClass || normalizeAudience(record).all
```

`extractSecretBlocks` already supplies the first half as `revealedAll`.

The player path (`injectPlayerSecrets`) needs no new logic for this: a section
carrying the native class is already left alone by its
`if (section.classList.contains("revealed")) continue;` branch, because
Foundry's own enrichment has already decided to show it.

### 5. Migration (dataVersion 2 → 3)

Runs in the existing ready-hook migration block in `campaign-companion.mjs`,
already gated on `game.user === game.users.activeGM`.

The decision of *what* to convert is a pure, unit-tested planner
(`logic/reveal-migration.mjs`), so the Foundry-touching half stays a thin loop:

```js
planNativeRevealMigration(entries) ->
  [{ entryUuid, pageUuid, bodyKey, sectionIds: [...] }]
```

For each planned page: apply `setSectionRevealed(body, id, true)` for each id,
write the body once, then clear those `all` flags. Sections that cannot be
located are omitted from the plan and their flags are left intact — the
reader's legacy fallback keeps them working, so a partial migration degrades
to today's behaviour rather than silently un-revealing anything.

The pass logs a count. It is idempotent: a second run plans nothing, because
converted records no longer carry `all: true`.

### 6. Recap secrets

Replace the two hardcoded `data-key="text.content"` selectors with the page's
actual body region, derived from the existing `bodyText()` convention. A small
pure helper keeps the key and the content together, since both selector and
enrichment need it:

```js
bodyRegion(page) -> { key: "system.recap" | "text.content", content: string }
```

Then:

- `injectGmOverlay` finds recap secrets, so audience buttons appear on them.
- `injectPlayerSecrets` re-enriches the right field into the right container.
- `CampaignHubPage`'s `canAudience` suppression for session-type block rows is
  removed — the control it was hiding now works.
- Export is already correct and is not touched.

## Error handling

- An unparseable or empty body: `setSectionRevealed` returns it unchanged; no
  write is issued. Never partially rewritten.
- A missing section id: same, and the audience flag is still written so
  per-user reveals keep working.
- A failed `page.update` (permissions, a locked compendium): logged and
  surfaced through the existing notification path; the flag write is not
  attempted, so the two halves cannot end up disagreeing in the failure case.
- Migration failures are per-page and non-fatal: a page that fails to update
  is logged, its flags are left intact (the reader's legacy fallback keeps it
  working), and the loop continues to the next page.
- `dataVersion` advances only if the pass runs to completion. Individual
  per-page failures do not block it — they are already covered by the legacy
  fallback, and retrying them every boot would repeat a write that is failing
  for a durable reason (permissions, a locked pack). An error that aborts the
  pass as a whole leaves `dataVersion` untouched, so that world retries on the
  next load.

## Testing

**Unit (pure, vitest):**

- `setSectionRevealed`: adds and removes the class; idempotent in both
  directions; leaves other classes and attributes on the section intact;
  leaves *other* sections untouched; handles single- and double-quoted
  attributes; returns input unchanged for a missing id, empty body, or
  non-string input.
- `bodyRegion`: session pages resolve to `system.recap`, others to
  `text.content`, matching `bodyText()`'s existing fallback exactly.
- `planNativeRevealMigration`: plans only records with `all: true`; omits ids
  absent from the body; groups by page; plans nothing on a second pass.

**E2E (live Foundry v14 world):**

- Reveal-to-everyone on a text page writes the native class, and the secret
  is still revealed after a reload with the companion's own re-enrichment out
  of the picture.
- The same secret exports as revealed in a player-safe docx export.
- A recap secret can be revealed from both the sheet overlay and the Hub
  tracker, and reaches the player.
- **Equivalence:** `setSectionRevealed` agrees with core's `toggleRevealed`.
- Migration: a seeded legacy `all: true` record converts on load, and a
  seeded record whose section is missing survives untouched and still reads as
  "everyone".

**Discipline carried from rounds 1 and 2:** every new e2e assertion guarding
this behaviour is vacuity-checked — disable the fix, confirm the test fails,
restore — before it is accepted. Assertions state what the user can do, not
merely that an element exists.

## Out of scope

- **C16** (the dashboard's unreachable query validation) — different
  subsystem, recorded in the parent sweep spec.
- **The client-side-only confidentiality model.** Secret text still reaches
  every client that can see the page; this change makes reveal *state*
  consistent, not the data private. Already documented in `README.md:39` and
  `docs/gm-guide.md:157`, and unchanged by this work.
- Any change to per-user/group audience semantics, which are working as
  designed.
