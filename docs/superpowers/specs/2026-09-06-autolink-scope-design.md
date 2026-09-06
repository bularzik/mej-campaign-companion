# Auto-link scope fixes (0.19.1) — design

**Date:** 2026-09-06 · **Base:** main @ f5bfd43 (0.19.0) · **Release:** 0.19.1 (patch)

## Background

Two auto-link defects, both reproduced on Foundry 14.367 / World A with 0.19.0
(probe `~/.claude/jobs/4378f1d9/tmp/repro-autolink.mjs`):

1. **The campaign's own name gets linked.** Creating a campaign "Zzq Probe
   Campaign" immediately rewrote an unfiled Person page to
   `@UUID[JournalEntry.<portal>]{Zzq Probe Campaign}`. A docx import that
   creates a "Radiant Citadel" campaign links every "Radiant Citadel" in
   every section to the portal. Those links are noise: the portal is the
   campaign's dashboard, not an entity the prose is about.
   - `hooks/retro-link.mjs`: the portal entry carries MEJ `type = "campaign"`,
     so `isMejCandidate` stamps it `retroLinkPending`; the
     `createJournalEntry` handler enqueues it; `planForBurst` lists it as a
     link *source* (it excludes portals/timelines only as *targets*). Every
     campaign creation — sidebar, Hub, adopt, import, stray upgrade — runs a
     full world walk linking the campaign name into every in-scope page.
   - `apps/import-wizard.mjs#linkCandidates` filters on `mejType` + campaign
     scope only, and `createCampaign` runs before the link pass, so the fresh
     portal is a candidate for every imported section.
   - `hooks/auto-link.mjs` (typing path) already excludes both. Three
     paths, one filter written once.

2. **A new Person is not linked into an existing recap.** Imported sessions
   get the campaign's ownership baseline (`observer` by default →
   player-visible). A Person created through MEJ's New Entry dialog gets
   Foundry's default ownership (players: NONE). The companion applies the
   baseline only on its *own* creation paths (Hub session, import,
   auto-capture). Audience containment (spec 2026-09-05 Part 1: a mention
   in page P links to entity E only if every non-GM viewer of P can view E)
   therefore refuses the recap, and the pass reports nothing — the GM sees
   "Eldin" unlinked and no explanation. The same probe: recap 0 links, GM
   notes 1 link; after setting Eldin to Observer and re-running the pass,
   recap 2 links.

## Decisions (user, 2026-09-06)

- Portal and timeline journals are never link sources or candidates on any path.
- New entries created inside a campaign **inherit the campaign's ownership
  baseline** (not: relax containment; not: keep GM-only + offer a reveal
  button).
- A retro pass that finds mentions blocked *only* by audience says so.
- Existing portal links already written into pages are left alone.

## §1 One linkable-entity predicate

`scripts/logic/campaigns.mjs` gains:

```js
/** An entry auto-link may link TO or scan FOR: MEJ-typed, and neither a campaign portal nor a timeline journal. */
export function isLinkableEntity(entry, mejTypeOf) {
  return !!mejTypeOf(entry) && !isTimelineJournal(entry) && !isCampaignPortal(entry);
}
```

`mejTypeOf` is injected (campaigns.mjs is pure; `mejType` lives in
`integrations/mej-adapter.mjs`). Callers pass `mejType` from the adapter.

Consumers, each replacing its inline expression:

| Path | Site | Today | After |
|---|---|---|---|
| typing | `hooks/auto-link.mjs` `buildCandidates` | `mejType(e) && !isTimelineJournal(e) && !isCampaignPortal(e)` | `isLinkableEntity(e, mejType)` |
| retro stamp | `hooks/retro-link.mjs` `isMejCandidate` | MEJ type or raw MEJ flag | same **and** `!isTimelineJournal(entry) && !isCampaignPortal(entry)` (at preCreate the constructed document already has its pages and flags, so both predicates work on it) |
| retro source | `hooks/retro-link.mjs` `planForBurst` | every queued entry | `entries.filter((e) => isLinkableEntity(e, mejType))` — belt-and-braces for entries stamped by 0.19.0 that a login sweep still finds pending |
| retro twins | `hooks/retro-link.mjs` `planForBurst` `byName` | inline triple | `isLinkableEntity(e, mejType)` |
| import | `apps/import-wizard.mjs` `#linkCandidates` | `mejType(e) && sameLinkScope(...)` | `isLinkableEntity(e, mejType) && sameLinkScope(...)` |

`retroLinkPending` flags already sitting on portals/timelines in existing
worlds are cleared by the sweep as today (`processBurst` clears before
planning); the filtered entity list then plans nothing for them. No
migration.

## §2 Campaign members inherit the baseline

New pure planner `scripts/logic/campaign-ownership.mjs`:

```js
/**
 * Ownership record a new entry filed in a campaign should be created with,
 * or null to leave the creation data alone.
 * @param {object} data           raw creation data (preCreateJournalEntry's 2nd arg)
 * @param {number|null} baseline  campaign baseline level, null when the target folder is not in a campaign
 * @param {{isGM:boolean}} opts
 */
export function inheritedOwnership(data, baseline, { isGM }) {
  if (!isGM) return null;
  if (baseline === null || baseline === undefined) return null;
  if (data?.ownership !== undefined && data?.ownership !== null) return null;
  return { default: baseline };
}
```

New hook `scripts/hooks/campaign-ownership.mjs`, `registerCampaignOwnership()`:

```js
Hooks.on("preCreateJournalEntry", (entry, data) => {
  try {
    const folder = entry.folder ?? game.folders.get(data.folder?.id ?? data.folder) ?? null;
    const campaign = campaignOfFolder(folder);
    const ownership = inheritedOwnership(data, campaign ? baselineOwnership(campaign) : null, { isGM: game.user.isGM });
    if (ownership) entry.updateSource({ ownership });
  } catch (err) { console.error(`${MODULE_ID} | campaign ownership inherit failed`, err); }
});
```

