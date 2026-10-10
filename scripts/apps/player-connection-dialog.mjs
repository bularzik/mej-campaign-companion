// Add-connection dialog (spec 2026-10-09 §4.6), modelled on
// actor-picker-dialog.mjs: a filterable list of eligible targets, this
// side's label (required) and secret, the other side's optional label and
// secret, and Share with party (checked). Saving runs `save(values)`; the
// dialog stays open with its values unless that reports ok (spec §7 - no
// GM, timeout and rejections keep it open). While a save is in flight the
// submit button is disabled and further submits are ignored, so a
// double-click cannot add twice. Later edits happen inline in the block.
import { MODULE_ID, I18N } from "../constants.mjs";
import { LABEL_MAX, SECRET_MAX } from "../logic/player-connections.mjs";

export function readConnectionForm(form) {
  const value = (name) => (form.querySelector(`[name="${name}"]`)?.value ?? "").trim();
  return {
    to: value("target"),
    fromNote: { label: value("fromLabel"), secret: value("fromSecret") },
    toNote: { label: value("toLabel"), secret: value("toSecret") },
    shared: form.querySelector('[name="shared"]')?.checked === true
  };
}

/**
 * The submit action: validates, runs `save` once at a time and closes on ok.
 * Resolves true when saved. A rejection re-enables the button for a retry.
 */
export function createSubmitHandler({ form, button, save, close, warn, messages }) {
  let pending = false;
  return async () => {
    if (pending) return false;
    const values = readConnectionForm(form);
    if (!values.to) return void warn(messages.pickTarget) ?? false;
    if (!values.fromNote.label) return void warn(messages.labelRequired) ?? false;
    pending = true;
    button.disabled = true;
    let saved = false;
    try {
      const outcome = await save(values);
      saved = outcome?.ok === true;
      if (saved) await close();
    } finally {
      pending = false;
      if (!saved) button.disabled = false;
    }
    return saved;
  };
}

/** Resolves true once saved, false on cancel. */
export async function promptPlayerConnection({ sourceName = "", rows = [], targetUuid = null, save = async () => ({ ok: false, reason: "failed" }) } = {}) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => esc(game.i18n.localize(`${I18N}.playerConnections.dialog.${k}`));
  const items = rows.map((r) => `
    <li class="mej-cc-pc-target${r.uuid === targetUuid ? " selected" : ""}" data-uuid="${esc(r.uuid)}"
        data-name="${esc(String(r.name).toLocaleLowerCase())}" tabindex="0">
      <img src="${esc(r.img)}" alt=""><span class="mej-cc-pc-target-name">${esc(r.name)}</span>
      <span class="mej-cc-pc-target-type">${esc(r.typeLabel ?? "")}</span>
    </li>`).join("");
  const content = `
    <div class="mej-cc-pc-dialog">
      <p class="mej-cc-pc-source">${esc(game.i18n.format(`${I18N}.playerConnections.dialog.from`, { name: sourceName }))}</p>
      <input type="search" name="filter" placeholder="${L("filter")}" autocomplete="off">
      <ul class="mej-cc-pc-targets">${items}</ul>
      <input type="hidden" name="target" value="${esc(targetUuid ?? "")}">
      <div class="form-group"><label>${L("fromLabel")}</label><input type="text" name="fromLabel" maxlength="${LABEL_MAX}"></div>
      <div class="form-group"><label>${L("fromSecret")}</label><input type="text" name="fromSecret" maxlength="${SECRET_MAX}"></div>
      <div class="form-group"><label>${L("toLabel")}</label><input type="text" name="toLabel" maxlength="${LABEL_MAX}"></div>
      <div class="form-group"><label>${L("toSecret")}</label><input type="text" name="toSecret" maxlength="${SECRET_MAX}"></div>
      <div class="form-group"><label><input type="checkbox" name="shared" checked> ${L("shared")}</label></div>
      <button type="button" class="mej-cc-pc-save"><i class="fas fa-link"></i> ${L("save")}</button>
    </div>`;
  let saved = false;
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.playerConnections.dialog.title`) },
    content,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const form = root.querySelector(".mej-cc-pc-dialog");
      const hidden = root.querySelector("input[name='target']");
      const pick = (li) => {
        root.querySelectorAll(".mej-cc-pc-target.selected").forEach((x) => x.classList.remove("selected"));
        li.classList.add("selected");
        hidden.value = li.dataset.uuid;
      };
      root.querySelectorAll(".mej-cc-pc-target").forEach((li) => {
        li.addEventListener("click", () => pick(li));
        li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); pick(li); } });
      });
      root.querySelector("input[name='filter']")?.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLocaleLowerCase();
        root.querySelectorAll(".mej-cc-pc-target").forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); });
      });
      // Enter would submit DialogV2's form through its default (Cancel) button.
      form.querySelectorAll("input").forEach((input) => input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") ev.preventDefault();
      }));
      const submit = createSubmitHandler({
        form,
        button: root.querySelector(".mej-cc-pc-save"),
        save,
        close: async () => { saved = true; await dialog.close(); },
        warn: (message) => ui.notifications.warn(message),
        messages: {
          pickTarget: game.i18n.localize(`${I18N}.playerConnections.dialog.pickTarget`),
          labelRequired: game.i18n.localize(`${I18N}.playerConnections.dialog.labelRequired`)
        }
      });
      root.querySelector(".mej-cc-pc-save").addEventListener("click", () => submit()
        .catch((err) => console.error(`${MODULE_ID} | add connection failed`, err)));
      root.querySelector(".mej-cc-pc-target.selected")?.scrollIntoView?.({ block: "nearest" });
    }
  });
  return saved;
}
