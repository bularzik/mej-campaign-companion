// Inline edit plumbing shared by Relationships-tab injections: debounced
// saves, and keeping a live block (and the caret) across the re-render a
// save causes (Review Focus 2). Moved from the 0.25.0 player-connections
// modules unchanged except the draft selector.

export const DEBOUNCE_MS = 400;

export function debounce(fn, ms = DEBOUNCE_MS) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}

/**
 * Is someone mid-edit in `block`? A saved write re-renders the sheet, which
 * would rebuild the block and drop text being typed in another field or an
 * open add-note draft. Editing = focus in a text field of the block, or a
 * draft holding text its change event has not sent yet. Focus on a button
 * is not editing (a Reveal/Share click should show its result at once).
 * Removal by a re-render is not "leaving": the check after focusout ignores
 * a disconnected block. `onSettled` runs when an edit ends.
 */
export function trackEditing(block, onSettled) {
  let field = null;
  let caret = null;
  const draftOf = (target) => target?.closest?.(".mej-cc-party-line.new");
  const settle = () => setTimeout(() => {
    if (!block.isConnected) return;
    const active = block.ownerDocument.activeElement;
    field = active instanceof HTMLInputElement && block.contains(active) ? active : null;
    if (!tracker.editing()) onSettled();
  }, 0);
  block.addEventListener("focusin", (event) => {
    field = event.target instanceof HTMLInputElement ? event.target : null;
  });
  block.addEventListener("focusout", settle);
  block.addEventListener("input", (event) => {
    // Track the draft's contents, not just "was typed in": text typed and
    // deleted again fires no change event, so a sticky flag would latch.
    const draft = draftOf(event.target);
    if (!draft) return;
    if ([...draft.querySelectorAll("input")].some((i) => i.value.trim() !== "")) draft.dataset.unsent = "";
    else delete draft.dataset.unsent;
  });
  block.addEventListener("change", (event) => {
    delete draftOf(event.target)?.dataset.unsent;
    settle();
  });
  const tracker = {
    editing: () => field !== null || block.querySelector(".mej-cc-party-line.new[data-unsent]") !== null,
    /** After the block is carried into a new render: focus and caret back where they were. */
    restoreFocus() {
      if (!field || !block.contains(field) || block.ownerDocument.activeElement === field) return;
      caret ??= [field.selectionStart, field.selectionEnd];
      field.focus();
      try {
        field.setSelectionRange(...caret);
      } catch {
        // not a selectable input type
      }
      caret = null;
    },
    /** Remember the caret before the field leaves the document. */
    noteCaret() {
      if (field) caret = [field.selectionStart, field.selectionEnd];
    }
  };
  return tracker;
}

/** Carry the live block into a new render only for the same page, mid-edit. */
export function shouldKeepBlock({ prevPageUuid, pageUuid, editing }) {
  return editing === true && typeof prevPageUuid === "string" && prevPageUuid === pageUuid;
}
