/**
 * Pure auto-capture logic. No Foundry globals — unit-tested with vitest.
 */

/** The group whose id matches the setting, or null when unset/stale. */
export function resolveTargetGroup(settingId, groups) {
  if (!settingId) return null;
  return groups.find((g) => g.id === settingId) ?? null;
}

/** Key a combatant row by its actor uuid, or by name when it has no actor. */
function participantKey(actorUuid, name) {
  return actorUuid ?? `name:${name}`;
}

/** Collapse raw combatant entries into counted rows grouped by actor/name. */
export function collapseParticipants(entries) {
  const byKey = new Map();
  for (const { actorUuid, name } of entries) {
    const id = participantKey(actorUuid, name);
    const row = byKey.get(id);
    if (row) row.count += 1;
    else byKey.set(id, { id, name, count: 1, actor: actorUuid ?? null });
  }
  return [...byKey.values()];
}

/** Union two counted-row lists, keeping the larger count per id (additive). */
export function mergeParticipants(existing, incoming) {
  const byKey = new Map(existing.map((r) => [r.id, { ...r }]));
  for (const row of incoming) {
    const prev = byKey.get(row.id);
    if (prev) byKey.set(row.id, { ...prev, name: row.name, actor: row.actor, count: Math.max(prev.count, row.count) });
    else byKey.set(row.id, { ...row });
  }
  return [...byKey.values()];
}

/** The place whose scene matches, or null. */
export function matchPlaceForScene(places, sceneUuid) {
  return places.find((p) => p.scene === sceneUuid) ?? null;
}

/** The attached timepoint id with the greatest sort, or null. */
export function pickLatestTimepoint(attachedIds, timepoints) {
  const attached = new Set(attachedIds);
  let best = null;
  for (const tp of timepoints) {
    if (attached.has(tp.id) && (best === null || tp.sort > best.sort)) best = tp;
  }
  return best?.id ?? null;
}

/** Collapse a list of names into "Name ×N" fragments (N omitted when 1). */
function countedNames(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
}

/** Build the combat outcome summary string from resolved end-state. */
export function summarizeOutcome(state, labels) {
  const died = [
    ...state.present.filter((c) => c.defeated).map((c) => c.name),
    ...state.departed.filter((c) => c.defeated).map((c) => c.name)
  ];
  const fled = state.departed.filter((c) => !c.defeated).map((c) => c.name);
  const injured = state.present
    .filter((c) => !c.defeated && c.hp && c.hp.value < c.hp.max && c.hp.value > 0)
    .map((c) => c.name);
  const parts = [];
  if (died.length) parts.push(`${labels.died}: ${countedNames(died)}`);
  if (injured.length) parts.push(`${labels.injured}: ${countedNames(injured)}`);
  if (fled.length) parts.push(`${labels.fled}: ${countedNames(fled)}`);
  return parts.length ? parts.join(" · ") : labels.none;
}

/** The timepoint with the greatest sort, or null when there are none. */
export function pickNewestTimepoint(timepoints) {
  let best = null;
  for (const tp of timepoints) if (best === null || tp.sort > best.sort) best = tp;
  return best;
}

const VIDEO_EXTENSIONS = ["webm", "mp4", "m4v", "ogv", "mov"];

/** True when a source path is a video by file extension (case-insensitive). */
export function isVideoSrc(src) {
  if (typeof src !== "string") return false;
  const clean = src.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/**
 * Append an image to a gallery, deduped by src. Returns { images, added };
 * added is false (and images unchanged) when src is already present.
 */
export function appendGalleryImage(images, entry) {
  if (images.some((i) => i.src === entry.src)) return { images, added: false };
  return { images: [...images, entry], added: true };
}

/**
 * Append many entries to a gallery's images, deduped by src against both the
 * existing images and earlier entries in the same batch.
 * @param {{id:string,src:string,caption:string}[]} existing
 * @param {{id:string,src:string,caption:string}[]} entries
 * @returns {{images:{id:string,src:string,caption:string}[], added:number}}
 */
export function mergeGalleryImages(existing, entries) {
  const images = [...existing];
  const seen = new Set(images.map((i) => i.src));
  let added = 0;
  for (const entry of entries) {
    if (seen.has(entry.src)) continue;
    seen.add(entry.src);
    images.push(entry);
    added++;
  }
  return { images, added };
}

/**
 * Resolve what a GM's "Show Players" share should file as media, or null when
 * the current user isn't the sharing GM. `options` is the shareImage() call's
 * argument; `appOptions` is the ImagePopout application's options.
 * @returns {{src:string|undefined, caption:string}|null}
 */
export function resolveSharedMediaShare({ isGM, options = {}, appOptions = {} }) {
  if (!isGM) return null;
  return {
    src: options.image ?? appOptions?.src,
    caption: options.caption || appOptions?.caption || options.title || appOptions?.window?.title || ""
  };
}

/**
 * Install the shareImage capture wrap, preferring libWrapper when the
 * lib-wrapper module is active and falling back to `registerManual` (the
 * classic prototype patch) when it's inactive, missing, or registration
 * throws. Returns which path was taken ("libwrapper" | "manual").
 */
export function installShareImageWrap({ libWrapperModule, libWrapper, moduleId, target, wrapper, registerManual, warn }) {
  if (libWrapperModule?.active) {
    try {
      libWrapper.register(moduleId, target, wrapper, "WRAPPER");
      return "libwrapper";
    } catch (error) {
      warn(error);
    }
  }
  registerManual();
  return "manual";
}
