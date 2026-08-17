// scripts/hooks/relationships-ui.mjs
// Relationship reveal overlay (spec §6). GM: audience button(s) per
// relationship row - a single button for a plain hidden row or a plain
// secret label, or two independent buttons (row + secret) when a hidden
// row also carries a secret label, since those are two separately
// revealable audiences. Player: rows revealed to them that MEJ itself
// still filters out of its list (hidden rows) are appended as new list
// entries; a revealed secret label on a row MEJ already shows is inlined
// into that existing row instead of duplicating it. If MEJ's list markup
// (or a specific row within it) can't be located, affected rows fall back
// into a plain "Known connections" list of their own.
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

/**
 * Locate a relationship's row in MEJ's own rendered list. `id`/`uuid` are
 * CSS.escape()'d before going into the attribute selector - the relationships
 * flag is client-writable data (a crafted id/uuid containing a quote would
 * otherwise throw and, for the GM overlay pass, silently abort injection for
 * every remaining row in the same querySelectorAll-driven loop).
 */
function findMejRow(element, id, uuid) {
  return element.querySelector(`.relationships .item[data-id="${CSS.escape(id)}"]`)
    ?? element.querySelector(`.relationships .item[data-uuid="${CSS.escape(uuid)}"]`);
}

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

/** One audience-button <a>, wired to open the dialog for the given kind. */
function relAudienceButton({ tooltip, extraClass }, onClick) {
  const a = document.createElement("a");
  a.className = `mej-cc-rel-audience${extraClass ? ` ${extraClass}` : ""}`;
  a.dataset.tooltip = tooltip;
  a.innerHTML = '<i class="fa-solid fa-user-secret"></i>';
  a.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return a;
}

function injectGm(sheet, element, shellHosted) {
  const page = mejPageOf(sheet);
  if (!page || !element || !game.user.isGM) return;
  const entry = page.parent;
  if (!entry) return;
  const rels = page.flags?.[MEJ_FLAGS]?.relationships ?? {};
  const rows = visibleRelRows(rels, relRevealsOf(entry), { userId: game.user.id, groups: groupsSetting(), isGM: true });
  for (const row of rows) {
    const li = findMejRow(element, row.id, row.uuid)?.querySelector(".item-controls");
    if (!li || li.querySelector(".mej-cc-rel-audience")) continue;

    const openDialog = (kind) => editRelAudience(
      entry, row.id, kind, { label: row.label, secret: row.secretText ?? "" }, sheet, shellHosted
    ).catch((err) => console.error(`${MODULE_ID} | relationship reveal failed`, err));

    if (row.hidden && row.secretText) {
      // A hidden row that also carries a secret label has two independently
      // revealable audiences (row visibility vs. the secret text itself) -
      // one button can only ever edit one of them, so give each its own
      // control and tooltip (Task 7 review, MINOR 1).
      const rowBtn = relAudienceButton(
        { tooltip: game.i18n.localize(`${I18N}.secrets.relRevealTitle`) }, () => openDialog("row")
      );
      const secretBtn = relAudienceButton(
        { tooltip: game.i18n.localize(`${I18N}.secrets.relSecretRevealTitle`), extraClass: "mej-cc-rel-audience-secret" },
        () => openDialog("secret")
      );
      li.prepend(secretBtn);
      li.prepend(rowBtn);
    } else {
      const kind = row.hidden ? "row" : (row.secretText ? "secret" : "row");
      const btn = relAudienceButton({ tooltip: game.i18n.localize(`${I18N}.secrets.audienceButton`) }, () => openDialog(kind));
      li.prepend(btn);
    }
  }
}

/** Build one "known connections" list item for a row not inlined into MEJ's own markup. */
async function renderKnownConnectionLi(r) {
  const esc = foundry.utils.escapeHTML;
  const target = await fromUuid(r.uuid).catch(() => null);
  const name = esc(target?.name ?? r.uuid);
  const uuidAttr = esc(r.uuid);
  const secret = r.secretText ? ` <em class="mej-cc-rel-secret">${esc(r.secretText)}</em>` : "";
  return `<li class="item flexrow mej-cc-rel-revealed" data-uuid="${uuidAttr}">
    <i class="fa-solid fa-eye" data-tooltip="${game.i18n.localize(`${I18N}.secrets.revealedToYou`)}"></i>
    <div class="item-name"><a data-cc-open="${uuidAttr}">${name}</a></div>
    <div class="item-relationship">${esc(r.label)}${secret}</div></li>`;
}

