import { describe, it, expect } from "vitest";
import { formatConsoleError, appendStack } from "../tests/e2e/helpers/console-format.mjs";

describe("formatConsoleError", () => {
  it("returns the bare text when there is no location", () => {
    expect(formatConsoleError({ text: "boom" })).toBe("boom");
    expect(formatConsoleError({ text: "boom", url: "" })).toBe("boom");
  });

  it("appends the source location on its own line", () => {
    expect(formatConsoleError({ text: "boom", url: "http://x/modules/m/a.mjs", line: 12, column: 3 }))
      .toBe("boom\n    at http://x/modules/m/a.mjs:12:3");
  });

  it("omits line and column when they are not numbers", () => {
    expect(formatConsoleError({ text: "boom", url: "http://x/a.mjs" })).toBe("boom\n    at http://x/a.mjs");
  });

  it("uses the stack when one is given, and does not repeat a location the stack already carries", () => {
    const stack = "TypeError: boom\n    at f (http://x/a.mjs:1:2)";
    expect(formatConsoleError({ text: "boom", url: "http://x/a.mjs", line: 1, column: 2, stack })).toBe(stack);
  });
});

describe("appendStack", () => {
  it("appends a stack below an existing entry once", () => {
    expect(appendStack("boom\n    at http://x/a.mjs:1:2", "TypeError: boom\n    at f (http://x/a.mjs:1:2)"))
      .toBe("boom\n    at http://x/a.mjs:1:2\nTypeError: boom\n    at f (http://x/a.mjs:1:2)");
  });

  it("leaves the entry alone for an empty stack or one already present", () => {
    expect(appendStack("boom", "")).toBe("boom");
    expect(appendStack("boom", null)).toBe("boom");
    expect(appendStack("boom\nTypeError: boom\n    at f", "TypeError: boom\n    at f")).toBe("boom\nTypeError: boom\n    at f");
  });
});
