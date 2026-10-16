// Start / End session (spec 2026-10-15 item 2; §9 recap ownership on users,
// added live). GM-only writers; the login offer runs on the writer seat.
// Pure helpers at the top keep this file importable by vitest: everything
// Foundry-served is imported lazily inside the functions that run in-game.
import { MODULE_ID, CAMPAIGN_FLAG, I18N, AUTO_START_SESSION_SETTING } from "../constants.mjs";
import { currentSession, currentSessionUpdate, clearCurrentSessionUpdate, nextSessionNumber, startedToday, recapOwnershipUpdate, adoptHeldUpdate } from "../logic/current-session.mjs";
import { recapDraft } from "../logic/recap-draft.mjs";
import { notesForSession } from "../logic/notes.mjs";
import { attendeeUuidsFor } from "../logic/attendee-player.mjs";

const connectedPlayers = () => game.users.filter((u) => u.active && !u.isGM);

/** Attendee update for the session page, or null when every connected character is already listed. */
async function attendeeUpdateFor(page, users) {
  const { sessionData } = await import("../sheets/session-data.mjs");
  const current = sessionData(page).attendees;
  const next = attendeeUuidsFor(users, current);
  return next.length === current.length ? null : { [`flags.${MODULE_ID}.session.attendees`]: next };
}

/** Session entries a newly connected player should own: those whose campaign baseline lets players view. */
export function grantForConnectedUser(userId, sessions, { ownerLevel, baselineOf }) {
  const out = [];
  for (const { campaign, entry } of sessions ?? []) {
    if (baselineOf(campaign) < 2) continue;
    const update = recapOwnershipUpdate(entry.ownership, [userId], { ownerLevel });
    if (update) out.push({ entry, update });
  }
  return out;
}

/** The campaign's open Session page, or null (a stale uuid reads as null). */
export function openSessionPage(campaign) {
  const cs = currentSession(campaign);
  if (!cs) return null;
  try {
    const page = fromUuidSync(cs.uuid);
    return page?.documentName === "JournalEntryPage" ? page : null;
  } catch {
    return null;
  }
}

/** Every open session across the campaigns the current user can see. */
export async function openSessions() {
  const { getCampaigns } = await import("../data/campaign-store.mjs");
  const { isVisibleToUser } = await import("../logic/hub-index.mjs");
  return getCampaigns()
    .map((campaign) => ({ campaign, page: openSessionPage(campaign) }))
    .filter(({ page }) => page && isVisibleToUser(page.parent, game.user));
}

const connectedPlayerIds = () => connectedPlayers().map((u) => u.id);

async function createSessionFor(campaign) {
  const { buildSessionPageData } = await import("../logic/session-page-data.mjs");
  const { baselineOwnership } = await import("../data/campaign-store.mjs");
  const { currentWorldComponents } = await import("../logic/campaign-calendar.mjs");
  const { sessionData } = await import("../sheets/session-data.mjs");
  const { SESSION_DOCUMENT_TYPE } = await import("../constants.mjs");
  const numbers = campaign.contents.flatMap((e) => e.pages.contents)
    .filter((p) => p.type === SESSION_DOCUMENT_TYPE)
    .map((p) => sessionData(p).sessionNumber);
  const n = nextSessionNumber(numbers);
  const name = game.i18n.format(`${I18N}.session.autoName`, { n });
  const entry = await JournalEntry.create({
    name, folder: campaign.id, ownership: { default: baselineOwnership(campaign) },
    pages: [buildSessionPageData(name, "", currentWorldComponents(), n)]
  });
  return entry?.pages?.contents?.[0] ?? null;
}

