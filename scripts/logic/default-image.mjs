// Display-time default image per entry type (approved design 2026-09-05):
// MEJ's own placeholder PNGs for its built-in types, the companion's for its
// two types, null for everything else (picture, text, pdf, video, unknown)
// so callers never synthesize a path that 404s.
import { MODULE_ID } from "../constants.mjs";

export const MEJ_ASSET_PATH = "modules/monks-enhanced-journal/assets";
export const COMPANION_ASSET_PATH = `modules/${MODULE_ID}/assets`;

const MEJ_ASSET_TYPES = new Set([
  "person", "place", "poi", "quest", "encounter", "event",
  "organization", "shop", "loot", "list", "slideshow", "journalentry"
]);
const COMPANION_ASSET_TYPES = new Set(["session", "campaign"]);

/** @returns {string|null} */
export function defaultImageFor(type) {
  if (MEJ_ASSET_TYPES.has(type)) return `${MEJ_ASSET_PATH}/${type}.png`;
  if (COMPANION_ASSET_TYPES.has(type)) return `${COMPANION_ASSET_PATH}/${type}.png`;
  return null;
}

/** The entry's own image when it has one (non-empty string), else the type default. */
export function imageFor(src, type) {
  if (typeof src === "string" && src.length) return src;
  return defaultImageFor(type);
}
