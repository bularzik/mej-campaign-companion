// Notes entry lifecycle (spec 2026-10-15 item 1), the party-notebook pattern:
// the GM writer seat creates one notes entry per campaign and keeps its
// ownership in step with the baseline and the user list. Every seat
// re-renders views that show a changed note's session or mentioned entries.
import { MODULE_ID, CAMPAIGN_FLAG, NOTES_FLAG } from "../constants.mjs";
import { isCampaignFolder, isNotesEntry, campaignOf } from "../logic/campaigns.mjs";
import { normalizeNotes } from "../logic/notes.mjs";
import { ensureNotesEntry, syncNotesOwnership } from "../data/notes-store.mjs";
import { getCampaigns } from "../data/campaign-store.mjs";
import { refreshViewsMatching } from "./view-refresh.mjs";

const isWriterSeat = () => game.user.isGM && game.user === game.users.activeGM;

async function reconcile(campaigns) {
  for (const c of campaigns) {
    try {
      await ensureNotesEntry(c);
      await syncNotesOwnership(c);
    } catch (err) {
      console.error(`${MODULE_ID} | notes entry sync failed for campaign ${c.id}`, err);
    }
  }
}

const reconcileAll = () => (isWriterSeat() ? reconcile(getCampaigns()) : Promise.resolve());

/** Views to refresh for a note change: the session it belongs to, every entry it mentions, and the Hub. */
export function refreshForNoteChange(entry, noteChanges) {
  const notes = normalizeNotes(entry.flags?.[MODULE_ID]?.[NOTES_FLAG]);
  const ids = noteChanges && typeof noteChanges === "object" ? Object.keys(noteChanges).map((k) => k.replace(/^-=/, "")) : null;
  const touched = ids ? notes.filter((n) => ids.includes(n.id)) : notes;
  const uuids = new Set();
  for (const n of touched) {
    if (n.sessionUuid) uuids.add(n.sessionUuid.split(".JournalEntryPage.")[0]);
    for (const m of n.mentions) uuids.add(m);
  }
  const campaignId = campaignOf(entry)?.id ?? null;
  refreshViewsMatching((uuid) => {
    if (!uuid || uuids.has(uuid)) return true; // the shell's synthetic hub page has no uuid: always refresh it
    try {
      const doc = fromUuidSync(uuid);
      return !!campaignId && campaignOf(doc)?.id === campaignId && (doc?.documentName === "JournalEntryPage" ? false : uuids.has(doc?.uuid));
    } catch {
      return false;
    }
  });
}

export function registerNotesEntry() {
  // registerCore() may run inside or after the "ready" dispatch; Hooks.once("ready") would never fire then.
  const readyPass = () => reconcileAll().catch((err) => console.error(`${MODULE_ID} | notes entry ready pass failed`, err));
  if (game.ready) readyPass();
  else Hooks.once("ready", readyPass);
  Hooks.on("createFolder", (folder) => {
    if (isWriterSeat() && isCampaignFolder(folder)) reconcile([folder]);
  });
  Hooks.on("updateFolder", (folder, changes) => {
    if (!isWriterSeat() || !isCampaignFolder(folder)) return;
    if (changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] === undefined) return;
    reconcile([folder]);
  });
  Hooks.on("createUser", () => reconcileAll());
  Hooks.on("deleteUser", () => reconcileAll());
  Hooks.on("updateUser", (user, changes) => {
    if (changes?.role !== undefined) reconcileAll();
  });
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!isNotesEntry(entry)) return;
    try {
      const noteChanges = changes?.flags?.[MODULE_ID]?.[NOTES_FLAG];
      if (noteChanges !== undefined) refreshForNoteChange(entry, noteChanges);
    } catch (err) {
      console.error(`${MODULE_ID} | notes refresh failed`, err);
    }
  });
}
