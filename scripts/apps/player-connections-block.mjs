// "Player connections" block (spec 2026-10-09 §4.5). Pure DOM, no Foundry
// globals (jsdom-tested): rows reuse MEJ's relationship list markup and
// classes (templates/sheets/partials/sheet-relationships.hbs) so the block
// reads as native - but not MEJ's `.relationships` wrapper, whose
// `.relationships .items-list` is MEJ's own GM drop zone
// (EnhancedJournalSheet.js:835-838).
//
// Every label, secret and author name is client-writable flag data, so it
// is set with textContent only; data-tooltip carries localized UI strings
// only (Foundry may render tooltips as HTML). MEJ's sheet is a
// submitOnChange <form>: the root stops change/input from bubbling into it
// and Enter in a field blurs (saving) instead of submitting it.
import { LABEL_MAX, SECRET_MAX } from "../logic/player-connections.mjs";

export const DEBOUNCE_MS = 400;

// The block sits inside MEJ's sheet <form>. For a non-editable sheet - every
// player's - MEJ's shell runs the subsheet's _toggleDisabled(true) after
// rendering (enhanced-journal.js), which disables every element of that form,
// and it can run again after the block is injected. A form attribute naming
// no element gives a control no form owner, so it is not in form.elements.
export const DETACHED_FORM = "mej-cc-pc-no-form";
const detach = (control) => {
  control.setAttribute("form", DETACHED_FORM);
  return control;
};

export function debounce(fn, ms = DEBOUNCE_MS) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}

export function groupSideViews(entries, { typeLabel }) {
  const groups = new Map();
  for (const entry of entries ?? []) {
    const type = entry.target ? entry.target.type || "unknown" : "defunct";
    if (!groups.has(type)) groups.set(type, { type, name: typeLabel(type), rows: [] });
    groups.get(type).rows.push(entry);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.rows.sort((a, b) => (a.target?.name ?? "").localeCompare(b.target?.name ?? "") || a.view.id.localeCompare(b.view.id));
  }
  return list.sort((a, b) => (a.type === "defunct") - (b.type === "defunct") || String(a.name).localeCompare(String(b.name)));
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(doc, className, tooltip) {
  const i = el(doc, "i", className);
  if (tooltip) i.dataset.tooltip = tooltip;
  return i;
}

function button(doc, className, iconClass, text, tooltip, onClick) {
  const a = detach(el(doc, "button", className));
  a.type = "button"; // real button: Enter/Space activate it; never submits MEJ's form
  const glyph = icon(doc, iconClass);
  glyph.setAttribute("aria-hidden", "true");
  a.append(glyph);
  if (text) a.append(doc.createTextNode(` ${text}`));
  if (tooltip) a.dataset.tooltip = tooltip;
  // An icon-only button is named by its tooltip (localized UI text only).
  if (!text && tooltip) a.setAttribute("aria-label", tooltip);
  a.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return a;
}

function field(doc, className, value, placeholder, maxLength) {
  const input = detach(el(doc, "input", `item-field ${className}`));
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = placeholder ?? "";
  input.maxLength = maxLength;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  });
  return input;
}

function revealButton(doc, view, note, handlers, labels) {
  return button(doc, "item-reveal mej-cc-pc-reveal", note.revealed ? "fas fa-eye-slash" : "fas fa-eye",
    note.revealed ? labels.hide : labels.reveal, labels.revealTooltip, () => handlers.toggleReveal(view, note));
}

/** A note's label + secret: inputs for its writer, text for everyone else. */
function noteFields(doc, view, note, handlers, labels) {
  const cell = el(doc, "div", "item-relationship flexcol");
  if (note?.editable && handlers.saveNote) {
    const label = field(doc, "mej-cc-pc-label-input", note.label, labels.labelPlaceholder, LABEL_MAX);
    const secret = field(doc, "mej-cc-pc-secret-input", note.secret, labels.secretPlaceholder, SECRET_MAX);
    const save = debounce(() => handlers.saveNote(view, { label: label.value, secret: secret.value }));
    label.addEventListener("change", save);
    secret.addEventListener("change", save);
    const secretRow = el(doc, "div", "flexrow");
    secretRow.append(secret);
    if (note.canReveal && handlers.toggleReveal) secretRow.append(revealButton(doc, view, note, handlers, labels));
    cell.append(label, secretRow);
    return cell;
  }
  cell.append(el(doc, "span", "mej-cc-pc-label", note?.label ?? ""));
  if (note?.secretVisible && note.secret) {
    const secretRow = el(doc, "div", "flexrow");
    secretRow.append(el(doc, "em", "mej-cc-pc-secret", note.secret));
    cell.append(secretRow);
  }
  return cell;
}

function buildNote(doc, view, note, handlers, labels) {
  const li = el(doc, "li", "mej-cc-pc-note flexrow");
  li.dataset.writerId = note.writerId;
  li.append(el(doc, "span", "mej-cc-pc-writer", note.authorName || labels.unknownWriter));
  li.append(noteFields(doc, view, note, handlers, labels));
  const controls = el(doc, "div", "item-controls");
  if (note.canDelete && handlers.deleteNote) {
    controls.append(button(doc, "item-delete mej-cc-pc-note-delete", "fas fa-trash", null, labels.deleteNote,
      () => handlers.deleteNote(view, note)));
  }
  li.append(controls);
  return li;
}

