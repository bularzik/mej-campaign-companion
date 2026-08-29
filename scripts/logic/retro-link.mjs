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
 * Plan the retroactive pass for a WHOLE BURST of new entities at once (C7).
 *
 * One row per page, carrying every entity that links into it, so the caller
 * issues ONE write per page no matter how many entities matched. This is what
 * lets the caller walk the world once for a 50-section import instead of once
 * per created entity.
 *
 * Batching is also more correct than looping this planner per entity, which is
 * why it replaced that loop rather than wrapping it. autoLinkAdded claims words
 * across ALL candidates using one shared claim array, so overlapping names
 * ("Elara" inside "Elara Moonwhisper") resolve against each other in a single
 * pass; run separately, each pass would be blind to what the others claimed,
 * and every pass after the first would have to be planned against the previous
 * one's output or silently clobber it.
 *
 * Eligibility stays per entity per page - audience containment, the page's own
 * entity, and the same-named-twin ambiguity check are all decided for each
 * (entity, page) pair, exactly as before.
 *
 * @param {object} args
 * @param {{uuid:string, name:string, viewerIds:string[]}[]} args.entities  the new entities
 * @param {{uuid:string, name:string, content:string, viewerIds:string[],
 *          noAutoLink:boolean, entryUuid:string}[]} args.pages  every text page
 *          (viewerIds = the page's PARENT ENTRY viewer set; entryUuid = that
 *          entry's uuid, used to skip an entity's own pages)
 * @param {Record<string, {viewerIds:string[]}[]>} [args.otherSameNamed]  keyed
 *          by entity uuid: other entities sharing that entity's trimmed,
 *          lowercased name
 * @param {number} [args.minLength=3]
 * @returns {{rows: {pageUuid:string, pageName:string, newHtml:string|null,
 *            matches:{entityUuid:string, entityName:string, count:number}[],
 *            ambiguous:{entityUuid:string, entityName:string, count:number}[]}[]}}
 */
export function buildRetroPlanBatch({ entities, pages, otherSameNamed = {}, minLength = 3 }) {
  const rows = [];
  const named = (entities ?? []).filter((e) => (e?.name?.trim().length ?? 0) >= minLength);
  if (!named.length) return { rows };

  for (const page of pages ?? []) {
    if (page.noAutoLink) continue;
    if (typeof page.content !== "string" || !page.content) continue;

    const forPage = named.filter((e) =>
      page.entryUuid !== e.uuid && audienceContains(page.viewerIds, e.viewerIds));
    if (!forPage.length) continue;

    const twinned = (e) =>
      (otherSameNamed[e.uuid] ?? []).some((o) => audienceContains(page.viewerIds, o.viewerIds));
    const writable = forPage.filter((e) => !twinned(e));

    const linked = writable.length
      ? autoLinkAdded("", page.content, writable.map((e) => ({ name: e.name, uuid: e.uuid })))
      : page.content;
    const gained = (html, uuid) => countEntityLinks(html, uuid) - countEntityLinks(page.content, uuid);

    const matches = writable
      .map((e) => ({ entityUuid: e.uuid, entityName: e.name, count: gained(linked, e.uuid) }))
      .filter((m) => m.count > 0);

    // An ambiguous entity is reported but never written, so it is planned on
    // its own against the ORIGINAL content purely to find out whether it would
    // have matched at all - a twin that matches nothing here is not worth
    // telling the GM about.
    const ambiguous = forPage.filter(twinned)
      .map((e) => ({
        entityUuid: e.uuid,
        entityName: e.name,
        count: gained(autoLinkAdded("", page.content, [{ name: e.name, uuid: e.uuid }]), e.uuid)
      }))
      .filter((m) => m.count > 0);

    if (!matches.length && !ambiguous.length) continue;
    rows.push({
      pageUuid: page.uuid,
      pageName: page.name,
      newHtml: matches.length ? linked : null,
      matches,
      ambiguous
    });
  }
  return { rows };
}
