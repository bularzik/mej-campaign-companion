// Shared "re-render the sheets showing these entries" helper for the live
// hooks (secrets-ui reveals, party relationships, notes). Imports only the
// Session region patcher (no MEJ classes), so any hook module can use it.
import { patchesRegions, patchSessionRegions } from "../sheets/session-regions.mjs";

/**
 * Sheets showing a JournalEntryPage that are NOT the shell's mounted
 * subsheet - i.e. popped-out windows. Feature-detected against Foundry's
 * ApplicationV2 instance registry; an empty list is a safe degradation (the
 * shell still refreshes), never an error.
 */
export function poppedOutPageSheets() {
  const registry = foundry.applications?.instances;
  if (!registry?.values) return [];
  const shellSubsheet = game.MonksEnhancedJournal?.journal?.subsheet ?? null;
  return [...registry.values()].filter((app) =>
    app && app !== shellSubsheet && app.rendered && app.document instanceof JournalEntryPage);
}

/**
 * Re-render the shell and every popped-out page sheet whose entry uuid
 * satisfies `matches(uuid)`; `null` = all of them (a settings change
 * implicates no single entry). With `patchSessions`, a Session sheet among
 * them has its header and Table talk patched in place instead (its editors
 * are always live - spec 2026-10-19 §4.4); use it for changes that show only
 * there (Table talk notes).
 */
export function refreshViewsMatching(matches, { patchSessions = false } = {}) {
  const hit = (uuid) => !matches || matches(uuid);
  const shell = game.MonksEnhancedJournal?.journal;
  if (shell?.rendered) {
    const shown = shell.document?.parent ?? shell.document;
    if (hit(shown?.uuid) || hit(shell.document?.uuid)) {
      if (patchSessions && patchesRegions(shell.subsheet)) patchSessionRegions(shell.subsheet);
      else shell.render({ tempOwnership: shell.tempOwnership, reload: true });
    }
  }
  for (const app of poppedOutPageSheets()) {
    if (!hit(app.document?.parent?.uuid)) continue;
    if (patchSessions && patchesRegions(app)) patchSessionRegions(app);
    else app.render?.();
  }
}
