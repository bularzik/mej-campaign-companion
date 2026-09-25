# Person ↔ Actor link — design

Date: 2026-09-25
Status: approved in chat, pending written-spec review

## Goal

A GM (or any user who can edit the page) can optionally link an MEJ Person
page to a world Actor. While linked, the Person's image follows the actor's
image. When the link is made and the Person's description is empty, the
actor's biography is copied into it once.

Second deliverable in the same release: bring `README.md` up to date.

## What MEJ already does (built on, never patched)

- MEJ stores the link in `flags["monks-enhanced-journal"].actor` as
  `{ id, uuid, img, name, quantity, type[, pack] }`
  (`EnhancedJournalSheet.getItemData`, set by `addActor` on an Actor drop).
- On drop, MEJ copies the actor's name and image **only if the page has
  none**, one time.
- When linked, MEJ's detailed header renders `.actor-img-container` (actor
  thumbnail + name) with a context menu: Delete link (GM), Open actor sheet
  (GM), Show image. MEJ resolves the actor via `game.actors` by `actorLink.id`
  — world actors only.
- There is no link control on an unlinked Person; drag-and-drop is the only
  route.

Per the standing rule, the companion adds behavior around this flag with
hooks and DOM injection only; no MEJ function is wrapped or patched.

## Decisions (from the brainstorm)

