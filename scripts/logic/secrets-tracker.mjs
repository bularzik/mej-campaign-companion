/**
 * Secrets tracker row filtering (spec §7). Rows are pre-assembled by the
 * Hub (Foundry glue); this module only implements the filter semantics so
 * they're vitest-testable: type, revealed-state, and the "what does player
 * X know" view. Pure and Foundry-free.
 */
import { canSee, isRevealed } from "./reveal-state.mjs";

export function filterTrackerRows(rows, { type = "", state = "all", playerId = "", groups = [] } = {}) {
  return (rows ?? []).filter((row) => {
    if (type && row.entryType !== type) return false;
    const revealed = row.revealedAll === true || isRevealed(row.audience);
    if (state === "revealed" && !revealed) return false;
    if (state === "unrevealed" && revealed) return false;
    if (playerId && !(row.revealedAll === true || canSee(row.audience, playerId, groups))) return false;
    return true;
  });
}
