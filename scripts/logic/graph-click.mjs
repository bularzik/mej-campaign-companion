// Click/double-click arbitration for graph nodes. A plain click focuses, but a
// focus re-renders the pane and would swallow a following dblclick, so the
// focus is deferred and cancelled by the second click / dblclick / any redraw.

// Long enough for a slow double-click (OS defaults reach 500 ms; most people
// land well under 400) while still feeling responsive for a single click.
export const FOCUS_DELAY_MS = 400;

export function createClickGate({ onFocus, onOpen, delay = FOCUS_DELAY_MS }) {
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  return {
    cancel,
    click(uuid, { detail = 1, modifier = false } = {}) {
      cancel();
      if (!onFocus || modifier) { onOpen(uuid); return; }
      if (detail >= 2) return; // part of a double-click; dblclick opens
      timer = setTimeout(() => { timer = null; onFocus(uuid); }, delay);
    },
    dblclick(uuid) {
      cancel();
      onOpen(uuid);
    }
  };
}
