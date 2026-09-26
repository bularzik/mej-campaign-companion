// Actor picker for the Person <-> Actor link (spec 2026-09-25 §3): world
// actors the user can at least observe, filterable by name. A player cannot
// pick (and so copy the biography of) an actor they cannot see.
import { I18N } from "../constants.mjs";

const FALLBACK_IMG = "icons/svg/mystery-man.svg";

export function pickerRows(actors, canObserve, filter = "") {
  const q = String(filter).trim().toLocaleLowerCase();
  return [...actors]
    .filter((a) => canObserve(a))
    .filter((a) => !q || String(a.name ?? "").toLocaleLowerCase().includes(q))
    .map((a) => ({ id: a.id, name: String(a.name ?? ""), img: a.img || FALLBACK_IMG }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** Resolves the chosen world Actor, or null on cancel / nothing to pick. */
export async function pickActor({ currentId = null } = {}) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => game.i18n.localize(`${I18N}.actorLink.${k}`);
  const rows = pickerRows(game.actors, (a) => a.testUserPermission(game.user, "OBSERVER"));
  if (!rows.length) {
    ui.notifications.info(L("noActors"));
    return null;
  }
  const items = rows.map((r) => `
    <li class="mej-cc-actor-pick${r.id === currentId ? " current" : ""}" data-actor-id="${esc(r.id)}"
        data-name="${esc(r.name.toLocaleLowerCase())}" tabindex="0">
      <img src="${esc(r.img)}" alt=""><span>${esc(r.name)}</span>
    </li>`).join("");
  const content = `
    <input type="search" name="filter" placeholder="${esc(L("filter"))}" autofocus>
    <ul class="mej-cc-actor-picker">${items}</ul>`;
  let picked = null;
  await foundry.applications.api.DialogV2.wait({
    window: { title: L("pickerTitle") },
    content,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const choose = (li) => { picked = li.dataset.actorId; dialog.close(); };
      root.querySelectorAll(".mej-cc-actor-pick").forEach((li) => {
        li.addEventListener("click", () => choose(li));
        li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); choose(li); } });
      });
      root.querySelector("input[name='filter']")?.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLocaleLowerCase();
        root.querySelectorAll(".mej-cc-actor-pick").forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); });
      });
    }
  });
  return picked ? game.actors.get(picked) ?? null : null;
}
