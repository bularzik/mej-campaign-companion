/**
 * Text-node escape for HTML this module composes itself (export snapshot,
 * recap migration). Deliberately minimal - `&`, `<`, `>` only - and free
 * of Foundry imports so pure logic can use it under vitest.
 */
export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
