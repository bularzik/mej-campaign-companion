// Pure timeline selection logic (spec D §1). No Foundry imports so vitest
// can load it directly - same convention as logic/campaigns.mjs. Operates
// on doc-shaped plain objects: timelines have .id and .name.

/**
 * Display order: the default timeline first, then the rest name-sorted
 * (locale compare). A null/unknown defaultId simply name-sorts everything.
 * Always returns a new array; never mutates the input.
 */
export function orderTimelines(timelines, defaultId) {
  const list = [...(timelines ?? [])];
  const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "");
  const def = list.find((t) => t.id === defaultId) ?? null;
  const rest = list.filter((t) => t !== def).sort(byName);
  return def ? [def, ...rest] : rest;
}

/**
 * Which timeline is the campaign's auto-filing default: the flagged id
 * when it still names one of `timelines`, else the FIRST element as given.
 * Callers pass Foundry collection order (i.e. creation order), so a legacy
 * campaign's sole timeline is always its default with no stored flag and
 * no migration write (spec D, Migration row). The fallback deliberately
 * ignores display ordering - that is orderTimelines' job.
 */
export function resolveDefaultTimelineId(timelines, flagId) {
  const list = timelines ?? [];
  if (!list.length) return null;
  return list.some((t) => t.id === flagId) ? flagId : list[0].id;
}

/**
 * Split timeline entries into per-campaign buckets plus the world bucket
 * (timelines under no campaign - spec D's world timelines). Input order is
 * preserved within every bucket so callers can feed the result straight to
 * resolveDefaultTimelineId.
 */
export function partitionTimelines(entries, campaignIdOf) {
  const byCampaign = new Map();
  const world = [];
  for (const entry of entries ?? []) {
    const cid = campaignIdOf(entry);
    if (!cid) {
      world.push(entry);
      continue;
    }
    if (!byCampaign.has(cid)) byCampaign.set(cid, []);
    byCampaign.get(cid).push(entry);
  }
  return { byCampaign, world };
}
