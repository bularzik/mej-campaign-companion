// dataVersion-7 planner (spec 2026-09-06 §4). Pure: the executor in
// campaign-companion.mjs builds the shaped inputs and walks the plan.
//   folders: { id, isCampaign, hasTimeline }
//   entries: { id, uuid, pageCount, strayCampaignPage, inCampaign }

export function planCampaignStructure({ folders = [], entries = [] } = {}) {
  const timelineFor = folders.filter((f) => f.isCampaign && !f.hasTimeline).map((f) => f.id);
  const upgrade = [];
  const skipped = [];
  for (const e of entries) {
    if (!e.strayCampaignPage) continue;
    if (e.inCampaign) { skipped.push({ uuid: e.uuid, reason: "in-campaign" }); continue; }
    if (e.pageCount > 1) { skipped.push({ uuid: e.uuid, reason: "multipage" }); continue; }
    upgrade.push(e.id);
  }
  return { timelineFor, upgrade, skipped };
}
