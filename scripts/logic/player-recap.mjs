/**
 * Pure helpers for the Session page type's flags["mej-campaign-companion"].playerRecaps
 * data (a SIBLING flag key to session-data.mjs's `.session`, never nested inside it -
 * see Task 5's reserved shape: playerRecaps: { [userId]: html }).
 *
 * Deliberately has NO Foundry imports beyond duck-typed document-shaped
 * parameters (mirrors session-data.mjs's `{getFlag}` convention), so this is
 * loadable directly by vitest.
 */

/** Generous cap on a single relayed recap write - a rich-text recap, not a file transfer. */
export const MAX_RECAP_HTML_LENGTH = 200_000;

/**
 * @param {{ getFlag: (scope: string, key: string) => any }} page
 * @returns {Record<string, string>} userId -> recap html, `{}` when unset.
 */
export function playerRecaps(page) {
  return page.getFlag("mej-campaign-companion", "playerRecaps") ?? {};
}

/**
 * Build the ordered list of recap sections to render: the current user's own
 * entry always appears (even empty, so they always have somewhere to write),
 * every other user's entry appears only when it actually has content (no
 * empty-placeholder rows for players who haven't written anything yet). The
 * caller's own entry sorts first.
 *
 * @param {Record<string, string>} recaps userId -> html
 * @param {{id: string, name: string}[]} users
 * @param {string} currentUserId
 */
export function buildRecapEntries(recaps, users, currentUserId) {
  const html = { ...recaps };
  if (!(currentUserId in html)) html[currentUserId] = "";
  return Object.entries(html)
    .filter(([userId, text]) => userId === currentUserId || (typeof text === "string" && text.trim()))
    .map(([userId, text]) => {
      const user = users.find((u) => u.id === userId);
      return { userId, html: text ?? "", name: user?.name ?? userId, isSelf: userId === currentUserId };
    })
    .sort((a, b) => (a.isSelf === b.isSelf ? 0 : a.isSelf ? -1 : 1));
}

/**
 * Where a recap write should go: "direct" when the writer already has
 * document-level ownership (their own player-writable session), "relay"
 * when a GM-owned session needs the active GM to perform the write on their
 * behalf, "unavailable" when neither is possible right now (no GM online).
 */
export function recapWriteRoute({ isOwner, hasActiveGM }) {
  if (isOwner) return "direct";
  if (hasActiveGM) return "relay";
  return "unavailable";
}

/**
 * Shape-check a relayed playerRecaps write. Null when valid, else a reason
 * slug. Mirrors media-relay.mjs's chunkProblem() convention for the GM-side
 * socket handler (scripts/hooks/player-recap.mjs).
 */
export function recapPayloadProblem(p) {
  if (typeof p?.senderId !== "string" || !p.senderId) return "bad-sender";
  if (typeof p.documentUuid !== "string" || !p.documentUuid) return "bad-document";
  if (typeof p.html !== "string") return "bad-html";
  if (p.html.length > MAX_RECAP_HTML_LENGTH) return "too-large";
  return null;
}
