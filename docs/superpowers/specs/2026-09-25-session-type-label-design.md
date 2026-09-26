# Session type label — design

Date: 2026-09-25
Status: approved in chat, pending written-spec review
Release: 0.22.1 (patch)

## Problem

On stock MEJ (native mode — both test worlds, Foundry 13 and 14), MEJ's
**New Entry** dialog lists the companion's Session page type in its
"Adventure Book" group as the raw key
`TYPES.JournalEntryPage.mej-campaign-companion.session` instead of
"Session".

Cause: MEJ builds that group from `CONFIG.JournalEntryPage.typeLabels`
(`monks-enhanced-journal.js`, `renderDialogV2` hook, ~line 5148), showing
`game.i18n.localize(v)` when `game.i18n.has(v)` and the raw value otherwise.
Foundry assigns every module page subtype the label key
`TYPES.JournalEntryPage.<module-id>.<subtype>` and expects the module's
language file to define it. The companion's `lang/en.json` defines no
`TYPES` entry, so both of its subtypes — `session` and `campaign` — have
unresolvable labels everywhere Foundry's type labels are read (MEJ's
dialog, Foundry's own create-page dialog, any other consumer). The campaign
guard keeps Campaign out of MEJ's dialog, but its label is still missing
elsewhere.

The companion's own dropdowns (import wizard, export dialog, Hub) already
label Session via `MEJCampaignCompanion.sheettype.session` and are not
affected.

## Decision

Approach 1 (approved): add the translations Foundry expects. No code change.

In `lang/en.json`, add a top-level entry:

```json
"TYPES": {
  "JournalEntryPage": {
    "mej-campaign-companion": {
      "session": "Session",
      "campaign": "Campaign"
    }
  }
}
```

Foundry's `Localization` runs `expandObject` on each translation file and
resolves labels with `getProperty(translations, stringId)`
(`client/helpers/localization.mjs`), so the nested shape resolves
`TYPES.JournalEntryPage.mej-campaign-companion.session` → "Session".

Rejected: rewriting the option text from a `renderDialogV2` hook — covers
one dialog only, depends on MEJ's markup, and treats the symptom.

## Guard: the option must actually work

Picking "Session" from MEJ's New Entry dialog is the flow the docs currently
steer users away from. Before the label is shipped, verify on both test
worlds that choosing it creates a working Session page (native subtype
`mej-campaign-companion.session`, opens the companion Session sheet). If it
does not, stop and report to the user rather than shipping a friendly label
on a broken option.

## Amendment (2026-09-25, after the guard tripped)

The guard failed on World B (stock MEJ 13.06): choosing the Adventure Book
"Session" option creates a page whose `_source.type` is
`mej-campaign-companion.session` but whose flags are empty, so MEJ opens it
with `JournalEntrySheet`. Setting `flags["monks-enhanced-journal"].type =
"session"` on that page makes it open as `SessionSheet` (verified live). The
companion's own creation paths already set that flag
(`logic/session-page-data.mjs`); MEJ's dialog does not. The user chose to
extend the fix (option "Also stamp the flag").

Probe findings that also shape the tests:
- World A (MEJ fork with the extension API) never lists the Adventure Book
  option: its type labels are nested under `mej-campaign-companion`, so MEJ's
  filter drops them, and Session appears only under "Single Sheet" (value
  `session`, already labelled "Session"). The creation guard applies where
  the Adventure Book option exists.
- Out of scope, reported: on World A, Foundry's core Create Page dialog
  shows the bare `mej-campaign-companion.session` because the fork nests
  `CONFIG.JournalEntryPage.typeLabels`; a translation cannot fix that.

Added behaviour: a `preCreateJournalEntryPage` hook (stock MEJ creates the
page with `createEmbeddedDocuments` after the entry, so this hook fires)
that, when the page's type is `mej-campaign-companion.session` and it has no
`flags["monks-enhanced-journal"].type`, sets that flag to `"session"` on the
page source before it is written. The decision is a pure function
(`sessionFlagPatch(data)` → the patch object or `null`), unit-tested; the
hook only applies it. It never overwrites an existing MEJ type flag and
ignores every other page type.

## Testing

- **Unit (vitest):** load `lang/en.json`, apply `expandObject`-equivalent
  expansion, and assert that the dotted lookups
  `TYPES.JournalEntryPage.mej-campaign-companion.session` and
  `…campaign` resolve to "Session" and "Campaign".
- **E2E (Playwright), World A (Foundry 14) and World B (Foundry 13):** as the
  GM, open MEJ's New Entry dialog; assert the page-type select has an option
  with value `mej-campaign-companion.session` whose text is "Session" and
  that no option text starts with `TYPES.` (the Session option may be the
  Adventure Book `mej-campaign-companion.session` or, with the extension
  API, the Single Sheet `session`); where the Adventure Book option exists,
  create a `TT-`-named entry with it and assert the page's type is
  `mej-campaign-companion.session`, its MEJ type flag is `session`, and the
  Session sheet renders; delete it in cleanup.
- **Unit:** `sessionFlagPatch` — session type without flag → patch; with an
  existing flag → null; other types → null; bare `session` type → patch.

## Docs and release

- Remove the "may show up there as an unlocalized
  `TYPES.JournalEntryPage.…` entry" caveat from `README.md` (native-mode
  section) and `docs/gm-guide.md` (native-mode section), stating instead
  that Session appears in MEJ's New Entry dialog in both modes (still
  pointing to the Hub's **New Session** button as an alternative) — wording
  adjusted to what the guard check actually found.
- `CHANGELOG.md`: `## 0.22.1 (2026-09-25)` with a **Fixed** line.
- `module.json`: version `0.22.1`.

## Out of scope

- Other locales (the module ships English only).
- Changing where Session appears in MEJ's dialog (Adventure Book vs Single
  Sheet group) — that is MEJ's layout.
