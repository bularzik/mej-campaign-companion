// scripts/apps/link-to-entity-dialog.mjs
// Picker for "Link to Entity" when several entities share the selected name
// (spec 2026-09-26 §4.4).
import { I18N } from "../constants.mjs";

export function linkOptionLabel({ name, type, folder }) {
  return [name, type, folder].filter(Boolean).join(" — ");
}

/** options: {uuid, name, type, folder}[] → the chosen uuid, or null on cancel/close. */
export async function promptLinkTarget(options) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => game.i18n.localize(`${I18N}.entityFromSelection.${k}`);
  const opts = options.map((o) => `<option value="${esc(o.uuid)}">${esc(linkOptionLabel(o))}</option>`).join("");
  const content = `<div class="form-group"><label>${esc(L("pickLabel"))}</label><select name="entity">${opts}</select></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: L("pickTitle") },
    content,
    ok: { label: L("link"), callback: (event, button) => button.form.elements.entity.value },
    rejectClose: false
  });
  return result || null;
}
