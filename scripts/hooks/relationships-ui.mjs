// scripts/hooks/relationships-ui.mjs
// Relationship reveal overlay (spec §6). GM: an audience button per
// relationship row (row visibility for hidden rows; secret-label audience
// when the row has a secret). Player: rows revealed to them are appended
// to MEJ's relationships list (MEJ itself filtered them out server of
// nothing — the raw flag is client-readable, soft model); if MEJ's list
// markup is missing, rows fall back into the knowledge panel area as a
// plain "Known connections" list.
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { visibleRelRows } from "../logic/rel-reveals.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";
const REL_FLAG = "relReveals";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null;
}

function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  return game.MonksEnhancedJournal?.getMEJType?.(doc) ? doc : null;
}

const groupsSetting = () => normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
const relRevealsOf = (entry) => entry?.getFlag?.(MODULE_ID, REL_FLAG) ?? {};

async function editRelAudience(entry, relId, kind, { label, secret }, sheet, shellHosted) {
  if (!game.user.isGM) return;
  const groups = groupsSetting();
  const previous = normalizeAudience(relRevealsOf(entry)[relId]?.[kind]);
  const titleKey = kind === "row" ? "relRevealTitle" : "relSecretRevealTitle";
  const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.${titleKey}`), audience: previous, groups });
  if (!audience) return;
  await entry.update({ [`flags.${MODULE_ID}.${REL_FLAG}.${relId}.${kind}`]: audience });
  const esc = foundry.utils.escapeHTML;
  const text = kind === "secret" ? secret : label;
  await sendRevealWhisper({
    audience, previousAudience: previous, groups,
    html: `<p>${esc(text || entry.name)}</p>`, entryUuid: entry.uuid, entryName: entry.name
  });
  // secrets-ui.mjs's updateJournalEntry hook already reloads the shell for
  // relReveals changes (it fires locally on every client, including this
  // one) - an explicit shell refresh here would double-reload it. Popped-
  // out sheets are not shell-hosted, so that hook's shell-only check never
  // covers them; refresh those directly (same convention as secrets-ui.mjs's
  // editAudience).
  if (!shellHosted) sheet.render?.({ parts: ["main"] });
}

function injectGm(sheet, element, shellHosted) {
  const page = mejPageOf(sheet);
  if (!page || !element || !game.user.isGM) return;
  const entry = page.parent;
  if (!entry) return;
  const rels = page.flags?.[MEJ_FLAGS]?.relationships ?? {};
  const rows = visibleRelRows(rels, relRevealsOf(entry), { userId: game.user.id, groups: groupsSetting(), isGM: true });
  for (const row of rows) {
    const li = element.querySelector(`.relationships .item[data-id="${row.id}"] .item-controls`)
      ?? element.querySelector(`.relationships .item[data-uuid="${row.uuid}"] .item-controls`);
    if (!li || li.querySelector(".mej-cc-rel-audience")) continue;
    const a = document.createElement("a");
    a.className = "mej-cc-rel-audience";
    a.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.audienceButton`);
    a.innerHTML = '<i class="fa-solid fa-user-secret"></i>';
    a.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const kind = row.hidden ? "row" : (row.secretText ? "secret" : "row");
      editRelAudience(entry, row.id, kind, { label: row.label, secret: row.secretText ?? "" }, sheet, shellHosted)
        .catch((err) => console.error(`${MODULE_ID} | relationship reveal failed`, err));
    });
    li.prepend(a);
  }
}

async function injectPlayer(sheet, element) {
  if (game.user.isGM) return;
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  const entry = page.parent;
  const rows = visibleRelRows(
    page.flags?.[MEJ_FLAGS]?.relationships ?? {},
    relRevealsOf(entry), { userId: game.user.id, groups: groupsSetting(), isGM: false }
  );
  const extras = rows.filter((r) => r.rowRevealedToUser || (r.secretText && r.hidden === false));
  if (!extras.length) return;
  element.querySelector(":scope .mej-cc-known-connections")?.remove();
  const list = element.querySelector(".relationships .items-list ol.item-list");
  const esc = foundry.utils.escapeHTML;
  const rowHtml = await Promise.all(extras.map(async (r) => {
    const target = await fromUuid(r.uuid).catch(() => null);
    const name = esc(target?.name ?? r.uuid);
    const secret = r.secretText ? ` <em class="mej-cc-rel-secret">${esc(r.secretText)}</em>` : "";
    return `<li class="item flexrow mej-cc-rel-revealed" data-uuid="${r.uuid}">
      <i class="fa-solid fa-eye" data-tooltip="${game.i18n.localize(`${I18N}.secrets.revealedToYou`)}"></i>
      <div class="item-name"><a data-cc-open="${r.uuid}">${name}</a></div>
      <div class="item-relationship">${esc(r.label)}${secret}</div></li>`;
  }));
  let host = list;
  if (!host) {
    // Graceful degradation (spec §6): MEJ's markup changed — render our own list at the sheet's end.
    host = document.createElement("ol");
    host.className = "mej-cc-known-connections item-list";
    host.innerHTML = `<li><header>${game.i18n.localize(`${I18N}.secrets.knownConnections`)}</header></li>`;
    element.appendChild(host);
  }
  const frag = document.createRange().createContextualFragment(rowHtml.join(""));
  frag.querySelectorAll("[data-cc-open]").forEach((a) => a.addEventListener("click", (event) => {
    event.preventDefault();
    (async () => {
      const target = await fromUuid(a.dataset.ccOpen);
      if (target) game.MonksEnhancedJournal.openJournalEntry(target);
    })().catch((err) => console.error(`${MODULE_ID} | rel known-connection open failed`, err));
  }));
  host.appendChild(frag);
}

export function registerRelationshipsUi() {
  const inject = (sheet, html, shellHosted) => {
    const element = asElement(html);
    try { injectGm(sheet, element, shellHosted); } catch (err) { console.error(`${MODULE_ID} | rel GM overlay failed`, err); }
    injectPlayer(sheet, element).catch((err) => console.error(`${MODULE_ID} | rel player inject failed`, err));
  };
  Hooks.on("renderJournalPageSheet", (sheet, html) => inject(sheet, html, true));
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => inject(sheet, html, false));
}
