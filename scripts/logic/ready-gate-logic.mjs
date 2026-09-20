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
