// scripts/apps/entity-from-selection-dialog.mjs
// Type / name / "link other mentions" prompt (spec 2026-09-22 §3.2).
import { I18N } from "../constants.mjs";
import { ENTITY_TYPES, MAX_NAME_LENGTH } from "../logic/entity-from-selection.mjs";

export function typeOptions(labels, selected, localize) {
  const pick = ENTITY_TYPES.includes(selected) ? selected : "person";
  return ENTITY_TYPES.map((t) => ({ value: t, label: localize(labels?.[t] ?? t), selected: t === pick }));
}

export function readDialogResult(elements) {
  return {
    type: elements.type.value,
    name: elements.name.value.trim(),
    linkOthers: !!elements.linkOthers.checked
  };
}

export async function promptEntityFromSelection({ name, lastType }) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => esc(game.i18n.localize(`${I18N}.entityFromSelection.${k}`));
  const labels = game.MonksEnhancedJournal?.getTypeLabels?.() ?? {};
  const options = typeOptions(labels, lastType, (k) => game.i18n.localize(k))
    .map((o) => `<option value="${o.value}" ${o.selected ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  const content = `
    <div class="form-group"><label>${L("type")}</label><select name="type">${options}</select></div>
    <div class="form-group"><label>${L("name")}</label>
      <input type="text" name="name" value="${esc(name)}" maxlength="${MAX_NAME_LENGTH}" required autofocus></div>
    <div class="form-group"><label><input type="checkbox" name="linkOthers" checked> ${L("linkOthers")}</label></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${I18N}.entityFromSelection.title`) },
    content,
    ok: {
      label: game.i18n.localize(`${I18N}.entityFromSelection.create`),
      callback: (event, button) => readDialogResult(button.form.elements)
    },
    rejectClose: false
  });
  if (!result) return null;
  if (!result.name) {
    ui.notifications.warn(game.i18n.localize(`${I18N}.entityFromSelection.nameRequired`));
    return null;
  }
  return result;
}
