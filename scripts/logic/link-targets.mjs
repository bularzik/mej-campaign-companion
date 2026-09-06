// scripts/logic/link-targets.mjs
// Where a page's linkable prose lives, and whether two documents are in
// linking reach of each other (spec 2026-09-05 §1). Pure: both auto-link
// hooks and the import wizard consume this so the "text.content only"
// assumption that skipped every session page cannot come back.
import { bodyRegion } from "./field-extractors.mjs";

/**
 * Every region of the page that auto-link may read or write, in order.
 * Content is always a string ("" when the field is empty or missing) so a
 * first save can diff against an empty baseline; scanners that want only
 * non-empty regions filter on `content` themselves.
 * @returns {{ key: string, content: string, gmOnly: boolean }[]}
 */
export function linkableRegions(page) {
  const body = bodyRegion(page);
  const regions = [{ key: body.key, content: body.content, gmOnly: false }];
  if (body.key === "system.recap") {
    const notes = page?.system?.gmNotes;
    regions.push({ key: "system.gmNotes", content: typeof notes === "string" ? notes : "", gmOnly: true });
  }
  return regions;
}

/**
 * Campaign scope for linking: an entity in campaign A links with pages in A
 * or unfiled; an unfiled entity links anywhere; A never links with B.
 * Ids are campaign Folder ids or null/"" for unfiled.
 */
export function sameLinkScope(campaignIdA, campaignIdB) {
  return !campaignIdA || !campaignIdB || campaignIdA === campaignIdB;
}
