// `/note <text>` (spec 2026-10-15 item 3). The handler takes an injected env
// so the routing and error mapping are unit-tested; registerNoteCommand
// builds the real env from Foundry. Foundry-served modules are imported
// lazily so this file stays importable by vitest.
import { MODULE_ID, I18N } from "../constants.mjs";
import { parseNoteCommand } from "../logic/note-command.mjs";
import { routeNote } from "../logic/current-session.mjs";

const COMMAND_KEYS = new Set(["filed", "held", "ambiguous", "none"]);

export async function handleNoteCommand(text, env) {
  const route = routeNote({ openSessions: env.openSessions, visibleCampaignIds: env.visibleCampaignIds });
  if (route.kind === "refuse") return { ok: false, key: route.reason };
  const sessionUuid = route.kind === "session" ? route.sessionUuid : null;
  try {
    await env.addNote(route.campaignId, {
      text: env.link(route.campaignId, text), sessionUuid, kind: "player", worldDate: env.worldDate ?? null
    });
  } catch (err) {
    return { ok: false, key: err?.reason ?? "writeFailed" };
  }
  return route.kind === "session" ? { ok: true, key: "filed", data: { session: sessionUuid } } : { ok: true, key: "held", data: {} };
}

async function realEnv() {
  const { openSessions } = await import("./current-session.mjs");
  const { getCampaigns } = await import("../data/campaign-store.mjs");
  const { notesEntryOf, addNote } = await import("../data/notes-store.mjs");
  const { linkNoteText } = await import("./note-links.mjs");
  const { currentWorldComponents } = await import("../logic/campaign-calendar.mjs");
  const open = (await openSessions()).map(({ campaign, page }) => ({ campaignId: campaign.id, sessionUuid: page.uuid }));
  // "Visible" for routing = campaigns whose notes entry this user can write to
  // (notes writers own the entry; GMs own everything).
  const visible = getCampaigns().filter((c) => notesEntryOf(c)?.isOwner).map((c) => c.id);
  return {
    openSessions: open, visibleCampaignIds: visible,
    addNote: (campaignId, fields) => addNote(campaignId, fields),
    link: (campaignId, text) => linkNoteText(game.folders.get(campaignId), text),
    worldDate: currentWorldComponents()
  };
}

/** Whisper the result to the sender only. Store reasons live at notes.<reason>, command results at notes.command.<key>. */
async function echo(result) {
  const key = result.ok || COMMAND_KEYS.has(result.key) ? `notes.command.${result.key}` : `notes.${result.key}`;
  let name = "";
  if (result.ok && result.data?.session) {
    try { name = fromUuidSync(result.data.session)?.name ?? ""; } catch { name = ""; }
  }
  const content = `<p class="mej-cc-note-echo">${game.i18n.format(`${I18N}.${key}`, { session: foundry.utils.escapeHTML(name) })}</p>`;
  await ChatMessage.implementation.create({ content, whisper: [game.user.id] });
}

export function registerNoteCommand() {
  // chatMessage(chatLog, message, chatData): returning false suppresses the message (Foundry 13/14).
  // Foundry 14's prose-mirror input sends HTML (`<p>/note …</p>`);
  // parseNoteCommand reads it as text the way ChatLog.parse does.
  Hooks.on("chatMessage", (log, message) => {
    const parsed = parseNoteCommand(message);
    if (!parsed) return true;
    (async () => {
      try {
        await echo(await handleNoteCommand(parsed.text, await realEnv()));
      } catch (err) {
        console.error(`${MODULE_ID} | /note failed`, err);
        ui.notifications.warn(game.i18n.localize(`${I18N}.notes.writeFailed`));
      }
    })();
    return false;
  });
}
