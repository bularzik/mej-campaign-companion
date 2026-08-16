import { MODULE_ID } from "../constants.mjs";
import { sortKeyBetween, sortTimepoints } from "../logic/timeline-sort.mjs";
import { withLink, withoutLink, displayLink, timepointIdsWithLink } from "../logic/timeline-links.mjs";

const TIMELINE_FLAG = "timeline";

/** Sorted timepoints of a group. */
export function getTimepoints(group) {
  const flag = group.getFlag(MODULE_ID, TIMELINE_FLAG);
  return sortTimepoints(flag?.timepoints ?? []);
}

/** Timepoint ids whose links reference this record uuid. */
export function timepointsForRecord(group, uuid) {
  return timepointIdsWithLink(getTimepoints(group), uuid);
}

async function setTimepoints(group, timepoints) {
  await group.setFlag(MODULE_ID, TIMELINE_FLAG, { timepoints });
}

export async function addTimepoint(group, label, position = null, campaignDate = null) {
  // Concurrent edits to a group's timepoints are last-write-wins on the whole
  // flag array (accepted: the array is small and edits are rare).
  if (!Number.isInteger(position)) position = null;
  const tps = getTimepoints(group);
  const i = position == null ? tps.length : Math.max(0, Math.min(position, tps.length));
  const tp = {
    id: foundry.utils.randomID(),
    label,
    sort: sortKeyBetween(tps[i - 1]?.sort ?? null, tps[i]?.sort ?? null),
    createdAt: Date.now(),
    campaignDate: campaignDate ?? null
  };
  await setTimepoints(group, [...tps, tp]);
  return tp;
}

/** Update a timepoint's label and/or campaign date. Only provided keys change. */
export async function editTimepoint(group, id, { label, campaignDate } = {}) {
  const patch = {};
  if (label !== undefined) patch.label = label;
  if (campaignDate !== undefined) patch.campaignDate = campaignDate;
  if (Object.keys(patch).length) await updateTimepoint(group, id, patch);
}

export async function renameTimepoint(group, id, label) {
  await editTimepoint(group, id, { label });
}

export async function moveTimepoint(group, id, position) {
  const tps = getTimepoints(group);
  const moving = tps.find((t) => t.id === id);
  if (!moving) return;
  const rest = tps.filter((t) => t.id !== id);
  const i = Math.max(0, Math.min(position, rest.length));
  const sort = sortKeyBetween(rest[i - 1]?.sort ?? null, rest[i]?.sort ?? null);
  await setTimepoints(group, [...rest, { ...moving, sort }]);
}

export async function deleteTimepoint(group, id) {
  await setTimepoints(group, getTimepoints(group).filter((t) => t.id !== id));
}

async function updateTimepoint(group, timepointId, patch) {
  const tps = getTimepoints(group).map((t) => (t.id === timepointId ? { ...t, ...patch } : t));
  await setTimepoints(group, tps);
}

/**
 * Attach a document/image link to a timepoint. Generates the link id.
 * Returns the stored entry, or null for a duplicate or unknown timepoint.
 */
export async function addLink(group, timepointId, link) {
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  if (!tp) return null;
  const entry = { id: foundry.utils.randomID(), ...link };
  const links = withLink(tp.links, entry);
  if (!links) return null;
  await updateTimepoint(group, timepointId, { links });
  return entry;
}

export async function removeLink(group, timepointId, linkId) {
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  if (!tp) return;
  await updateTimepoint(group, timepointId, { links: withoutLink(tp.links, linkId) });
}

/** Flip an image link's player visibility. No-op for document links. */
export async function toggleLinkShowPlayers(group, timepointId, linkId) {
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  const link = tp?.links?.find((l) => l.id === linkId);
  if (!link?.src) return;
  const links = tp.links.map((l) =>
    l.id === linkId ? { ...l, showPlayers: l.showPlayers !== true } : l
  );
  await updateTimepoint(group, timepointId, { links });
}

/**
 * Timepoint links resolved and permission-filtered for a user.
 * Permission is evaluated at call time, never cached.
 */
export function resolveLinks(timepoint, user) {
  return (timepoint.links ?? [])
    .map((link) => {
      if (link.src) return displayLink(link, { isGM: user.isGM });
      const doc = fromUuidSync(link.uuid);
      // Compendium index entries lack testUserPermission; GMs pass regardless.
      // MEJ pages have no per-page system.hidden (unlike campaign-record's
      // isRecordVisible check), so visibility here is permission-only.
      const permitted = user.isGM
        || doc?.testUserPermission?.(user, "LIMITED") === true;
      return displayLink(link, {
        isGM: user.isGM,
        doc: doc ? { permitted, name: doc.name, img: doc.img ?? doc.thumb ?? null } : null
      });
    })
    .filter(Boolean);
}
