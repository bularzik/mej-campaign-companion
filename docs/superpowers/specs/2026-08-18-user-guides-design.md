# Campaign Companion User Guides — Design

**Date:** 2026-08-18
**Status:** Approved pending user review
**Scope:** Documentation only — no runtime code changes. One new gated Playwright spec for screenshot capture.

## Goal

Ship two complete, screenshot-illustrated user guides for Campaign Companion — one for GMs, one for players — authored in Markdown, living in `docs/`, and linked from the README. The existing README stays the technical/feature reference; the guides are task-oriented ("how do I run a session with this"), written for a reader who has never seen the module.

## Decisions (settled during brainstorming)

1. **Audience:** two full guides, each self-contained — a GM guide and a player guide. Not a GM guide with a player appendix.
2. **Screenshots:** captured programmatically via the existing Playwright harness against the live Foundry v14 World A, after seeding presentable demo content. No TT-prefixed fixture names in any shot.
3. **Mode split:** api mode is primary — all screenshots and walkthroughs depict api mode (Session sheet and Campaign Hub inside MEJ's tabbed shell). One early GM-guide section ("Running on stock MEJ") explains native mode and its four concrete differences (no Session in MEJ's New Entry dialog → use the Hub's New Session button; Session pages can't be MEJ relationship targets; Hub opens as its own window; no graph/prep-board header buttons — both reachable elsewhere). Native-mode users can follow every walkthrough with that section in hand.
4. **Structure:** Option A — two single-file guides (`docs/gm-guide.md`, `docs/player-guide.md`), images in `docs/images/`. No multi-page guide directory; no folding usage docs into the README.

## Deliverables

| Path | What |
|---|---|
| `docs/gm-guide.md` | Complete GM guide, 14 sections (outline below) |
| `docs/player-guide.md` | Complete player guide, 7 sections (outline below) |
| `docs/images/*.png` | ~15–20 screenshots, named by feature (`hub-index.png`, `session-sheet.png`, `secrets-tab.png`, …) |
| README edit | New **Documentation** section immediately after the intro paragraph, linking both guides. Also fixes the stale Installation paragraph that still claims the GitHub repo and manifest URLs "don't exist yet" — the manifest-install path has been live and verified since 0.1.0. Nothing else in the README moves. |
| `tests/e2e/guide-screenshots.spec.mjs` | Gated capture spec (see Screenshot pipeline) |

## GM guide outline

Task-ordered. Each numbered section is a top-level `##` heading.

