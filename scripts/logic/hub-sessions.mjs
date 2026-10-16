// Pure view-model for the Hub's Sessions tab (spec 2026-10-15 §5.1, item 5).
// No Foundry imports. Note counts are a seam for Plan B (notes primitive):
// this plan always passes an empty map.
import { stripUuidLinks } from "./snippet-text.mjs";

const MODULE_ID = "mej-campaign-companion";

// Block-level tags separate words (become a space); every other tag is
// inline and is removed without a space (Controller ruling 1).
const BLOCK_TAG = /<\/?(?:p|br|div|li|h[1-6]|tr|td|th|ul|ol|hr|pre|section|table|blockquote)\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;

/** Tag-stripped, whitespace-collapsed first `max` characters of a recap. */
export function recapPreview(html, max = 140) {
  if (typeof html !== "string" || !html) return "";
  const text = stripUuidLinks(html)
    .replace(BLOCK_TAG, " ")
    .replace(ANY_TAG, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Attendee display names a viewer may see. `resolve(uuid)` may return a full
 * document, a compendium index entry (no testUserPermission) or null; only
 * full documents the viewer can see at LIMITED (a GM sees all) are named.
 * @param {string[]} uuids
 * @param {{resolve:Function,isGM:boolean,user:object,users:Iterable,playerName:Function}} ctx
 */
export function visibleAttendeeNames(uuids, { resolve, isGM, user, users, playerName }) {
  return (uuids ?? []).map((u) => {
    const actor = resolve(u);
    if (!actor) return null;
    const isDoc = typeof actor.testUserPermission === "function";
    if (!isGM && !(isDoc && actor.testUserPermission(user, "LIMITED"))) return null;
    const player = isDoc ? playerName(actor, users) : "";
    return player ? `${actor.name} (${player})` : actor.name;
  }).filter(Boolean);
}

function numberOf(session) {
  const n = session?.sessionNumber;
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object[]} pages  Session JournalEntryPages (any order)
 * @returns {{uuid,entryUuid,name,number,worldDate,attendees,recapPreview,noteCount}[]}
 */
export function sessionRows(pages, { noteCounts = new Map(), formatDate = () => "", attendeeNames = () => [], recapText = (p) => p?.system?.recap ?? "" } = {}) {
  const rows = (pages ?? []).map((p) => {
    const session = p?.flags?.[MODULE_ID]?.session ?? {};
    const attendees = Array.isArray(session.attendees) ? session.attendees : [];
    return {
      uuid: p.uuid,
      entryUuid: p.parent?.uuid ?? p.uuid,
      name: p.name ?? "",
      number: numberOf(session),
      worldDate: session.campaignDate ? (formatDate(session.campaignDate) ?? "") : "",
      attendees: attendeeNames(attendees) ?? [],
      recapPreview: recapPreview(recapText(p) ?? ""),
      noteCount: noteCounts.get(p.uuid) ?? 0
    };
  });
  rows.sort((a, b) => {
    if (a.number === null && b.number === null) return a.name.localeCompare(b.name);
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return b.number - a.number || a.name.localeCompare(b.name);
  });
  return rows;
}
