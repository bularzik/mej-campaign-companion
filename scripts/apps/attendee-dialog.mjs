// "Who's playing tonight?" (spec 2026-10-19 §4.6): a checklist of the
// campaign's player characters plus a search that adds any other Actor.
import { MODULE_ID, I18N } from "../constants.mjs";
import { attendeeChoices, attendeeButtonKey } from "../logic/attendee-choices.mjs";
import { campaignOf, campaignFlagOf, contributorsOf } from "../logic/campaigns.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { patchSessionRegions } from "../sheets/session-regions.mjs";

const FALLBACK_IMG = "icons/svg/mystery-man.svg";
const SEARCH_LIMIT = 10;

const L = (key, data) => (data ? game.i18n.format(`${I18N}.session.${key}`, data) : game.i18n.localize(`${I18N}.session.${key}`));

function rowHtml(row) {
  const esc = foundry.utils.escapeHTML;
  return `<li class="mej-cc-attendee-choice" data-uuid="${esc(row.uuid)}">
    <label>
      <input type="checkbox" name="attendee" value="${esc(row.uuid)}"${row.checked ? " checked" : ""}>
      <img src="${esc(row.img || FALLBACK_IMG)}" alt="">
      <span class="mej-cc-attendee-choice-name">${esc(row.name)}</span>
      ${row.player ? `<span class="mej-cc-attendee-choice-player">${esc(row.player)}</span>` : ""}
    </label>
  </li>`;
}

/** Open the checklist for a Session sheet; resolves once the dialog closes. */
export async function openAttendeeDialog(sheet) {
  const esc = foundry.utils.escapeHTML;
  const document = sheet.document;
  const current = sessionData(document).attendees;
  const flag = campaignFlagOf(campaignOf(document));
  const users = [...game.users].map((u) => ({ id: u.id, name: u.name, isGM: u.isGM, characterUuid: u.character?.uuid ?? null }));
  const { rows, source } = attendeeChoices({
    contributorUserIds: contributorsOf(flag).userIds,
    users, current,
    actorOf: (uuid) => { const a = fromUuidSync(uuid); return a ? { name: a.name, img: a.img } : null; }
  });
  const note = source === "allPlayers" ? L("attendeesAllPlayers") : source === "none" ? L("attendeesNone") : "";
  const content = `
    ${note ? `<p class="notes mej-cc-attendee-note">${esc(note)}</p>` : ""}
    <ul class="mej-cc-attendee-choices">${rows.map(rowHtml).join("")}</ul>
    <div class="mej-cc-attendee-search">
      <input type="search" name="attendee-search" autocomplete="off" placeholder="${esc(L("attendeesSearch"))}">
      <ul class="mej-cc-attendee-results"></ul>
    </div>`;
  const startedEmpty = current.length === 0;
  const label = (n) => L(attendeeButtonKey({ startedEmpty, n }), { n });

  await foundry.applications.api.DialogV2.wait({
    window: { title: L("attendeesTitle") },
    content,
    rejectClose: false,
    buttons: [
      {
        action: "confirm", icon: "fa-solid fa-check", default: true,
        label: label(rows.filter((r) => r.checked).length),
        callback: async (event, button, dialog) => {
          const uuids = [...dialog.element.querySelectorAll("input[name='attendee']:checked")].map((i) => i.value);
          await document.update({ [`flags.${MODULE_ID}.session.attendees`]: uuids });
          patchSessionRegions(sheet);
        }
      },
      { action: "cancel", icon: "fa-solid fa-xmark", label: game.i18n.localize("Cancel") }
    ],
    render: (event, dialog) => {
      const root = dialog.element;
      const confirmBtn = root.querySelector("button[data-action='confirm']");
      const list = root.querySelector(".mej-cc-attendee-choices");
      const results = root.querySelector(".mej-cc-attendee-results");
      const sync = () => {
        if (!startedEmpty || !confirmBtn) return;
        const n = list.querySelectorAll("input[name='attendee']:checked").length;
        confirmBtn.lastChild.textContent = ` ${label(n)}`;
      };
      list.addEventListener("change", sync);
      sync();
      root.querySelector("input[name='attendee-search']")?.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLocaleLowerCase();
        const listed = new Set([...list.querySelectorAll("input[name='attendee']")].map((i) => i.value));
        const hits = q
          ? game.actors.contents
            .filter((a) => !listed.has(a.uuid) && String(a.name ?? "").toLocaleLowerCase().includes(q) && a.testUserPermission(game.user, "OBSERVER"))
            .sort((x, y) => x.name.localeCompare(y.name))
            .slice(0, SEARCH_LIMIT)
          : [];
        results.innerHTML = hits.map((a) => `<li class="mej-cc-attendee-result" data-uuid="${esc(a.uuid)}" tabindex="0"><img src="${esc(a.img || FALLBACK_IMG)}" alt=""><span>${esc(a.name)}</span></li>`).join("");
      });
      const pick = (li) => {
        const actor = fromUuidSync(li.dataset.uuid);
        if (!actor) return;
        list.insertAdjacentHTML("beforeend", rowHtml({ uuid: actor.uuid, name: actor.name, img: actor.img, player: "", checked: true }));
        li.remove();
        sync();
      };
      results.addEventListener("click", (ev) => { const li = ev.target.closest(".mej-cc-attendee-result"); if (li) pick(li); });
      results.addEventListener("keydown", (ev) => {
        const li = ev.target.closest(".mej-cc-attendee-result");
        if (li && ev.key === "Enter") { ev.preventDefault(); pick(li); }
      });
      // Enter in the search box must not submit the dialog.
      root.querySelector("input[name='attendee-search']")?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });
    }
  });
}
