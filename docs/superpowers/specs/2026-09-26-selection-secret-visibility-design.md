# Selection linking inside visible secrets, and Link to Entity follow-ups — design

Date: 2026-09-26. Status: approved in chat (approach A: the GM computes the
requester's visible secret set), for `writing-plans`. Ships on
`feat/link-to-entity` in release 0.23.0.

Covers the follow-up parked since 0.21.0 ("contributor selections inside
secrets revealed to them don't link") and the five deferred minors from the
Link to Entity review. Specs it amends: `2026-09-22-entity-from-selection-design.md`
(relay masking) and `2026-09-26-link-to-entity-design.md`.

## 1. Problem

For a relayed request from a contributor who does not own the page, the GM
calls `linkSelectionInSource(..., { maskSecrets: true })`, which masks
**every** `<section class="secret">`. What that contributor's client actually
renders is not "no secrets":

- Foundry keeps secret sections carrying its own `revealed` class
  (`TextEditor.enrichHTML`, 14.368 `client/applications/ux/text-editor.mjs:133`
  removes only `section.secret:not(.revealed)`). The companion's "Everyone"
  reveal writes that class.
- The companion injects secret sections revealed to the user directly or
  through one of their player groups (`hooks/secrets-ui.mjs`
  `injectPlayerSecrets`: page flag `flags.mej-campaign-companion.secretReveals`,
  a map of section id → audience, filtered with `canSee(audience, userId,
  groups)`).

The requester's `captureSelection` counts occurrences in what it sees, so its
`total` includes text in those sections; the GM's masked count does not. The
counts disagree and nothing is linked ("created, but the selected text could
not be linked automatically" for Create; "the page text changed" for Link).
This hits any selection on such a page whose text also occurs inside a secret
the contributor can see — not only selections made inside one.

## 2. Fix (approach A)

The GM computes exactly which secret sections the requester can see and masks
only the rest. Nothing about visibility is taken from the payload.

### 2.1 Pure helper (`logic/reveal-state.mjs`)

`visibleSecretIds(reveals, userId, groups)` → `Set<string>` of section ids
whose audience (`reveals[id]`) passes `canSee(audience, userId, groups)`.
Non-object `reveals` → empty set.

### 2.2 Linker (`logic/entity-from-selection.mjs`)

`linkSelectionInSource(sourceHtml, sel, { maskSecrets = false, visibleSecretIds = null } = {})`:

- With `maskSecrets` false: unchanged (everything counts).
- With `maskSecrets` true: a `<section>` whose class list contains `secret`
  is **visible** when its class list also contains `revealed`, or its `id`
  attribute is in `visibleSecretIds` (a `Set`; `null` = none). Text is masked
  when **any** enclosing secret section is not visible — so a hidden secret
  nested in a visible one is masked, and anything inside a hidden secret is
  masked whatever its own state, matching both Foundry's removal and
  `injectPlayerSecrets`' removal.
- Class and id matching are exact-token / exact-string (existing
  `CLASS_ATTR_RE` for class; an equivalent attribute regex for `id`).

### 2.3 Relay (`hooks/entity-from-selection-relay.mjs`)

`handleEntityRequest`, for a sender who is not an OWNER of the page (as
today), passes `maskSecrets: true` and
`visibleSecretIds: [...visibleSecretIds(page flag reveals, sender.id, env.groups)]`
to the writer (an array over the socket-free internal call is fine; the
writers convert to a `Set`). Both `run` (create) and `runLink` (link) receive
it; both writers forward it to `linkSelectionInSource`. The page flag is read
on the GM from the live page (`page.getFlag(MODULE_ID, "secretReveals")`),
never from the payload; the relay strips any `visibleSecretIds` or
`maskSecrets` a client sends (FIELDS does not include them — already true for
`maskSecrets`).

Owners and GMs: unchanged (no masking). GM notes: still unreachable over the
relay.

## 3. Deferred minors folded in

1. **Candidate cost.** `linkCandidates(page, region, { nameKey } = {})`:
   when `nameKey` is given, entries whose `normalizeEntityName(entry.name)`
   differs are dropped **before** any viewer/permission computation.
   `matchesForField` passes the selection's key. Auto-link calls without it
   (unchanged). And `eligibilityFromCapture` computes matches at most once per
   stashed capture (memoised on the capture record), shared by both menu
   callbacks and the click.
2. **Toast without a type.** When the entity's type label is empty, the
   success toast uses `linkedNoType`: `Linked the selection to "{name}".`
3. **Spec 24 names.** Every test gets its own run-unique names (a per-test
   suffix), so a leftover from one test can never make another test's
   selection match an existing entity.
4. **Spec 28 coverage.** New tests: picker Cancel/Escape writes nothing; a
   contributor with two matches chooses in the picker and the chosen entity is
   linked through the relay.
5. **03-search flake.** Reproduce with `--repeat-each` and a trace. Harden the
   Hub-opening helper in `03-search.spec.mjs` to wait for the shell to finish
   rendering (the Hub nav button visible and the shell's subsheet present)
   before clicking. If it does not reproduce, apply the wait anyway and record
   the flake as unconfirmed.

## 4. Testing

- **Unit (vitest):**
  - `visibleSecretIds`: direct user, group member (live group list), `all`
    legacy record, unrevealed/empty audience, non-object input.
  - `linkSelectionInSource` viewer-aware masking: `revealed` class visible;
    id in `visibleSecretIds` visible; other secret masked; hidden secret
    nested in a visible one masked; visible secret nested in a hidden one
    masked; `maskSecrets` without `visibleSecretIds` still masks unrevealed
    and now counts `revealed` sections.
  - Relay: a non-owner sender gets `visibleSecretIds` computed from the page
    flag and the sender id (not the payload); an owner gets no masking; a
    payload-supplied `visibleSecretIds` is ignored.
  - Writers forward `visibleSecretIds`.
  - `linkCandidates` name prefilter is covered through `matchesForField` only
    in e2e (Foundry-bound).
- **E2E (World A and World B), spec 28 additions:**
  - Contributor Create: the page has the name once in plain text and once
    inside a secret revealed to that contributor (companion reveal); selecting
    the plain-text occurrence links it (before the fix: created but not
    linked).
  - Contributor Link inside a secret revealed to Everyone (`revealed` class):
    the occurrence inside the secret is linked.
  - Contributor selection when the same text also occurs inside a secret they
    cannot see: links the selected occurrence and leaves the hidden secret
    untouched.
  - Picker Cancel/Escape; contributor picker (§3.4).
- Spec 24 rerun on both worlds; full suites on both worlds at the end.

## 5. Docs and release

- `CHANGELOG.md` 0.23.0 gains **Fixed:** "A campaign contributor's Create or
  Link from a selection now links correctly on pages with secrets revealed to
  them (or to everyone); it used to report that the selection could not be
  linked."
- Player guide: drop any wording that implies selections in revealed secrets
  are unsupported (check; add nothing if none exists).

## 6. Out of scope

- Selections that span a secret's boundary (already refused: one text node).
- Session pages' GM notes (never relayable).
- Changing how secrets render.
