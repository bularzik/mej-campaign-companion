/**
 * dataVersion 2 -> 3 planner: which "revealed to everyone" records need
 * converting from the companion's private `audience.all` flag to Foundry's
 * native `revealed` class.
 *
 * Pure and Foundry-free so the decision is unit-tested on its own; the caller
 * (campaign-companion.mjs's ready hook) builds the input from live documents
 * and applies the result.
 *
 * A record whose section is no longer in the body is deliberately OMITTED
 * rather than reported as an error: there is nothing to add a class to, and
 * the reader keeps honouring a leftover `all: true` forever, so leaving it
 * alone degrades to today's behaviour instead of silently un-revealing a
 * secret someone was shown.
 *
 * @param {Array<{entryUuid:string, pageUuid:string, bodyKey:string, reveals:object, sectionIds:string[]}>} entries
 * @returns {Array<{entryUuid:string, pageUuid:string, bodyKey:string, sectionIds:string[]}>}
 */
export function planNativeRevealMigration(entries) {
  const plan = [];
  for (const entry of entries ?? []) {
    if (!entry) continue;
    const present = new Set(entry.sectionIds ?? []);
    const sectionIds = Object.entries(entry.reveals ?? {})
      .filter(([, audience]) => audience?.all === true)
      .map(([id]) => id)
      .filter((id) => present.has(id));
    if (!sectionIds.length) continue;
    plan.push({
      entryUuid: entry.entryUuid, pageUuid: entry.pageUuid, bodyKey: entry.bodyKey, sectionIds
    });
  }
  return plan;
}

/**
 * dataVersion 3 -> 4 planner: copy each entry-level reveal record onto EVERY
 * page whose body holds that section id (spec 2026-08-30 §2). Ids found on no
 * page are reported in `dropped`, never written. Ids a page already holds in
 * `existing` are skipped, so a re-run after a partial failure never overwrites
 * a record the GM may since have edited. Pure and Foundry-free; junk input is
 * tolerated because this runs during world load.
 *
 * @param {Array<{entryUuid:string, reveals:object, pages:Array<{pageUuid:string, sectionIds:string[], existing:object}>}>} entries
 * @returns {{steps:Array<{pageUuid:string, reveals:object}>, dropped:Array<{entryUuid:string, sectionId:string}>}}
 */
export function planPageKeyedMigration(entries) {
  const steps = [];
  const dropped = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const reveals = entry?.reveals && typeof entry.reveals === "object" ? entry.reveals : {};
    const ids = Object.keys(reveals);
    if (!ids.length) continue;
    const pages = (Array.isArray(entry.pages) ? entry.pages : []).filter((p) => p && typeof p.pageUuid === "string");
    const seen = new Set();
    for (const page of pages) {
      const present = new Set(Array.isArray(page.sectionIds) ? page.sectionIds : []);
      const existing = page.existing && typeof page.existing === "object" ? page.existing : {};
      const out = {};
      for (const id of ids) {
        if (!present.has(id)) continue;
        seen.add(id);
        if (id in existing) continue;
        out[id] = reveals[id];
      }
      if (Object.keys(out).length) steps.push({ pageUuid: page.pageUuid, reveals: out });
    }
    for (const id of ids) if (!seen.has(id)) dropped.push({ entryUuid: entry.entryUuid, sectionId: id });
  }
  return { steps, dropped };
}