1. **What Campaign Companion adds** — one-paragraph orientation plus a screenshot of the Hub; pointer to the player guide.
2. **Installation & first-time setup** — install both modules (manifest URL from the GitHub release, or manual), enable in Manage Modules, which settings to consider turning on day one.
3. **Running your first session** — create a Session entry (New Entry in api mode / Hub's New Session button), then a walkthrough of every Session-sheet field: session number, in-world campaign date, GM recap, per-player recaps, attendee tracking, the secret checklist, GM-only notes.
4. **The Campaign Hub** — opening it (shell tab; scene-controls notes group), the three panes: entry index (filter/sort, mention-count badges), timeline, search. What "campaign-relevant entry" means.
5. **The timeline & campaign dates** — timepoints, binding a timepoint to an in-world calendar date, the three ordering modes (manual drag, creation order, campaign date), attaching documents and images.
6. **Building your campaign record** — tags & per-row attributes (incl. `playerHidden`), the "Mentioned in" backlinks panel, the relationship graph (ego vs whole-campaign, backlink overlay, 200-node cap), Hub Dashboards with the query grammar (`type:` / `tag:` / `attr:` / free text), the `@CampaignQuery[...]` enricher.
7. **Auto-linking** — the `autoLink` world setting, what gets linked and what never does (existing links, code blocks), the per-page `noAutoLink` opt-out, retroactive auto-link (off/confirm/silent), ambiguity handling, and audience containment restated in plain GM terms: a mention only becomes a link when everyone who can read the page can also see the target.
8. **Auto-capture** — encounter capture on combat end; shared-media capture of Show-Players images/video; both opt-in, both file onto the newest timepoint.
9. **Secrets** — block-level secrets on secret sections, player groups, revealing from the Hub Secrets tab and from a Session's checklist, the "what does player X know" filter, the session prep board, reveal whispers, relationship-edge reveals with labels. Restates in user terms the README's trust-model warning (client-side filtering, not encryption) and the "Everyone"-vs-native-Reveal caveat, linking to the README for the full statements.
10. **Word import & export** — the docx import wizard step by step (section type suggestions, the Audience select, dated-header → timepoint detection, warnings), export with the Include GM Content toggle, round-trip notes pointer to the README.
11. **Player collaboration** — `playersWriteSessions`, what players can then do, the GM-relay path for players without upload permission, pointer to the README's trust-model detail.
12. **Running on stock MEJ (native mode)** — mode detection is automatic and silent; the four differences; moving a world between builds needs no migration.
13. **Settings reference** — the five visible settings with plain-language guidance on when to enable each; a note that four internal settings exist and shouldn't be hand-edited (pointer to README table).
14. **Troubleshooting** — the two startup error notifications and what each means; auto-link/auto-capture never block saves; docx import is all-or-nothing per run; where to file issues.

## Player guide outline

1. **What your GM's Campaign Companion means for you** — orientation, screenshot of a session page as a player sees it.
2. **Reading session pages & writing your recap** — finding sessions, reading the GM recap, writing your own per-player recap (both the direct-ownership path and "it just saves" via the GM relay — players don't need to know which they're on).
3. **Finding things** — Hub search from a player's seat, backlinks, dashboards; GM-only content simply doesn't appear in your results.
4. **The relationship graph** — what you can see (revealed edges and labels) vs what the GM sees; why the graph may look sparser for you.
5. **When secrets are revealed to you** — the whisper you receive, what changes on the page afterward.
6. **The campaign timeline** — reading it, what the dates mean.
7. **Quick answers** — "why can't I see X" (audience gating in player terms), "why didn't my name get linked", "can the GM read my recap" (yes).

## Screenshot pipeline

A new Playwright spec, `tests/e2e/guide-screenshots.spec.mjs`, following the stock-smoke precedent: **skipped unless `GUIDE_SHOTS=1`**, so it never runs in normal e2e sweeps or CI.

- **Seeding:** the spec seeds a small themed demo campaign with clean fantasy names (no TT- prefix): 3 Person entries with MEJ relationships, tags, and one `playerHidden` attribute; 1 Place; 1 Quest; 1 Session entry with GM recap, a player recap, attendees, a secret checklist, and one block-level secret; 1 player group; 3–4 timeline points (at least one calendar-dated); 1 saved dashboard query.
- **Cleanup & idempotency:** every seeded document carries a `flags["mej-campaign-companion"].guideDemo: true` flag. The spec sweeps all flag-carrying documents at start *and* end, so a crashed run leaves nothing behind and reruns are idempotent. World-setting entries it touches (`savedQueries`, `playerGroups`) are restored to their pre-run values in cleanup.
- **Capture:** GM-perspective shots from the GM client; player-perspective shots (revealed secret, recap editing, player-view graph) from the player client the harness already drives. Shots are written straight into `docs/images/` at a consistent viewport so reruns produce comparable images.
- **Shot list (~15–20):** hub index, hub timeline, hub search results, session sheet (GM), session sheet (player), session secret checklist, campaign-date picker, tags/attributes panel, backlinks panel, relationship graph (GM), relationship graph (player), dashboards tab + query, `@CampaignQuery` rendered inline, Secrets tab, prep board, reveal whisper (player chat), docx import wizard, docx export dialog, auto-link confirm dialog, settings panel. Trim or add during writing as sections demand.

## Cross-linking rules

The guides explain behavior in user terms and **link to** the README for deep technical material rather than duplicating it: the collaboration trust model, the secrets trust model and "Everyone" caveat, docx round-trip/date-parsing details, the authoritative settings table. Duplicated normative text drifts; one home each.

## Verification

- Every image referenced by either guide exists in `docs/images/`; no orphaned images.
- Every intra-document anchor and cross-document link resolves (checked mechanically, e.g. a one-off link-check pass).
- A fresh `GUIDE_SHOTS=1` run reproduces all shots and leaves World A clean (no `guideDemo`-flagged documents, world settings restored).
- Existing suites unaffected: unit 503/503; normal e2e run skips the new spec.

## Out of scope

- No translations (module is English-only by scope).
- No published-package installation instructions beyond what the release assets already support.
- No native-mode screenshot set (mode differences are covered in prose).
- No README restructuring beyond adding the Documentation section.
