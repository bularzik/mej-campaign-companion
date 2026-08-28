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
