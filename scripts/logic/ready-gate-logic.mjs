// The body of the ready gate's wrapper (spec 2026-09-20-ready-wiring-window
// §3.3), free of Foundry so vitest can pin it: hold the call until the gate
// resolves, then delegate once with the caller's arguments and hand back
// whatever the wrapped function returns (MEJ's openJournalEntry is async on
// every supported build, so callers already await or truthy-test a promise).

/**
 * @param {Promise<unknown>} gate     resolves when the companion's ready-time wiring is done
 * @param {Function} wrapped          the original function, already bound to its `this`
 * @param {unknown[]} args            the caller's arguments, passed through unchanged
 * @returns {Promise<unknown>}
 */
export function gatedCall(gate, wrapped, args) {
  return gate.then(() => wrapped(...args));
}

/**
 * Whether an openJournalEntry argument must wait for the companion's ready
 * wiring: a page whose type is module-prefixed, a JournalEntry holding such a
 * page, or anything that is not a recognisable document (a uuid string, an
 * id, undefined) — held conservatively, since we cannot tell what it will
 * resolve to. Plain MEJ pages and entries never needed the window closed and
 * pass straight through.
 * @param {unknown} doc      the first argument MEJ's openJournalEntry received
 * @param {string} moduleId  the companion's module id (type prefix)
 */
export function needsReadyGate(doc, moduleId) {
  if (!doc || typeof doc !== "object") return true;
  const prefixed = (t) => typeof t === "string" && t.startsWith(`${moduleId}.`);
  if (prefixed(doc.type)) return true;
  const pages = doc.pages?.contents ?? (Array.isArray(doc.pages) ? doc.pages : null);
  if (pages) return pages.some((p) => prefixed(p?.type));
  return false;
}