function rowControls(doc, view, handlers, labels) {
  const controls = el(doc, "div", "item-controls");
  const shareIcon = view.shared ? "fas fa-users" : "fas fa-lock";
  const shareTip = view.shared ? labels.shared : labels.private;
  if (view.canToggleShare && handlers.toggleShare) {
    controls.append(button(doc, "mej-cc-pc-share", shareIcon, null, shareTip, () => handlers.toggleShare(view)));
  } else {
    const state = icon(doc, `${shareIcon} mej-cc-pc-share-state`, shareTip);
    state.setAttribute("role", "img");
    state.setAttribute("aria-label", shareTip);
    controls.append(state);
  }
  if (view.canDelete && handlers.deleteConnection) {
    controls.append(button(doc, "item-delete mej-cc-pc-delete", "fas fa-trash", null, labels.deleteConnection,
      () => handlers.deleteConnection(view)));
  }
  return controls;
}

function buildRowItems(doc, { view, target }, handlers, labels) {
  const li = el(doc, "li", "item flexrow mej-cc-pc-row");
  if (!target) li.classList.add("defunct", "mej-cc-pc-unresolved");
  li.dataset.connectionId = view.id;
  li.dataset.side = view.side;
  li.dataset.uuid = view.otherUuid ?? "";

  const nameCell = el(doc, "div", "item-name clickable");
  const img = el(doc, "img", "item-image large actor-icon");
  img.setAttribute("src", target?.img || labels.fallbackImg);
  img.alt = "";
  const nameBox = el(doc, "div");
  const link = el(doc, "a", "mej-cc-pc-open", `${view.reverse ? "← " : ""}${target ? target.name : labels.unresolved}`);
  link.setAttribute("href", "#"); // focusable; Enter activates the click
  link.addEventListener("click", (event) => event.preventDefault());
  if (target && handlers.open) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.open(view.otherUuid);
    });
  }
  nameBox.append(link);
  if (view.showAuthor) nameBox.append(el(doc, "div", "mej-cc-pc-author", labels.by(view.authorName)));
  nameCell.append(img, nameBox);
  li.append(nameCell, noteFields(doc, view, view.main, handlers, labels), rowControls(doc, view, handlers, labels));

  const canAddNote = view.canAddNote && !!handlers.saveNote;
  if (!view.others.length && !canAddNote) return [li];
  const notesRow = el(doc, "li", "mej-cc-pc-notes-row");
  notesRow.dataset.connectionId = view.id;
  const notes = el(doc, "ol", "mej-cc-pc-notes");
  for (const note of view.others) notes.append(buildNote(doc, view, note, handlers, labels));
  notesRow.append(notes);
  if (canAddNote) {
    const link = button(doc, "mej-cc-pc-add-note", "fas fa-plus", labels.addNote, null, () => {
      const draft = { writerId: view.viewerId, authorName: labels.you, label: "", secret: "", revealed: false,
        secretVisible: true, editable: true, canReveal: false, canDelete: false };
      const draftLi = buildNote(doc, view, draft, handlers, labels);
      draftLi.classList.add("new");
      notes.append(draftLi);
      link.remove();
      draftLi.querySelector("input")?.focus();
    });
    notesRow.append(link);
  }
  return [li, notesRow];
}

export function buildConnectionsBlock(doc, { groups, canAdd = false, labels }, handlers = {}) {
  const root = el(doc, "section", "mej-cc-player-connections flexcol");
  const head = el(doc, "header", "mej-cc-pc-heading flexrow");
  head.append(el(doc, "h3", null, labels.heading));
  if (canAdd && handlers.add) head.append(button(doc, "mej-cc-pc-add", "fas fa-link", labels.add, null, () => handlers.add()));
  root.append(head);

  const list = el(doc, "div", "items-list");
  const ol = el(doc, "ol", "item-list");
  for (const group of groups ?? []) {
    const groupLi = el(doc, "li");
    const header = el(doc, "header");
    header.append(el(doc, "div", "name", group.name), el(doc, "div", "relationship", labels.relationship));
    groupLi.append(header);
    ol.append(groupLi);
    for (const entry of group.rows) ol.append(...buildRowItems(doc, entry, handlers, labels));
  }
  if (!groups?.length) ol.append(el(doc, "li", "instruction mej-cc-pc-empty", labels.empty));
  list.append(ol);
  root.append(list);

  for (const type of ["change", "input"]) root.addEventListener(type, (event) => event.stopPropagation());
  if (handlers.drop) {
    root.addEventListener("dragover", (event) => {
      event.preventDefault();
      root.classList.add("mej-cc-pc-dropping");
    });
    root.addEventListener("dragleave", () => root.classList.remove("mej-cc-pc-dropping"));
    root.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      root.classList.remove("mej-cc-pc-dropping");
      handlers.drop(event);
    });
  }
  return root;
}
