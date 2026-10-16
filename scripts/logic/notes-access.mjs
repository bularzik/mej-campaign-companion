// Who owns the notes entry (owner decision 2026-10-15 §11.1): every non-GM
// user when the campaign baseline is Observer or above. Separate from
// party-access.mjs so notes never widen party-relationship writers.
import { campaignFlagOf, ownershipLevelFor } from "./campaigns.mjs";

export function notesWriters(campaign, users, levels) {
  const baseline = ownershipLevelFor(campaignFlagOf(campaign)?.ownershipDefault, levels);
  if (baseline < levels.OBSERVER) return [];
  return (users ?? []).filter((u) => !u.isGM).map((u) => u.id);
}
