/**
 * Pure image helpers for docx import. No Foundry globals — unit-tested with vitest.
 */

/** Renderable image subtypes → the file extension Foundry serves them under. */
export const IMAGE_SUBTYPE_EXT = {
  png: "png",
  apng: "apng",
  avif: "avif",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  tiff: "tiff",
  "svg+xml": "svg"
};

/** Extension for a renderable subtype, or null when Foundry cannot render it. */
export function imageExtension(subtype) {
  return IMAGE_SUBTYPE_EXT[subtype] ?? null;
}

/**
 * Parse a base64 image data-URI. Returns { mime, subtype, base64 } or null.
 * subtype is lower-cased; hyphen/plus subtypes (x-emf, svg+xml) are preserved.
 */
export function parseImageDataUri(uri) {
  const m = /^data:(image\/([a-z0-9.+-]+));base64,(.*)$/i.exec(uri ?? "");
  if (!m) return null;
  return { mime: m[1], subtype: m[2].toLowerCase(), base64: m[3] };
}

/**
 * Map each page to its governing timepoint id (nearest session at or before it
 * in document order). Pages before the first session are backfilled to the
 * first timepoint. All null when no page is a session.
 * @param {(string|null)[]} sessionTpIds page's own tp id if a session, else null
 * @returns {(string|null)[]}
 */
export function assignTimepoints(sessionTpIds) {
  const firstId = sessionTpIds.find((id) => id != null) ?? null;
  let current = null;
  return sessionTpIds.map((id) => {
    if (id != null) current = id;
    return current ?? firstId;
  });
}
