// scripts/apps/group-dialog.mjs
// The player-group add/edit prompt (moved out of CampaignHubPage so the
// campaign settings dialog can use it too, spec 2026-10-15 §5.7) and a small
// manager listing groups with add/edit/delete.
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeGroups, upsertGroup, deleteGroup, groupsSummary } from "../logic/player-groups.mjs";
import { confirmDelete } from "./confirm-delete.mjs";

/** Name + member-checkbox dialog; returns {name, members} or null. */
export async function promptGroup(initial = {}, { titleKey }) {
  const esc = foundry.utils.escapeHTML;
  const players = game.users.filter((u) => !u.isGM);
  const memberRows = players.map((u) =>
    `<label class="mej-cc-audience-row"><input type="checkbox" name="member-${esc(u.id)}"${(initial.members ?? []).includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`
  ).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: titleKey },
    content: `<div class="form-group"><label>${game.i18n.localize(`${I18N}.secrets.groupName`)}</label>
        <input type="text" name="name" value="${esc(initial.name ?? "")}" required autofocus></div>
      <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.groupMembers`)}</legend>${memberRows}</fieldset>`,
    ok: {
      label: `${I18N}.hub.save`,
      callback: (event, button) => {
        const name = button.form.elements.name.value.trim();
        if (!name) return null;
        return { name, members: players.filter((u) => button.form.elements[`member-${u.id}`]?.checked).map((u) => u.id) };
      }
    },
    rejectClose: false
  });
}

function groupsListHtml() {
  const esc = foundry.utils.escapeHTML;
  const rows = groupsSummary(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), game.users.contents);
  if (!rows.length) return `<p class="notes">${esc(game.i18n.localize(`${I18N}.secrets.noGroupsYet`))}</p>`;
  return `<ul class="mej-cc-groups-manager">${rows.map((g) => `
    <li data-group-id="${esc(g.id)}"><strong>${esc(g.name)}</strong> — ${esc(g.memberNames)}
      <a data-manage="edit" data-tooltip="${esc(game.i18n.localize(`${I18N}.secrets.editGroup`))}"><i class="fa-solid fa-pen"></i></a>
      <a data-manage="delete" data-tooltip="${esc(game.i18n.localize(`${I18N}.confirmDelete.group.title`))}"><i class="fa-solid fa-trash"></i></a></li>`).join("")}</ul>`;
}

/** Modal list of groups with add/edit/delete; resolves when closed. */
export async function openGroupsManager() {
  if (!game.user.isGM) return;
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.secrets.groupsManagerTitle`) },
    content: `<div class="mej-cc-groups-manager-body">${groupsListHtml()}</div>
      <button type="button" data-manage="add"><i class="fa-solid fa-plus"></i> ${game.i18n.localize(`${I18N}.secrets.addGroup`)}</button>`,
    buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const body = root.querySelector(".mej-cc-groups-manager-body");
      const repaint = () => { body.innerHTML = groupsListHtml(); };
      root.addEventListener("click", async (ev) => {
        const el = ev.target.closest("[data-manage]");
        if (!el) return;
        ev.preventDefault();
        const id = el.closest("[data-group-id]")?.dataset.groupId;
        const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
        if (el.dataset.manage === "add") {
          const result = await promptGroup({}, { titleKey: `${I18N}.secrets.addGroup` });
          if (result) await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, upsertGroup(groups, { id: foundry.utils.randomID(8), ...result }));
        } else if (el.dataset.manage === "edit") {
          const existing = groups.find((g) => g.id === id);
          const result = existing && await promptGroup(existing, { titleKey: `${I18N}.secrets.editGroup` });
          if (result) await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, upsertGroup(groups, { id, ...result }));
        } else if (el.dataset.manage === "delete") {
          const existing = groups.find((g) => g.id === id);
          if (existing && await confirmDelete({ kind: "group", name: existing.name })) {
            await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, deleteGroup(groups, id));
          }
        }
        repaint();
      });
    }
  });
}
