// Pure rules for what a seat sees in the Hub header and tab strip (spec
// 2026-10-15 §5.1, §5.6). No Foundry imports so vitest loads it directly.

export const SESSIONS_TAB = Object.freeze({ id: "sessions", icon: "fa-solid fa-dice-d20" });

const PLAYER_ORDER = ["sessions", "index", "timeline", "graph", "search"];

/**
 * A non-GM who can see exactly one campaign gets that campaign's name as a
 * static title and no picker; everyone else gets the picker.
 * @param {{id:string,name:string}[]} campaigns  campaigns visible to this user
 */
export function playerHeaderMode(campaigns, { isGM }) {
  const list = campaigns ?? [];
  if (!isGM && list.length === 1) {
    return { mode: "title", title: list[0].name, campaignId: list[0].id };
  }
  return { mode: "picker", title: null, campaignId: null };
}

/** Picker options per seat: players never see Unfiled or New Campaign. */
export function scopeOptionsForUser(campaigns, current, { isGM, hasUnfiled, labels }) {
  const cur = current ?? "";
  const options = [
    { value: "", label: labels.all, selected: cur === "" },
    ...(campaigns ?? []).map((c) => ({ value: c.id, label: c.name, selected: cur === c.id }))
  ];
  if (isGM && hasUnfiled) options.push({ value: "unfiled", label: labels.unfiled, selected: cur === "unfiled" });
  if (isGM) options.push({ value: "__new", label: labels.newCampaign, selected: false });
  return options;
}

/**
 * Tab order per seat. GM: the input order (Sessions sits wherever the
 * caller placed it). Player: Sessions first, Dashboards only when one is
 * visible to them, Secrets never.
 */
export function playerTabOrder(tabs, { isGM, hasVisibleDashboard }) {
  const byId = new Map((tabs ?? []).map((t) => [t.id, t]));
  if (isGM) return [...(tabs ?? [])];
  const ordered = PLAYER_ORDER.map((id) => (id === "sessions" ? { ...SESSIONS_TAB } : byId.get(id))).filter(Boolean);
  if (hasVisibleDashboard && byId.has("dashboards")) ordered.push(byId.get("dashboards"));
  return ordered;
}

/** The scope the Hub must use: a title locks it, a picker defers to state. */
export function lockedScopeId(headerMode, stateCampaignId) {
  return headerMode?.mode === "title" ? headerMode.campaignId : (stateCampaignId ?? "");
}
