// @CampaignQuery[<grammar string>] text enricher (spec §5): embeds a live,
// permission-filtered query result list inside any journal page. Enrichment
// runs per-viewer at render time, so permission filtering is inherent and
// results refresh whenever the page re-renders (documented limitation: not
// push-live mid-view). Failures render an inert placeholder, never break
// the page (spec §6).
import { MODULE_ID, I18N } from "../constants.mjs";
import { runQueryAll } from "../search/live-index.mjs";

function resultAnchor(hit) {
  // Standard content-link anchor: Foundry's global click handler resolves
  // data-uuid, and MEJ's own document-open interception routes MEJ-typed
  // entries into the enhanced browser - identical behavior to a plain
  // @UUID link on the page.
  const a = document.createElement("a");
  a.classList.add("content-link");
  a.draggable = true;
  a.dataset.link = "";
  a.dataset.uuid = hit.uuid;
  a.dataset.type = "JournalEntry";
  a.dataset.tooltip = hit.name;
  const icon = document.createElement("i");
  icon.className = "fas fa-book-open";
  a.append(icon, ` ${hit.name}`);
  return a;
}

async function enrichCampaignQuery(match) {
  const container = document.createElement("div");
  container.classList.add("mej-cc-query-embed");
  const query = match[1].trim();
  try {
    const hits = runQueryAll(query);
    const header = document.createElement("div");
    header.classList.add("mej-cc-query-embed-header");
    header.textContent = query;
    container.append(header);
    const list = document.createElement("ul");
    for (const hit of hits) {
      const li = document.createElement("li");
      li.append(resultAnchor(hit));
      list.append(li);
    }
    if (!hits.length) {
      const empty = document.createElement("li");
      empty.classList.add("mej-cc-knowledge-empty");
      empty.textContent = game.i18n.localize(`${I18N}.enricher.noResults`);
      list.append(empty);
    }
    container.append(list);
  } catch (err) {
    console.debug(`${MODULE_ID} | @CampaignQuery enrichment failed`, err);
    container.classList.add("mej-cc-query-embed-error");
    container.textContent = game.i18n.localize(`${I18N}.enricher.badQuery`);
  }
  return container;
}

export function registerQueryEnricher() {
  CONFIG.TextEditor.enrichers.push({
    pattern: /@CampaignQuery\[([^\]]+)\]/g,
    enricher: enrichCampaignQuery
  });
}