function bindKnownConnectionOpen(frag) {
  frag.querySelectorAll("[data-cc-open]").forEach((a) => a.addEventListener("click", (event) => {
    event.preventDefault();
    (async () => {
      const target = await fromUuid(a.dataset.ccOpen);
      if (target) game.MonksEnhancedJournal.openJournalEntry(target);
    })().catch((err) => console.error(`${MODULE_ID} | rel known-connection open failed`, err));
  }));
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

  // Non-hidden rows with a revealed secret label are ALREADY rendered by
  // MEJ's own getRelationships() (it only ever filters out hidden rows) -
  // inline the secret into that existing row's .item-relationship cell
  // instead of appending a second <li> for the same target entity, which
  // would show it twice (Task 7 review, IMPORTANT 1). Rows whose existing
  // MEJ row can't be located fall back to the "Known connections" list.
  const fallbackExtras = [];
  for (const r of rows.filter((row) => row.secretText && row.hidden === false)) {
    const cell = findMejRow(element, r.id, r.uuid)?.querySelector(".item-relationship");
    if (!cell) { fallbackExtras.push(r); continue; }
    if (cell.querySelector(".mej-cc-rel-secret")) continue; // already inlined on a prior render pass
    // Built via DOM APIs (not innerHTML/insertAdjacentHTML) so r.secretText -
    // client-writable relationships-flag data - can never be parsed as markup,
    // regardless of what it contains.
    const marker = document.createElement("i");
    marker.className = "fa-solid fa-eye";
    marker.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.revealedToYou`);
    const secretEl = document.createElement("em");
    secretEl.className = "mej-cc-rel-secret";
    secretEl.textContent = r.secretText;
    cell.append(" ", marker, " ", secretEl);
  }

  // Hidden rows revealed to this user have nothing existing to inline into
  // (MEJ filtered them out of its list entirely) - these always need a
  // brand-new row.
  const newRows = rows.filter((r) => r.rowRevealedToUser);

  // Guard against duplicate rows accumulating if this element is ever
  // re-injected without a full DOM replacement (MINOR M4) - clear anything
  // we previously appended (both mejList-appended rows and the "Known
  // connections" fallback host's rows) before deciding what to add back.
  element.querySelectorAll(".mej-cc-rel-revealed").forEach((el) => el.remove());

  if (!newRows.length && !fallbackExtras.length) return;

  element.querySelector(":scope .mej-cc-known-connections")?.remove();
  const mejList = element.querySelector(".relationships .items-list ol.item-list");

  let knownConnectionsHost = null;
  const ensureKnownConnectionsHost = () => {
    if (knownConnectionsHost) return knownConnectionsHost;
    // Graceful degradation (spec §6): either MEJ's list markup is missing
    // entirely, or (for fallbackExtras) the specific row couldn't be found
    // within it - render our own list at the sheet's end.
    knownConnectionsHost = document.createElement("ol");
    knownConnectionsHost.className = "mej-cc-known-connections item-list";
    knownConnectionsHost.innerHTML = `<li><header>${game.i18n.localize(`${I18N}.secrets.knownConnections`)}</header></li>`;
    element.appendChild(knownConnectionsHost);
    return knownConnectionsHost;
  };

  if (newRows.length) {
    const host = mejList ?? ensureKnownConnectionsHost();
    const frag = document.createRange().createContextualFragment((await Promise.all(newRows.map(renderKnownConnectionLi))).join(""));
    bindKnownConnectionOpen(frag);
    host.appendChild(frag);
  }

  if (fallbackExtras.length) {
    const host = ensureKnownConnectionsHost();
    const frag = document.createRange().createContextualFragment((await Promise.all(fallbackExtras.map(renderKnownConnectionLi))).join(""));
    bindKnownConnectionOpen(frag);
    host.appendChild(frag);
  }
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
