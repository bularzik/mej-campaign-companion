// Foundry glue for the per-campaign party notebook (spec 2026-10-10 §2).
// GM-only writers self-check isGM (same convention as campaign-store.mjs).
import { MODULE_ID, I18N, PARTY_NOTEBOOK_FLAG, PARTY_ROWS_FLAG, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { campaignOf, isPartyNotebook } from "../logic/campaigns.mjs";
import { normalizeRows } from "../logic/party-rows.mjs";
import { partyWriters, partyReaders, notebookOwnership, ownershipUpdate } from "../logic/party-access.mjs";
import { getCampaigns } from "./campaign-store.mjs";

/** Direct child of the campaign folder carrying the notebook flag. */
export function partyNotebookOf(campaign) {
  return (campaign?.contents ?? []).find((e) => isPartyNotebook(e)) ?? null;
}

function desiredOwnership(campaign, current) {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return notebookOwnership(current ?? {}, {
    defaultLevel: partyReaders(campaign, L),
    writerIds: partyWriters(campaign, game.users.contents, game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
    ownerLevel: L.OWNER,
    gmIds: game.users.filter((u) => u.isGM).map((u) => u.id)
  });
}

/** GM-only. The campaign's notebook, created when missing. */
export async function ensurePartyNotebook(campaign) {
  if (!game.user.isGM || !campaign) return null;
  const existing = partyNotebookOf(campaign);
  if (existing) return existing;
  // Overlapping triggers share one creation (else both see no notebook and both create).
  const pending = creating.get(campaign.id);
  if (pending) return pending;
  const p = createNotebook(campaign).finally(() => creating.delete(campaign.id));
  creating.set(campaign.id, p);
  return p;
}

const creating = new Map();

function createNotebook(campaign) {
  return JournalEntry.create({
    name: game.i18n.format(`${I18N}.party.notebookName`, { campaign: campaign.name }),
    folder: campaign.id,
    ownership: desiredOwnership(campaign, {}) ?? { default: 0 },
    flags: { [MODULE_ID]: { [PARTY_NOTEBOOK_FLAG]: true, [PARTY_ROWS_FLAG]: {} } }
  });
}

/** GM-only. Bring the notebook's ownership in line with the seam (Review Focus 5). */
export async function syncNotebookOwnership(campaign) {
  if (!game.user.isGM) return;
  const nb = partyNotebookOf(campaign);
  if (!nb) return;
  const update = ownershipUpdate(nb.ownership, desiredOwnership(campaign, nb.ownership));
  if (update) await nb.update(update);
}

/** Every notebook this user can read, with parsed rows. */
export function readableNotebooks(user = game.user) {
  return game.journal.contents
    .filter((e) => isPartyNotebook(e) && (user.isGM || e.testUserPermission(user, "OBSERVER")))
    .map((e) => ({ uuid: e.uuid, campaignName: campaignOf(e)?.name ?? "", rows: normalizeRows(e.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]) }));
}

/** The notebook a row added from `entry` goes into; null when none (or not in a campaign). */
export function writeNotebookFor(entry) {
  const campaign = campaignOf(entry);
  return campaign ? partyNotebookOf(campaign) : null;
}

/** Campaigns that need a notebook: any with at least one writer. */
export function campaignsNeedingNotebooks() {
  const groups = game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING);
  return getCampaigns().filter((c) => partyWriters(c, game.users.contents, groups).length > 0);
}
