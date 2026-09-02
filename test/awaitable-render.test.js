import { describe, it, expect } from "vitest";
import { renderAwaitable } from "../scripts/sheets/awaitable-render.mjs";

// Stand-ins for the real chain: Base = the async ApplicationV2 render above
// EnhancedJournalSheet; Mej = EnhancedJournalSheet, whose render() calls
// super.render() but discards the promise (the upstream defect).
class Base {
  async render(options, _options) {
    this.baseCalls = [options, _options];
    return "base-rendered";
  }
}
class Mej extends Base {
  render(options, _options) {
    this.mejCalls = [options, _options];
    super.render(options, _options); // promise discarded, like upstream
  }
}
class Sheet extends Mej {}

describe("renderAwaitable", () => {
  it("delegates to MEJ's own render when the sheet is shell-hosted", () => {
    const sheet = new Sheet();
    sheet.enhancedjournal = {};
    const result = renderAwaitable(sheet, Mej, { force: true }, { a: 1 });
    expect(sheet.mejCalls).toEqual([{ force: true }, { a: 1 }]);
    expect(result).toBeUndefined();
  });

  it("skips EnhancedJournalSheet.render and returns the base promise when standalone", async () => {
    const sheet = new Sheet();
    const result = renderAwaitable(sheet, Mej, { force: true }, { a: 1 });
    expect(sheet.mejCalls).toBeUndefined();
    expect(sheet.baseCalls).toEqual([{ force: true }, { a: 1 }]);
    await expect(result).resolves.toBe("base-rendered");
  });

  it("defaults both option arguments to empty objects", async () => {
    const sheet = new Sheet();
    await renderAwaitable(sheet, Mej);
    expect(sheet.baseCalls).toEqual([{}, {}]);
  });
});
