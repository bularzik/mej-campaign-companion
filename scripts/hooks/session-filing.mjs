// Sessions always live in a campaign (spec 2026-10-16 §1). The active GM's
// client files every FOLDERLESS entry holding a Session page into the
// fallback campaign - "New Campaign", reused while a root campaign of that
// exact name exists - on create (§1b) and once per GM load for the sessions
// that already exist (§1f). Decisions are pure (logic/session-filing.mjs);
// this file reads Foundry state and writes through the store. Silent by
// design: no dialog, no warning (§1i).
import { MODULE_ID, I18N } from "../constants.mjs";
import { shouldFileSession, pickFallbackCampaign, filingUpdate, filingLevel } from "../logic/session-filing.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { getCampaigns, createCampaign, sessionTargetLevel } from "../data/campaign-store.mjs";

// One fallback resolution at a time: two sessions created in the same burst
// (an import, a double click) must share ONE "New Campaign", never race two
// Folder.create calls into a pile of them (spec anti-goal).
let fallbackChain = Promise.resolve();

/**
 * GM-only. The fallback campaign: the root campaign named exactly "New
 * Campaign" when one exists, else a new one (folder + portal + timeline via
 * createCampaign, observer baseline). Null for a non-GM or a failed create.
 */
export function ensureFallbackCampaign() {
  if (!game.user.isGM) return Promise.resolve(null);
  const run = fallbackChain.then(async () => {
    const name = game.i18n.localize(`${I18N}.campaign.fallbackName`);
    return pickFallbackCampaign(getCampaigns(), name) ?? await createCampaign(name, { ownershipDefault: "observer" });
  }).catch((err) => {
    console.error(`${MODULE_ID} | fallback campaign failed`, err);
    return null;
  });
  fallbackChain = run;
  return run;
}

// Per-entry in-flight filing: the entry create hook, the page create hook and
// the timepoint hook's own call all await the same move.
const inflight = new Map();

/**
 * Active-GM only. Resolve the campaign this entry ends up in. A folderless
 * session entry is filed into the fallback campaign - default ownership set
 * to that campaign's session-aware level unless the session is hidden now
 * (default NONE stays NONE), explicit per-user ownership left alone (§1b) -
 * and anything else stays where it is. Resolves to the entry's
 * campaign afterwards (null for a session the GM keeps in a plain folder, or
 * on any other client). hooks/session-timepoint.mjs awaits this before it
 * picks a timeline, so a filed session's timepoint lands on the fallback
 * campaign's timeline, never on a world one (§1d).
 */
export function ensureSessionFiled(entry) {
  if (!entry || game.user !== game.users.activeGM || !shouldFileSession(entry)) {
    return Promise.resolve(entry ? campaignOf(entry) : null);
  }
  if (inflight.has(entry.id)) return inflight.get(entry.id);
  const run = (async () => {
    const campaign = await ensureFallbackCampaign();
    if (!campaign) return null;
    // Re-check: a second arrival may find the move already landed.
    if (!shouldFileSession(entry)) return campaignOf(entry);
    const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    await entry.update(filingUpdate(campaign.id, filingLevel(entry.ownership?.default, sessionTargetLevel(entry, campaign), NONE)));
    return campaign;
  })().catch((err) => {
    console.error(`${MODULE_ID} | filing session ${entry.uuid} failed`, err);
    return null;
  }).finally(() => inflight.delete(entry.id));
  inflight.set(entry.id, run);
  return run;
}

/** Active-GM only, once per load (§1f): file every folderless session entry already in the world. Idempotent; a clean world does nothing. */
export async function sweepUnfiledSessions() {
  if (game.user !== game.users.activeGM) return 0;
  let filed = 0;
  for (const entry of game.journal.contents.filter((e) => shouldFileSession(e))) {
    if (await ensureSessionFiled(entry)) filed++;
  }
  if (filed) console.log(`${MODULE_ID} | filed ${filed} unfiled session(s) into the fallback campaign`);
  return filed;
}

function guard(task, what) {
  task.catch((err) => console.error(`${MODULE_ID} | session filing: ${what} failed`, err));
}

export function registerSessionFiling() {
  // Pages created with their entry fire only createJournalEntry; a page added
  // to an existing entry (MEJ's New Entry _onCreate patch) fires
  // createJournalEntryPage. Both route to the same idempotent filing.
  Hooks.on("createJournalEntry", (entry) => guard(ensureSessionFiled(entry), "create"));
  Hooks.on("createJournalEntryPage", (page) => guard(ensureSessionFiled(page?.parent), "create"));
}
