// Pure rules for what a seat sees in the Hub header and tab strip (spec
// 2026-10-15 §5.1, §5.6). No Foundry imports so vitest loads it directly.

export const SESSIONS_TAB = Object.freeze({ id: "sessions", icon: "fa-solid fa-dice-d20" });

const PLAYER_ORDER = ["sessions", "index", "timeline", "graph", "search"];

/**
 * A non-GM who can see exactly one campaign gets that campaign's name as a
 * static title and no picker; one who can see none gets `emptyTitle` as the
 * title (spec 2026-10-16 §2); everyone else gets the picker.
 * @param {{id:string,name:string}[]} campaigns  campaigns visible to this user
 */
export function playerHeaderMode(campaigns, { isGM, emptyTitle = null }) {
  const list = campaigns ?? [];
  if (!isGM && list.length === 0) return { mode: "title", title: emptyTitle, campaignId: null };
  if (!isGM && list.length === 1) return { mode: "title", title: list[0].name, campaignId: list[0].id };
  return { mode: "picker", title: null, campaignId: null };
}

/**
 * Picker options per seat. A player sees exactly the campaigns visible to
 * them, in the Hub's order - no All, no Unfiled, no New Campaign (spec
 * 2026-10-16 §2). GM options are unchanged.
 */
export function scopeOptionsForUser(campaigns, current, { isGM, hasUnfiled, labels }) {
  const cur = current ?? "";
  const campaignOptions = (campaigns ?? []).map((c) => ({ value: c.id, label: c.name, selected: cur === c.id }));
  if (!isGM) return campaignOptions;
  const options = [{ value: "", label: labels.all, selected: cur === "" }, ...campaignOptions];
  if (hasUnfiled) options.push({ value: "unfiled", label: labels.unfiled, selected: cur === "unfiled" });
  options.push({ value: "__new", label: labels.newCampaign, selected: false });
  return options;
}

/**
 * A player's effective scope: the remembered campaign while it is still
 * visible to them, else the first visible one, else "" (nothing to show).
 * Never All, never Unfiled (spec 2026-10-16 §2).
 */
export function playerScopeId(campaigns, remembered) {
  const list = campaigns ?? [];
  if (remembered && list.some((c) => c.id === remembered)) return remembered;
  return list[0]?.id ?? "";
}

/**
 * Scope search hits for a seat. `within` (a Set of campaign ids; players
 * only) bounds the universe to campaigns the seat can see, so spillover
 * counts only hits the seat could actually reach; `scopeId` null means
 * "every campaign in the universe" (a player's search-all). With no
 * `within` this is the GM rule searchScoped always applied.
 */
export function restrictHits(hits, { scopeId, within = null, campaignIdOf }) {
  const universe = within ? hits.filter((h) => within.has(campaignIdOf(h))) : hits;
  if (!scopeId) return { hits: universe, spillover: 0 };
  const inScope = universe.filter((h) => campaignIdOf(h) === scopeId);
  return { hits: inScope, spillover: universe.length - inScope.length };
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

/**
 * The Hub's opening tab. A stored tab (MEJ's per-user pagestate) always
 * wins; otherwise a player lands on Sessions while a session is open in the
 * campaign the Hub shows. A GM keeps the fallback.
 */
export function defaultHubTab({ isGM, storedTab, hasOpenSession, fallback }) {
  if (storedTab) return storedTab;
  if (!isGM && hasOpenSession) return SESSIONS_TAB.id;
  return fallback;
}

/** The scope the Hub must use: a title locks it, a picker defers to state. */
export function lockedScopeId(headerMode, stateCampaignId) {
  return headerMode?.mode === "title" ? headerMode.campaignId : (stateCampaignId ?? "");
}
