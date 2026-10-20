import { describe, it, expect } from "vitest";
import { saveTriggers, shouldPatchRegions } from "../scripts/logic/editor-save.mjs";

describe("saveTriggers", () => {
  it.each(["blur", "tabchange", "close", "interval", "visibilityhidden"])("%s saves", (e) => expect(saveTriggers(e)).toBe(true));
  it("typing alone does not save", () => expect(saveTriggers("input")).toBe(false));
});

describe("shouldPatchRegions", () => {
  it("a Session sheet is patched in place", () => expect(shouldPatchRegions({ isSessionSheet: true })).toBe(true));
  it("other views re-render", () => expect(shouldPatchRegions({ isSessionSheet: false })).toBe(false));
  it("an active editor makes no difference on a Session sheet", () =>
    expect(shouldPatchRegions({ isSessionSheet: true, editorActive: true })).toBe(true));
});
