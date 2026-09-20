// Pure formatting for trackConsoleErrors' entries. Entries stay STRINGS -
// three stock-gate assertions split them with `.includes(MODULE_ID)` - but a
// string that carries the source location and, when we can get it, the
// stack, is the difference between "TypeError: sheet.getData is not a
// function" (eight tests, one sweep, no clue which document) and a line that
// names the file. Tested in test/e2e-console-format.test.js.

/**
 * @param {{ text: string, url?: string, line?: number, column?: number, stack?: string|null }} m
 * @returns {string}
 */
export function formatConsoleError({ text, url, line, column, stack }) {
  if (stack) return stack;
  if (!url) return text;
  let where = url;
  if (Number.isFinite(line)) {
    where += `:${line}`;
    if (Number.isFinite(column)) where += `:${column}`;
  }
  return `${text}\n    at ${where}`;
}

/**
 * Append a stack that arrived after the entry was recorded (console
 * arguments are JSHandles; reading an Error's stack is asynchronous).
 * Idempotent: an empty stack or one the entry already contains changes nothing.
 */
export function appendStack(entry, stack) {
  if (!stack || entry.includes(stack)) return entry;
  return `${entry}\n${stack}`;
}
