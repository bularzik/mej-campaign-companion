import { describe, it, expect } from "vitest";
import { parseManifest } from "../tests/vendor/check-vendor.mjs";

describe("parseManifest", () => {
  const hash = "5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9";
  it("carries the package claim when the third field is present", () => {
    expect(parseManifest(`${hash}  mammoth.browser.min.js  mammoth@1.12.0`))
      .toEqual([{ expected: hash, file: "mammoth.browser.min.js", pkg: "mammoth@1.12.0" }]);
  });
  it("accepts a two-field line and reports no package claim", () => {
    expect(parseManifest(`${hash}  d3-force.esm.js`))
      .toEqual([{ expected: hash, file: "d3-force.esm.js", pkg: null }]);
  });
  it("skips blank lines and comments", () => {
    expect(parseManifest(`# a note\n\n${hash}  docx.iife.js\n`)).toHaveLength(1);
  });
  it("rejects a line it cannot parse", () => {
    expect(() => parseManifest("not-a-checksum  file.js")).toThrow(/cannot parse line/);
  });
});
