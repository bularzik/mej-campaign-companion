/** Document classes accepted as timeline links. */
export const LINKABLE_TYPES = ["JournalEntry", "JournalEntryPage", "Actor", "Scene", "Item"];

/** FontAwesome icon classes per link type ("image" is the file-link pseudo-type). */
export const LINK_ICONS = {
  JournalEntry: "fa-solid fa-book",
  JournalEntryPage: "fa-solid fa-file-lines",
  Actor: "fa-solid fa-user",
  Scene: "fa-solid fa-map",
  Item: "fa-solid fa-suitcase",
  image: "fa-solid fa-image"
};

// Foundry's CONST.IMAGE_FILE_EXTENSIONS keys, inlined so this module stays pure.
const IMAGE_EXTENSIONS = ["apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "tiff", "webp"];

// Source: campaign-record's auto-capture.mjs (isVideoSrc). Inlined here rather than
// imported since auto-capture.mjs is not part of this module's ported scope.
const VIDEO_EXTENSIONS = ["webm", "mp4", "m4v", "ogv", "mov"];

/** True when a source path is a video by file extension (case-insensitive). */
function isVideoSrc(src) {
  if (typeof src !== "string") return false;
  const clean = src.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/** Whether a path/URL points at an image, by extension (query/fragment stripped). */
export function isImagePath(src) {
  if (typeof src !== "string" || !src) return false;
  const clean = src.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/** Decoded final path segment of a src, without query/fragment. */
export function filenameFromSrc(src) {
  const clean = src.split("?")[0].split("#")[0];
  const segment = clean.split("/").pop();
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // malformed percent-encoding: fall back to the raw segment
  }
}

/** Dedupe key of a link: uuid for documents, src for images. */
function linkKey(link) {
  return link.uuid ?? link.src;
}

/** Append with dedupe. Returns the new array, or null when already present. */
export function withLink(links, link) {
  const existing = links ?? [];
  if (existing.some((l) => linkKey(l) === linkKey(link))) return null;
  return [...existing, link];
}

/** Remove by link id. Returns the new array. */
export function withoutLink(links, linkId) {
  return (links ?? []).filter((l) => l.id !== linkId);
}

/**
 * Classify a timeline drop payload into a link candidate.
 * Accepts raw OS files (dataTransfer.files — takes precedence), Foundry
 * document drag data, FilePicker/Tile file payloads (src / path /
 * texture.src), and a text/uri-list image URL fallback.
 * @returns {{kind:"files",accepted:File[],rejected:string[]}
 *   |{kind:"document",uuid:string,type:string}|{kind:"image",src:string}|null}
 */
export function classifyDropData(data, uriList = "", files = []) {
  if (files.length) {
    const accepted = [];
    const rejected = [];
    for (const f of files) {
      // Duplicates media-drop.mjs's isMediaFilename: importing it back would cycle.
      if (isImagePath(f.name) || isVideoSrc(f.name)) accepted.push(f);
      else rejected.push(f.name);
    }
    return { kind: "files", accepted, rejected };
  }
  if (LINKABLE_TYPES.includes(data?.type) && typeof data.uuid === "string") {
    return { kind: "document", uuid: data.uuid, type: data.type };
  }
  const src = [data?.src, data?.path, data?.texture?.src].find((s) => typeof s === "string");
  if (isImagePath(src)) return { kind: "image", src };
  const uri = uriList.split("\n")[0]?.trim();
  if (isImagePath(uri)) return { kind: "image", src: uri };
  return null;
}

/**
 * Decide how one stored link renders for a user.
 * @param {object} link stored link entry ({uuid,name,type} or {src,name,showPlayers})
 * @param {object} ctx {isGM, doc} — doc is {permitted, name, img} for a resolved
 *   document, null when the uuid no longer resolves; omit for image links.
 * @returns {object|null} render entry, or null to hide from this user
 */
export function displayLink(link, { isGM, doc }) {
  if (link.src) {
    if (!isGM && link.showPlayers !== true) return null;
    return {
      id: link.id, name: link.name, icon: LINK_ICONS.image, kind: "image",
      src: link.src, img: link.src, showPlayers: link.showPlayers === true
    };
  }
  const icon = LINK_ICONS[link.type] ?? "fa-solid fa-link";
  if (!doc) {
    if (!isGM) return null;
    return { id: link.id, name: link.name, icon, kind: "broken", uuid: link.uuid, img: null };
  }
  if (!doc.permitted) return null;
  return {
    id: link.id, name: doc.name ?? link.name, icon, kind: "document",
    uuid: link.uuid, img: doc.img ?? null
  };
}

/**
 * Drag payload for a record row. `type`+`uuid` is Foundry's standard document
 * drop shape (so a drop into a journal becomes an @UUID content link); `kind`
 * is the internal key the timeline drop handler checks first.
 */
export function recordDragPayload(uuid) {
  return { kind: "campaign-record.record", type: "JournalEntryPage", uuid };
}

/** Ids of timepoints whose links reference this document uuid. */
export function timepointIdsWithLink(timepoints, uuid) {
  return (timepoints ?? [])
    .filter((tp) => (tp.links ?? []).some((l) => l.uuid === uuid))
    .map((tp) => tp.id);
}

/**
 * Flatten record→timepoint memberships into link-add operations for the v3
 * migration. addLink dedupes, so re-running is safe.
 */
export function recordLinkMigrationEntries(pages) {
  const entries = [];
  for (const page of pages ?? []) {
    for (const timepointId of page.timepointIds ?? []) {
      entries.push({ timepointId, link: { uuid: page.uuid, name: page.name, type: "JournalEntryPage" } });
    }
  }
  return entries;
}
