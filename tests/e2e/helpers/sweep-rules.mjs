// Pure decision rules for global setup's crashed-run sweep. They take plain
// data lifted out of the page (never Foundry documents) so vitest can pin
// them down without a browser — see test/e2e-sweep-rules.test.js. The
// helpers in foundry.mjs do the page.evaluate round trips around them.

export const TT_PREFIX = "TT-";

/**
 * Ids of the JournalEntry folders a crashed run left behind: those whose
 * name starts with the test prefix. A campaign fixture (createCampaign in
 * 13-stock-smoke.spec.mjs) is a folder holding a portal entry and a
 * timeline journal; the journal sweep reclaims the two entries by name but
 * never touched the folder.
 *
 * @param {{ id: string, type: string, name: string|null }[]} folders
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function strandedTestFolderIds(folders, prefix = TT_PREFIX) {
  return folders
    .filter((f) => f.type === "JournalEntry" && typeof f.name === "string" && f.name.startsWith(prefix))
    .map((f) => f.id);
}

/**
 * Whether the world-scoped autoCaptureCampaign setting points at a folder
 * that no longer exists — the state a crashed campaign-portal test leaves
 * once its TT- folder has been swept — and so must be cleared.
 *
 * @param {string|null|undefined} value the setting's current value (a folder id or "")
 * @param {string[]} existingFolderIds ids of the folders still in the world
 * @returns {boolean}
 */
export function autoCaptureNeedsReset(value, existingFolderIds) {
  if (!value) return false;
  return !existingFolderIds.includes(value);
}
