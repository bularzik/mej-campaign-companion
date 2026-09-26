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

## Testing

- **Unit (vitest):** load `lang/en.json`, apply `expandObject`-equivalent
  expansion, and assert that the dotted lookups
  `TYPES.JournalEntryPage.mej-campaign-companion.session` and
  `…campaign` resolve to "Session" and "Campaign".
- **E2E (Playwright), World A (Foundry 14) and World B (Foundry 13):** as the
  GM, open MEJ's New Entry dialog; assert the page-type select has an option
  with value `mej-campaign-companion.session` whose text is "Session" and
  that no option text starts with `TYPES.`; create a `TT-`-named entry with
  that option; assert the created page's type is
  `mej-campaign-companion.session` and the Session sheet renders; delete it
  in cleanup.

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