Rules:

- **Explicit wins.** Any `ownership` key in the creation data — the Hub's
  session path, `createMejEntry` with an ownership argument, the portal and
  timeline creators, MEJ's "Extract" (which copies the source entry's
  ownership via `toObject()`), a macro — is never overridden.
- **Container rule, not a type rule.** Applies to every JournalEntry filed
  in a campaign folder or any of its subfolders (`campaignOfFolder` walks
  up), MEJ-typed or plain text — the Hub already lists untyped members.
- **GM seat only**, like the `playersWriteSessions` hook: a player creating
  in a campaign folder keeps Foundry's defaults.
- **Order with the session hook.** `playersWriteSessions` sets OWNER on
  session entries; both hooks run and the higher level wins regardless of
  order because the session hook writes only when the setting is on and
  OWNER ≥ every baseline. Registered as its own step in `registerCore()`
  (`integrations/mej-adapter.mjs`, next to the `retro-link` step) so api
  and native mode both get it.
- **Import wizard "GM only" audience** currently passes `ownership: null`
  and lets Foundry default the entry. Under inheritance that would silently
  become the baseline. `#onCreate` now maps `"gm"` to
  `{ default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }` explicitly. The
  `"default"`-with-no-campaign case cannot occur (the wizard always
  resolves or creates a campaign).
- Not covered, deliberately: an entry *moved* into a campaign later. The
  Hub's ownership row ("apply baseline to all members") already handles it.

## §3 "Hidden from this page's readers" feedback

`logic/retro-link.mjs` `buildRetroPlanBatch` gains a third per-row bucket.
For each page, entities that pass the own-page and scope checks but fail
`audienceContains(page.viewerIds, e.viewerIds)` are planned alone against
the original content (exactly how `ambiguous` is computed) and, when they
would have matched, reported as
`hidden: {entityUuid, entityName, count}[]`. Rows with only `hidden`
matches are emitted with `newHtml: null`, like ambiguous-only rows.

`hooks/retro-link.mjs`:

- `notifyRetroResult`: after the existing `ambiguousOnly` branch, a new
  branch — nothing applied, nothing failed, no writable rows, at least one
  hidden match — `ui.notifications.warn(retroLink.hiddenOnly)` with the
  first hidden entity's name and the count of pages, and the per-page
  detail under `hidden` in the console object (always included in
  `detail` alongside `linked`/`ambiguous`).
- Confirm dialog: a `hiddenList` under the ambiguous list, same markup,
  heading `retroLink.hidden`.

`lang/en.json` additions:

```json
"hidden": "Mentioned in pages their readers cannot see this entry from (reveal the entry to link it):",
"hiddenOnly": "\"{name}\" is mentioned in {count} page(s) whose readers cannot see it. Reveal \"{name}\" (or apply the campaign baseline) to link it."
```

Typing path stays silent — it has no report channel (unchanged from spec
2026-09-05).

## Versioning, docs

- `module.json` 0.19.1; CHANGELOG entry under 0.19.1 — Fixed: campaign
  portal/timeline linked as entities; Changed: entries created in a
  campaign inherit its ownership baseline; Added: hidden-mention warning.
- `docs/gm-guide.md` Campaigns section: one paragraph — new entries in a
  campaign start at the campaign's baseline (hide with the eye toggle);
  Auto-link section: the hidden-mention warning and what to do.
- Release: annotated tag `0.19.1`, zip via the existing `git archive` list
  (no new paths).

## Testing

Unit (vitest):

- `test/campaigns.test.js`: `isLinkableEntity` — typed entry true; portal
  false; timeline false; untyped false.
- `test/campaign-ownership.test.js`: `inheritedOwnership` — null when not
  GM, when no campaign, when `ownership` present (object or `{}`); baseline
  record otherwise; `ownership: null` in data counts as absent.
- `test/retro-link.test.js`: hidden bucket — an entity failing containment
  that matches is reported under `hidden` and not written; a row with only
  hidden matches has `newHtml: null`; an entity that fails containment and
  does not match is not reported.

E2E (v14, World A, GM seat, silent retro mode, id-tracked cleanup):

- `tests/e2e/11-auto-link-scope.spec.mjs` additions:
  1. an unfiled Person page names "TT-… Campaign"; create that campaign via
     the API → the page's `text.content` is unchanged 1.5 s later.
  2. `JournalEntry.create` a Person in a campaign folder with no ownership
     → `ownership.default` equals the campaign baseline (Observer), and a
     player-visible session recap in that campaign naming it gains the link.
  3. same with the Person created with explicit `ownership.default: NONE`
     → recap unchanged, GM notes linked, and the `hiddenOnly` warn toast
     text is shown.
- `tests/e2e/05-docx-import.spec.mjs`: the import result has no link whose
  label equals the campaign name.
- **Audit:** every existing e2e test that creates an entry inside a campaign
  folder without `ownership` and asserts GM-only behaviour must pass
  `ownership: { default: 0 }` explicitly (spec 11's containment cases are
  the expected ones).
- v13 (Foundry 13.351, stock MEJ 13.06, native mode): stock smoke 8/8
  (`FOUNDRY_TARGET=v13 STOCK_PHASE=stock`), plus spec 11's new case 2
  through MEJ's own New Entry dialog if the native subset supports it;
  otherwise the API form.

## Out of scope

- Unlinking portal links already written into existing pages.
- Baseline on move-into-campaign (Hub bulk apply covers it).
- Any change to the containment rule itself or to the typing path's silence.