| # | Question | Decision |
|---|----------|----------|
| 1 | What "adopt the image" means | **Live sync**: linking overwrites the Person's image (including a custom one); later actor image changes propagate; unlink keeps the last image. |
| 2 | Description pull | **Once, at link time, full biography**, only when the Person's description is empty; never synced afterward. |
| 3 | Link UI | **Visible Link Actor control + picker**; Change/Unlink when linked; MEJ drag-drop keeps working and goes through the same sync. |
| 4 | Pre-existing links | **Sync on new activity only**: no startup sweep; an existing link starts following on its actor's next image change or on re-link. |
| — | Approach | **A — flag-driven, stored `src`** (not wrapping MEJ's `addActor`; not a render-time override). |

## Architecture

Three units, one pure and two Foundry-bound.

### 1. `scripts/logic/actor-link.mjs` (pure, unit-tested)

- `ACTOR_BIO_PATHS` — ordered list of property paths tried for the actor
  biography:
  1. `system.details.biography.value` (dnd5e)
  2. `system.details.biography` (string form, several systems)
  3. `system.biography`
  4. `system.details.publicNotes` (pf2e)
  5. `system.description.value`
  6. `system.description`
- `actorBiography(actor)` — first path whose value is a string that is not
  empty-HTML; returns that raw HTML string, else `null`. Never touches
  `biography.public` (decision 2: full biography).
- `isEmptyHtml(html)` — true for `null`/`undefined`/non-string, or when the
  string has no text content once tags are stripped, entities such as
  `&nbsp;` decoded and whitespace collapsed. An `<img>` counts as content
  (not empty).
- `linkedActorId(page)` — reads `flags["monks-enhanced-journal"].actor`
  and returns its `id`, or `null`. A flag with only a `uuid` of the form
  `Actor.<id>` yields that id; a compendium uuid (with `pack`) yields `null`.
- `linkChanged(changes)` — true when the update diff touches
  `flags.monks-enhanced-journal.actor` (set, replaced, or `-=actor`
  removed), in either nested or dotted form.
- `linkSyncUpdate(page, actor)` — builds the page update for a new or
  changed link: always `{ src: actor.img }` when it differs from
  `page.src`; plus `{ "text.content": bio }` when `isEmptyHtml(page.text.content)`
  and `actorBiography(actor)` is non-null. Returns `null` when nothing
  would change.
- `pagesLinkedTo(actorId, pages)` — filters an iterable of pages to Person
  pages (MEJ type `person`) whose `linkedActorId` equals `actorId`.

### 2. `scripts/hooks/actor-link.mjs` (sync hooks)

- **Link sync** — `Hooks.on("updateJournalEntryPage", (page, changes, options, userId))`:
  runs only when `userId === game.user.id` (the client that made the change
  already has permission to update the page), the page is a Person, and
  `linkChanged(changes)` holds and the flag is now set. Resolves the actor
  from `game.actors.get(id)`; if missing, stops. Applies
  `linkSyncUpdate(page, actor)` if non-null. This one path covers MEJ's
  drag-drop (`addActor` → `setFlag`) and the companion picker (which also
  just sets the flag).
- **Image follow** — `Hooks.on("updateActor", (actor, changes))`: runs only
  on `game.user === game.users.activeGM` and only when `"img" in changes`.
  Collects `pagesLinkedTo(actor.id, allJournalPages)` and updates each one
  whose `src !== actor.img` to `{ src: actor.img }`. Pages are updated
  per-entry via `JournalEntry#updateEmbeddedDocuments`, one call per entry.
- Failures log to the console with the module prefix and never throw into
  the triggering update (same observer rule as auto-link).
- Unlink needs no sync: the Person keeps its image and description.

### 3. `scripts/hooks/actor-link-ui.mjs` + `scripts/apps/actor-picker-dialog.mjs`

- Injected on `renderJournalPageSheet` and `renderEnhancedJournalSheet`
  (the two hooks `knowledge-ui.mjs` uses), idempotently, into the Person
  sheet's detailed header, only when the page is a Person and
  `sheet.isEditable`.
- **Unlinked**: a `Link Actor` button (`fa-solid fa-user-plus`) → picker.
- **Linked**: two icon buttons next to MEJ's `.actor-img-container` —
  **Change** (`fa-solid fa-user-pen`, opens the picker) and **Unlink**
  (`fa-solid fa-link-slash`, confirm dialog, then `unsetFlag("monks-enhanced-journal", "actor")`).
  If the linked actor is not visible to the user (MEJ hides the container),
  the controls still render so the link can be changed or removed.
- **Picker** (`DialogV2`): a filter text box and a scrollable list of world
  actors where `actor.testUserPermission(game.user, "OBSERVER")`, each row
  showing thumbnail and name, sorted by name. Choosing a row writes the flag
  in MEJ's exact shape: `{ id, uuid, img, name, quantity: "1", type }`, with
  `type` read from the actor's own `flags["monks-enhanced-journal"]?.type`,
  exactly as `getItemData` does. The write triggers link sync above.
- Strings live in `lang/en.json` under `MEJCampaignCompanion.actorLink.*`.

## Behavior table

| Event | Result |
|-------|--------|
| Link (picker or MEJ drop), Person description empty | `src` ← actor image; description ← actor biography (if any) |
| Link, description non-empty | `src` ← actor image; description untouched |
| Change to a different actor | Same as link, using the new actor (description only if still empty) |
| Actor image changes (a GM is online) | Every linked Person's `src` ← new image |
| Actor image changes (no GM online) | Nothing now; catches up on the actor's next image change or on re-link |
| Actor biography changes | Nothing (decision 2) |
| Unlink | Flag removed; image and description kept |
| Linked actor deleted | Flag left in place; image kept; MEJ hides the thumbnail; Change/Unlink still offered |
| Pre-existing link, on upgrade | Nothing until the actor's next image change or a re-link (decision 4) |
| Compendium actor (flag with `pack`) | Not offered by the picker; ignored by sync |
| Shop/loot pages with an `actor` flag | Ignored (Person only) |

## Security and permissions

- Link, change and unlink require edit rights on the Person page (the UI
  only renders for `sheet.isEditable`; Foundry enforces the update).
- The picker lists only actors the user can at least observe, so a player
  cannot link (and thereby copy the biography of) an actor they cannot see.
- The biography is copied **in full** (decision 2). The GM guide notes that
  a full biography can contain GM-only text and that a Person visible to
  players will then show it; the GM can clear it after linking.
- The image-follow write happens only on the active GM's client, so there is
  no socket relay and no new trust surface.

## Testing

- **Unit (vitest)**: `actorBiography` path order and non-string skipping,
  `isEmptyHtml` cases (`""`, `<p></p>`, `<p>&nbsp;</p>`, whitespace, `<img>`,
  text), `linkedActorId` (id, uuid-only, pack → null, absent),
  `linkChanged` (nested, dotted, `-=actor`, unrelated), `linkSyncUpdate`
  (no-op, src only, src + text), `pagesLinkedTo` (type filter, id match).
- **E2E (Playwright, World A, `TT-` prefix only)**: new spec
  `tests/e2e/25-person-actor-link.spec.mjs`:
  1. Link via the picker with an empty description → `src` and text set.
  2. Link with a non-empty description → text untouched, `src` set.
  3. Link via MEJ's own flag path (`setFlag` as MEJ does) → same sync.
  4. Change the actor's image → linked Person follows.
  5. Unlink → flag gone, image and text kept.
  6. A player who can't observe an actor doesn't see it in the picker.
  All created actors and pages are `TT-` named and deleted in `finally`.
- **Foundry 13 (World B)**: the same spec runs under the v13 project.
- **Guide screenshot**: one new shot of the picker in
  `guide-screenshots.spec.mjs`, with try/finally cleanup.

## README update (second deliverable)

`README.md` is organized by release ("Knowledge layer (0.2.0)", "Secrets
layer (0.3.0)", …) and stops around 0.5. Rework:

- Reorganize **Features** by area instead of by version: Sessions,
  Campaigns, Campaign Hub, Timeline, Search & dashboards, Knowledge
  (tags/attributes/backlinks/graph/knowledge bar), Secrets, Auto-link,
  Auto-capture, Docx import/export, Player collaboration & contributors,
  Create Entity from Selection, Person ↔ Actor link.
- Add what is missing, checked against `CHANGELOG.md` (0.6.0 → this
  release): campaign creation/guard, shared recap, knowledge bar, default
  images, auto-link unification and toast feedback, Create Entity from
  Selection, campaign Contributors, this feature.
- Regenerate the **Settings** table from the `game.settings.register` calls
  in `scripts/campaign-companion.mjs` (currently 17 registrations, the
  table lists 9).
- Update **Development** counts (spec files / tests) from the live suites,
  and **Requirements** against `module.json`.
- Keep trust-model and caveat paragraphs that are still accurate; delete or
  correct any that the CHANGELOG shows are superseded.
- Keep the README a technical reference that points to the GM and Player
  guides; user walkthroughs stay in the guides.

The GM guide gains a short "Linking a Person to an actor" section with the
picker screenshot and the full-biography note.

## Out of scope

- Syncing the biography after link time.
- Linking compendium actors.
- Shop/loot actor links.
- A startup sweep of pre-existing links.
- Syncing the Person's name to the actor.

## Release

Minor version bump (0.22.0), CHANGELOG entry, guides and README updated,
normal PR → merge → annotated tag → GitHub release flow.
