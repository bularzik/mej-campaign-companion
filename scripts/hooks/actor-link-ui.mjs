// Link / Change / Unlink controls in the MEJ Person header (spec 2026-09-25
// §3). Same two render hooks as knowledge-ui.mjs; idempotent per render.
// Changing a link unsets the old flag first: setFlag merges objects, and a
// merged-in stale `pack` would turn the new link into a "compendium" one.
import { MODULE_ID, I18N } from "../constants.mjs";
import { MEJ_FLAG, isPersonPage, linkedActorId, actorFlagFor, linkChanged } from "../logic/actor-link.mjs";
import { pickActor } from "../apps/actor-picker-dialog.mjs";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null; // jQuery
}

async function linkTo(page) {
  const actor = await pickActor({ currentId: linkedActorId(page) });
  if (!actor) return;
  if (page.getFlag(MEJ_FLAG, "actor") !== undefined) await page.unsetFlag(MEJ_FLAG, "actor");
  await page.setFlag(MEJ_FLAG, "actor", actorFlagFor(actor));
}

async function unlink(page) {
  const L = (k) => game.i18n.localize(`${I18N}.actorLink.${k}`);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: L("unlinkTitle") },
    content: `<p>${foundry.utils.escapeHTML(L("unlinkConfirm"))}</p>`,
    rejectClose: false
  });
  if (ok) await page.unsetFlag(MEJ_FLAG, "actor");
}

function button(kind, icon, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mej-cc-actor-btn";
  b.dataset.mejCcActor = kind;
  b.dataset.tooltip = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<i class="${icon}" inert></i>`;
  b.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick().catch((err) => console.error(`${MODULE_ID} | actor link ${kind} failed`, err));
  });
  return b;
}

/** (Re)builds wrap's buttons from page's current link state. Idempotent. */
function renderControls(wrap, page) {
  const L = (k) => game.i18n.localize(`${I18N}.actorLink.${k}`);
  wrap.replaceChildren();
  if (page.getFlag(MEJ_FLAG, "actor") === undefined) {
    wrap.append(button("link", "fa-solid fa-user-plus", L("link"), () => linkTo(page)));
  } else {
    wrap.append(
      button("change", "fa-solid fa-user-pen", L("change"), () => linkTo(page)),
      button("unlink", "fa-solid fa-link-slash", L("unlink"), () => unlink(page))
    );
  }
}

export function injectActorControls(sheet, root) {
  const page = sheet?.document;
  if (!root || !(page instanceof JournalEntryPage) || !isPersonPage(page) || !sheet.isEditable) return;
  const h1 = root.querySelector(".journal-sheet-header .header-name");
  if (!h1) return;
  h1.querySelector(".mej-cc-actor-link")?.remove();
  const wrap = document.createElement("span");
  wrap.className = "mej-cc-actor-link";
  wrap.dataset.pageUuid = page.uuid;
  renderControls(wrap, page);
  h1.append(wrap);
}

export function registerActorLinkUi() {
  const inject = (sheet, html) => {
    try { injectActorControls(sheet, asElement(html)); }
    catch (err) { console.error(`${MODULE_ID} | actor link controls failed`, err); }
  };
  Hooks.on("renderJournalPageSheet", inject);
  Hooks.on("renderEnhancedJournalSheet", inject);

  // MEJ (Foundry 13) does not re-render the Person's subsheet for a
  // flag-only update - confirmed live: unlink's own updateJournalEntryPage
  // fires, but neither renderJournalPageSheet nor renderEnhancedJournalSheet
  // follows it, so the two render hooks above never re-run and the header
  // is left showing stale Change/Unlink buttons after a real unlink (Task 4
  // report, 2026-09-25). The link path never hit this because its sync
  // follow-up always touches src/text/notes too, which IS enough to make
  // MEJ re-render. Patch the already-rendered header(s) for this page
  // directly rather than depend on MEJ's own render cycle.
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    try {
      if (!isPersonPage(page) || !linkChanged(changes)) return;
      document.querySelectorAll(".mej-cc-actor-link").forEach((wrap) => {
        if (wrap.dataset.pageUuid === page.uuid) renderControls(wrap, page);
      });
    } catch (err) {
      console.error(`${MODULE_ID} | actor link controls failed`, err);
    }
  });
}
