// DOM builders for party relationships inside MEJ's Relationships list
// (spec 2026-10-10 §3.2). Pure DOM: the document is injected, every Foundry
// touch comes in through handlers, all row text goes in via textContent.
//
// MEJ's sheet is a submitOnChange <form>, and for a non-editable sheet -
// every player's - MEJ's shell runs _toggleDisabled(true), which disables the
// form's elements, possibly after this injection. So every party control is
// detached from the form (a form attribute naming no element gives it no
// form owner, so it is neither disabled nor submitted), Enter in a field
// blurs instead of submitting, and isolatePartyEdits keeps party change/input
// events from reaching the form (lessons carried over from 0.25.0's block).
import { debounce } from "./inline-edit.mjs";
import { LABEL_MAX } from "../logic/party-rows.mjs";

export const DETACHED_FORM = "mej-cc-party-no-form";
const detach = (control) => {
  control.setAttribute("form", DETACHED_FORM);
  return control;
};

function el(doc, tag, className, text) {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** `line === null` = the empty "Party: add a label" line under a GM row with no party row yet. */
export function buildPartyLine(doc, { line, editable, labels }, handlers = {}) {
  const root = el(doc, "div", `mej-cc-party-line${line ? "" : " new"}`);
  if (line) {
    root.dataset.notebookUuid = line.notebookUuid;
    root.dataset.key = line.key;
  }
  const icon = el(doc, "i", "fa-solid fa-users mej-cc-party-icon");
  icon.dataset.tooltip = labels.party;
  root.append(icon);
  if (editable) {
    const input = detach(el(doc, "input", "item-field mej-cc-party-input"));
    input.type = "text";
    input.maxLength = LABEL_MAX;
    input.value = line?.label ?? "";
    input.placeholder = labels.addLabel;
    const send = debounce((value) => (line ? handlers.save?.(line, value) : handlers.create?.(value)));
    input.addEventListener("input", () => send(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.blur();
    });
    root.append(input);
  } else {
    root.append(el(doc, "span", "mej-cc-party-label", line?.label ?? ""));
  }
  if (line?.campaignName) root.append(el(doc, "span", "mej-cc-party-campaign", line.campaignName));
  if (line?.editedName) root.append(el(doc, "span", "mej-cc-party-edited", labels.edited(line.editedName)));
  if (line && editable) {
    const del = el(doc, "a", "mej-cc-party-delete");
    del.dataset.tooltip = labels.remove;
    del.setAttribute("aria-label", labels.remove);
    del.setAttribute("href", "#"); // focusable; Enter activates the click
    del.append(el(doc, "i", "fas fa-trash"));
    del.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.remove?.(line);
    });
    root.append(del);
  }
  return root;
}

/** A party-only pair as a MEJ-styled row (sheet-relationships.hbs markup). */
export function buildPartyRow(doc, { line, target, editable, labels }, handlers = {}) {
  const li = el(doc, "li", `item flexrow mej-cc-party-only${target.unresolved ? " mej-cc-party-unresolved" : ""}`);
  li.dataset.uuid = target.uuid;
  const name = el(doc, "div", "item-name clickable");
  const img = el(doc, "img", "item-image large actor-icon");
  img.src = target.img || labels.fallbackImg;
  img.addEventListener("error", () => { img.src = labels.fallbackImg; }, { once: true });
  const a = el(doc, "a", null, target.name);
  a.setAttribute("href", "#");
  a.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.open?.(target.uuid);
  });
  const wrap = el(doc, "div");
  wrap.append(a);
  name.append(img, wrap);
  const rel = el(doc, "div", "item-relationship flexcol");
  rel.append(buildPartyLine(doc, { line, editable, labels }, handlers));
  li.append(name, rel);
  return li;
}

export function buildAddButton(doc, { labels }, onClick) {
  const root = el(doc, "div", "mej-cc-party-add");
  const button = detach(el(doc, "button", null));
  button.type = "button";
  button.append(el(doc, "i", "fa-solid fa-plus"), doc.createTextNode(` ${labels.add}`));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  root.append(button);
  return root;
}

/**
 * Put each line in MEJ's list: under its GM row's relationship cell when one
 * is rendered, else as a party-only row at the end of its type group (a
 * header is created by `groupHeader` when MEJ rendered none).
 */
export function placeLines(list, lines, { gmRowFor, typeOf, groupHeader, buildLine, buildRow }) {
  for (const line of lines) {
    const gmRow = gmRowFor(line.other);
    if (gmRow) {
      (gmRow.querySelector(".item-relationship:last-of-type") ?? gmRow).append(buildLine(line));
      continue;
    }
    const header = groupHeader(typeOf(line.other));
    let anchor = header;
    while (anchor.nextElementSibling && anchor.nextElementSibling.matches("li.item")) anchor = anchor.nextElementSibling;
    anchor.after(buildRow(line));
  }
}

/**
 * Stop change/input from party fields at MEJ's list so its submitOnChange
 * form never sees them. Listeners on the list itself (trackEditing) still
 * run; MEJ's own fields bubble as before. Attach once per list element.
 */
export function isolatePartyEdits(list) {
  for (const type of ["change", "input"]) {
    list.addEventListener(type, (event) => {
      if (event.target?.closest?.(".mej-cc-party-line")) event.stopPropagation();
    });
  }
}

/**
 * Carry a live list into a freshly rendered Relationships tab (Review Focus
 * 2): it replaces MEJ's new `ol.item-list` (or its empty-state instruction),
 * and focus and caret go back where they were. False when the tab has no
 * relationships container.
 */
export function carryList(tab, { list, tracker }) {
  const container = tab.querySelector(".relationships .items-list");
  if (!container) return false;
  if (list.parentElement !== container) {
    tracker.noteCaret();
    for (const stale of container.querySelectorAll(":scope > ol.item-list, :scope > .instruction")) stale.remove();
    container.append(list);
  }
  tracker.restoreFocus();
  return true;
}

/**
 * Which other ends this viewer gets lines for (spec §3.2): LIMITED on the
 * other entry, or - for the GM only - an other end that no longer resolves,
 * so they can see and delete the dead row.
 */
export function lineFilter({ isGM, exists, canLimited }) {
  return (uuid) => (isGM === true && !exists(uuid)) || canLimited(uuid) === true;
}

/** The group a party-only row goes into: MEJ's defunct ("Unknown") group when unresolved. */
export function groupTypeOf(uuid, { exists, typeOf }) {
  return exists(uuid) ? (typeOf(uuid) ?? "") : "defunct";
}

/**
 * The placeholder line's input handler: the first value creates the row
 * (`create(value)` resolves the new line, or null when nothing was made);
 * later values save a label on that line. Calls run one at a time, so text
 * typed while the create is in flight labels the row it made. A throw is
 * logged, never an unhandled rejection.
 */
export function oneShotCreate({ create, save }) {
  let created = null;
  let chain = Promise.resolve();
  return (value) => {
    chain = chain.then(async () => {
      try {
        if (created) await save(created, value);
        else created = (await create(value)) ?? null;
      } catch (err) {
        console.error("mej-campaign-companion | party relationship edit failed", err);
      }
    });
    return chain;
  };
}

/** Whose drop handles an entry dropped on the tab (spec §3.3). */
export function dropMode({ isGM, isOwner, canAdd }) {
  if (isGM || isOwner) return "mej";
  return canAdd ? "party" : "none";
}
