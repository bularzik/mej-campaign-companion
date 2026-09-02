/**
 * Strip core's Reveal/Hide control from every <secret-block> under `element`.
 *
 * Foundry 14's HTMLSecretBlockElement exposes a `revealable` property whose
 * setter hides the button (and stays false across re-upgrades). Foundry 13's
 * element (client/applications/elements/secret-block.mjs) has no such
 * property: its connectedCallback plants <button class="reveal"> as the first
 * child of the <section class="secret"> exactly once (guarded by a private
 * #button field, so removing the DOM node does not get it re-added). Both
 * branches are exercised by test/secret-reveal-toggles.test.js; the caller
 * (hooks/secrets-ui.mjs) decides WHO loses the control and re-runs this after
 * every render pass, because enrichment wraps sections in fresh elements.
 */
export function suppressRevealToggles(element) {
  if (!element) return;
  for (const block of element.querySelectorAll("secret-block")) {
    if ("revealable" in block) block.revealable = false;
    else block.querySelector(":scope > .secret > button.reveal")?.remove();
  }
}
