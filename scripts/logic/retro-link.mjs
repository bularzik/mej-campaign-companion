// Pure planner for the retroactive auto-link pass (spec Part 2): given a
// newly-created entity and descriptors for every text page in the world,
// produce the per-page write plan. Matching reuses autoLinkAdded with an
// EMPTY baseline — the LCS diff then marks every word as "added", so the
// proven tokenizer/claiming engine does whole-document linking and existing
// links/<code>/<pre> stay opaque. No Foundry globals here.
import { autoLinkAdded } from "./auto-link.mjs";
import { audienceContains } from "./link-audience.mjs";

/** Occurrences of `@UUID[<uuid>]` in html (uuid taken literally, not as a pattern). */
export function countEntityLinks(html, uuid) {
  const needle = `@UUID[${uuid}]`;
  let count = 0;
  let i = 0;
  while ((i = (html ?? "").indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

/**
 * @param {object} args
 * @param {{uuid:string, name:string, viewerIds:string[]}} args.entity  the new entity
 * @param {{uuid:string, name:string, content:string, viewerIds:string[],
 *          noAutoLink:boolean, isOwn:boolean}[]} args.pages  every text page
 *          (viewerIds = the page's PARENT ENTRY viewer set)
 * @param {{viewerIds:string[]}[]} args.otherSameNamed  other entities whose
 *          trimmed, lowercased name equals the entity's
 * @param {number} [args.minLength=3]
 * @returns {{rows: {pageUuid:string, pageName:string, matchCount:number,
 *            newHtml:string|null, ambiguous:boolean}[]}}
 */
export function buildRetroPlan({ entity, pages, otherSameNamed, minLength = 3 }) {
  const rows = [];
  if ((entity.name?.trim().length ?? 0) < minLength) return { rows };
  const candidate = [{ name: entity.name, uuid: entity.uuid }];
  for (const page of pages ?? []) {
    if (page.isOwn || page.noAutoLink) continue;
    if (typeof page.content !== "string" || !page.content) continue;
    if (!audienceContains(page.viewerIds, entity.viewerIds)) continue;
    const linked = autoLinkAdded("", page.content, candidate);
    if (linked === page.content) continue;
    const matchCount =
      countEntityLinks(linked, entity.uuid) - countEntityLinks(page.content, entity.uuid);
    const ambiguous = (otherSameNamed ?? []).some((o) =>
      audienceContains(page.viewerIds, o.viewerIds)
    );
    rows.push({
      pageUuid: page.uuid,
      pageName: page.name,
      matchCount,
      newHtml: ambiguous ? null : linked,
      ambiguous
    });
  }
  return { rows };
}
