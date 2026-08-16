/**
 * Per-viewer relationship visibility (spec §6). MEJ natively gives each
 * relationship a free-text label, an all-or-nothing secret label
 * (rel.revealed), and a binary hidden row flag; the companion overlay
 * (flags["mej-campaign-companion"].relReveals = {[relId]: {row?, secret?}})
 * adds per-player/group granularity on top without touching MEJ data.
 * Pure and Foundry-free.
 */
import { canSee } from "./reveal-state.mjs";

function entriesOf(flagValue) {
  if (Array.isArray(flagValue)) return flagValue.map((rel) => [rel?.id ?? "", rel]);
  if (flagValue && typeof flagValue === "object") return Object.entries(flagValue);
  return [];
}

export function visibleRelRows(relationships, relReveals, { userId, groups, isGM }) {
  const rows = [];
  for (const [key, rel] of entriesOf(relationships)) {
    if (!rel || typeof rel.uuid !== "string" || !rel.uuid.length) continue;
    const id = String(rel.id ?? key);
    const overlay = relReveals?.[id] ?? {};
    const hidden = rel.hidden === true;
    const rowRevealedToUser = !isGM && hidden && canSee(overlay.row, userId, groups);
    if (!isGM && hidden && !rowRevealedToUser) continue;
    const secret = typeof rel.secret === "string" ? rel.secret : "";
    let secretText = null;
    if (isGM) secretText = secret;
    else if (secret && (rel.revealed === true || canSee(overlay.secret, userId, groups))) secretText = secret;
    rows.push({ id, uuid: rel.uuid, label: typeof rel.relationship === "string" ? rel.relationship : "", hidden, rowRevealedToUser, secretText });
  }
  return rows;
}
