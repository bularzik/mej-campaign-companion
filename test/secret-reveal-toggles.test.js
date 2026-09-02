import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { suppressRevealToggles } from "../scripts/logic/secret-reveal-toggles.mjs";

// v13 core (client/applications/elements/secret-block.mjs) has no
// `revealable` property: connectedCallback unconditionally plants
// <button class="reveal"> as the first child of the <section class="secret">.
const V13_MARKUP = `
  <secret-block>
    <section class="secret" id="s1">
      <button type="button" class="reveal">Reveal</button>
      <p>hidden text</p>
    </section>
  </secret-block>`;

function v13Body() {
  return new JSDOM(`<body><article>${V13_MARKUP}</article></body>`).window.document.body;
}

describe("suppressRevealToggles", () => {
  it("removes the v13 reveal button when the element has no revealable property", () => {
    const body = v13Body();
    suppressRevealToggles(body.querySelector("article"));
    expect(body.querySelector("secret-block button.reveal")).toBeNull();
    expect(body.querySelector("secret-block p").textContent).toBe("hidden text");
  });

  it("sets revealable=false and keeps the button on a v14-style element", () => {
    const body = v13Body();
    const block = body.querySelector("secret-block");
    let stored = true;
    Object.defineProperty(block, "revealable", {
      get: () => stored,
      set: (v) => { stored = v; },
      configurable: true
    });
    suppressRevealToggles(body.querySelector("article"));
    expect(stored).toBe(false);
    expect(body.querySelector("secret-block button.reveal")).not.toBeNull();
  });

  it("is a no-op on a null element and on markup without secret blocks", () => {
    expect(() => suppressRevealToggles(null)).not.toThrow();
    const body = new JSDOM("<body><article><p>plain</p></article></body>").window.document.body;
    suppressRevealToggles(body.querySelector("article"));
    expect(body.querySelector("article").innerHTML).toBe("<p>plain</p>");
  });
});
