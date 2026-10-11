// Add-relationship picker (spec 2026-10-10 §3.3): a search box and a list,
// nothing else. Resolves the chosen entry uuid, or null on close.
import { I18N } from "../constants.mjs";

export async function pickPartyTarget({ sourceName, rows }) {
  const esc = foundry.utils.escapeHTML;
  const items = rows.map((r) => `<li class="mej-cc-party-pick" data-uuid="${esc(r.uuid)}" data-name="${esc(r.name.toLocaleLowerCase())}">
      <img src="${esc(r.img)}" alt=""><span class="name">${esc(r.name)}</span><span class="type">${esc(r.typeLabel)}</span></li>`).join("");
  let chosen = null;
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format(`${I18N}.party.pickTitle`, { name: sourceName }) },
    classes: ["mej-cc-party-picker"],
    content: `<input type="search" name="q" placeholder="${esc(game.i18n.localize(`${I18N}.party.search`))}" autofocus>
      <ol class="mej-cc-party-picks">${items}</ol>`,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const search = root.querySelector('input[name="q"]');
      search.addEventListener("input", () => {
        const q = search.value.trim().toLocaleLowerCase();
        for (const li of root.querySelectorAll(".mej-cc-party-pick")) li.hidden = !!q && !li.dataset.name.includes(q);
      });
      for (const li of root.querySelectorAll(".mej-cc-party-pick")) {
        li.addEventListener("click", () => {
          chosen = li.dataset.uuid;
          dialog.close();
        });
      }
    }
  });
  return chosen;
}
