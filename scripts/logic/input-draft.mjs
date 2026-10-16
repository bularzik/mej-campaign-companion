// Keep a note capture box's typed text, focus and caret across re-renders
// (whole-branch finding 2). Every other author's note re-renders the Hub and
// the Session view on every client, which replaces the box; the draft is kept
// as the user types and put back into the fresh box. Filing the note clears
// it, so a successful capture still empties the box. No Foundry imports.

/** Drafts by key, module-wide: a sheet instance does not survive every re-render. */
export const NOTE_DRAFTS = new Map();

export const tonightDraftKey = () => "hub-tonight";
export const sessionDraftKey = (uuid) => `session:${uuid}`;

function remember(input, drafts, key) {
  const value = input.value ?? "";
  if (!value) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, { value, focused: true, start: input.selectionStart ?? value.length, end: input.selectionEnd ?? value.length });
}

/** Record the box's value, focus and caret as the user works in it. */
export function trackDraft(input, drafts, key) {
  if (!input || !key) return;
  const save = () => remember(input, drafts, key);
  for (const type of ["input", "keyup", "mouseup", "select", "focus"]) input.addEventListener(type, save);
  input.addEventListener("blur", () => {
    // A render removes the focused box without the user leaving it: only a blur
    // that leaves the box still in the document means the user moved on.
    queueMicrotask(() => {
      const draft = drafts.get(key);
      if (draft && input.isConnected) draft.focused = false;
    });
  });
}

/** Put a kept draft into a freshly rendered box; refocus and restore the caret if the user was in it. */
export function restoreDraft(input, drafts, key) {
  const draft = input && key ? drafts.get(key) : null;
  if (!draft) return false;
  input.value = draft.value;
  if (draft.focused) {
    const doc = input.ownerDocument;
    const active = doc?.activeElement;
    // Never steal focus from another field the user has moved into meanwhile.
    if (active && active !== doc.body && active !== input && active.isConnected) return true;
    input.focus();
    const max = draft.value.length;
    input.setSelectionRange?.(Math.min(draft.start, max), Math.min(draft.end, max));
  }
  return true;
}

export function clearDraft(drafts, key) {
  drafts.delete(key);
}

/** Keep `value` as the draft (a capture that failed after the box was cleared). */
export function keepDraft(drafts, key, value) {
  if (!value) return drafts.delete(key);
  drafts.set(key, { value, focused: true, start: value.length, end: value.length });
}