/** GM-only. Open a session: create (or promote `sessionUuid`), flag the campaign, grant recap ownership, adopt held notes. */
export async function startSession(campaign, { sessionUuid = null } = {}) {
  if (!game.user.isGM || !campaign) return null;
  const { baselineOwnership } = await import("../data/campaign-store.mjs");
  const { notesEntryOf, readNotes } = await import("../data/notes-store.mjs");
  const { openSessionPage: open } = await import("../integrations/mej-adapter.mjs");
  let page = sessionUuid ? await fromUuid(sessionUuid) : null;
  if (!page) page = await createSessionFor(campaign);
  if (!page) return null;
  await campaign.update(currentSessionUpdate(page.uuid, Date.now()));
  if (baselineOwnership(campaign) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
    const update = recapOwnershipUpdate(page.parent.ownership, connectedPlayerIds(), { ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    if (update) await page.parent.update(update);
  }
  // Spec item 9: attendees default to the connected players' characters; the GM edits the list on the sheet afterwards.
  const attendees = await attendeeUpdateFor(page, connectedPlayers());
  if (attendees) await page.update(attendees);
  const notesEntry = notesEntryOf(campaign);
  const adopt = notesEntry ? adoptHeldUpdate(readNotes(campaign), page.uuid) : null;
  if (adopt) await notesEntry.update(adopt);
  await open(page);
  return page;
}

/** GM-only. Clear the open session and offer a recap draft built from its notes (deviation 1: applied from a dialog). */
export async function endSession(campaign) {
  if (!game.user.isGM || !campaign) return;
  const page = openSessionPage(campaign);
  await campaign.update(clearCurrentSessionUpdate());
  if (!page) return;
  const { readNotes } = await import("../data/notes-store.mjs");
  const draft = recapDraft(notesForSession(readNotes(campaign), page.uuid), {
    formatTime: (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  });
  if (!draft) return;
  // The draft is already built from escaped note text (recapDraft), so it is enriched as-is with notes' enricher set.
  const { NOTE_ENRICH_OPTIONS } = await import("./note-links.mjs");
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(draft, { relativeTo: page, async: true, ...NOTE_ENRICH_OPTIONS });
  const append = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${I18N}.session.draftTitle`) },
    content: `<p>${game.i18n.localize(`${I18N}.session.draftHint`)}</p><div class="mej-cc-draft-preview">${enriched}</div>`,
    yes: { label: game.i18n.localize(`${I18N}.session.draftAppend`) },
    no: { label: game.i18n.localize(`${I18N}.session.draftSkip`) },
    rejectClose: false
  });
  if (!append) return;
  const current = page.system?.recap ?? "";
  await page.update({ "system.recap": `${current}${draft}` });
  ui.notifications.info(game.i18n.localize(`${I18N}.session.draftAppended`));
}

async function offerStartOnLogin() {
  if (!game.settings.get(MODULE_ID, AUTO_START_SESSION_SETTING)) return;
  const { getCampaigns } = await import("../data/campaign-store.mjs");
  const now = Date.now();
  for (const campaign of getCampaigns()) {
    if (currentSession(campaign)) continue;
    const last = campaign.getFlag(MODULE_ID, CAMPAIGN_FLAG)?.lastSessionStartedAt ?? null;
    if (startedToday(last, now)) continue;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.session.start`) },
      content: `<p>${game.i18n.format(`${I18N}.session.startOffer`, { campaign: foundry.utils.escapeHTML(campaign.name) })}</p>`,
      rejectClose: false
    });
    if (ok) await startSession(campaign);
  }
}

export function registerCurrentSession() {
  const writerSeat = () => game.user.isGM && game.user === game.users.activeGM;
  Hooks.on("userConnected", async (user, connected) => {
    if (!connected || user.isGM || !writerSeat()) return;
    try {
      const { baselineOwnership } = await import("../data/campaign-store.mjs");
      const open = await openSessions();
      const sessions = open.map(({ campaign, page }) => ({ campaign, entry: page.parent }));
      for (const { entry, update } of grantForConnectedUser(user.id, sessions, { ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, baselineOf: baselineOwnership })) {
        await entry.update(update);
      }
      // Late joiner with a character: append to every open session's attendees.
      for (const { page } of open) {
        const attendees = await attendeeUpdateFor(page, [user]);
        if (attendees) await page.update(attendees);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | recap ownership grant failed`, err);
    }
  });
  // Remember when a session last started, for the login offer.
  Hooks.on("updateFolder", (folder, changes) => {
    const cs = changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG]?.currentSession;
    if (!writerSeat() || !cs?.startedAt) return;
    folder.update({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}.lastSessionStartedAt`]: cs.startedAt }).catch(() => {});
  });
  const readyPass = () => {
    if (!writerSeat()) return;
    offerStartOnLogin().catch((err) => console.error(`${MODULE_ID} | start-session offer failed`, err));
  };
  if (game.ready) readyPass();
  else Hooks.once("ready", readyPass);
}
