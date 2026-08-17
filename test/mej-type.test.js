// test/mej-type.test.js
import { describe, it, expect } from "vitest";
import { isSessionDoc, mejTypeWith } from "../scripts/logic/mej-type.mjs";

const sessionPage = { type: "mej-campaign-companion.session" };
const textPage = { type: "text" };
const entryWith = (...pages) => ({ pages: { contents: pages } });

describe("isSessionDoc", () => {
  it("is true for a page carrying the native session subtype", () => {
    expect(isSessionDoc(sessionPage)).toBe(true);
  });

  it("is false for a plain text page", () => {
    expect(isSessionDoc(textPage)).toBe(false);
  });

  it("is true for a single-page entry whose only page is a session", () => {
    expect(isSessionDoc(entryWith(sessionPage))).toBe(true);
  });

  it("is false for a multi-page entry, matching MEJ's single-page rule", () => {
    expect(isSessionDoc(entryWith(sessionPage, textPage))).toBe(false);
  });

  it("is false for an entry with no pages, null, and undefined", () => {
    expect(isSessionDoc(entryWith())).toBe(false);
    expect(isSessionDoc(null)).toBe(false);
    expect(isSessionDoc(undefined)).toBe(false);
  });
});

describe("mejTypeWith", () => {
  it("reports a session even when the injected getMEJType says false (stock MEJ)", () => {
    expect(mejTypeWith(sessionPage, () => false)).toBe("session");
  });

  it("delegates to getMEJType for MEJ's own built-in types", () => {
    expect(mejTypeWith(textPage, () => "person")).toBe("person");
  });

  it("returns false when the document is neither a session nor MEJ-typed", () => {
    expect(mejTypeWith(textPage, () => false)).toBe(false);
  });

  it("returns false rather than throwing when getMEJType is missing", () => {
    expect(mejTypeWith(textPage, undefined)).toBe(false);
  });

  it("normalizes a getMEJType undefined return to false", () => {
    expect(mejTypeWith(textPage, () => undefined)).toBe(false);
  });
});

describe("stock-MEJ regression: a Session must not read as untyped", () => {
  // Stock MEJ's getMEJType validates the monks-enhanced-journal.type flag
  // against its own registry, which has no "session" key, so it returns
  // false even when the flag is present. Every consumer that gates on the
  // type would drop the page. mejTypeWith must not.
  const stockGetMEJType = () => false;
  const sessionPageWithFlag = {
    type: "mej-campaign-companion.session",
    flags: { "monks-enhanced-journal": { type: "session" } }
  };
  const scrubbedSessionPage = { type: "mej-campaign-companion.session", flags: {} };

  it("survives stock MEJ returning false", () => {
    expect(mejTypeWith(sessionPageWithFlag, stockGetMEJType)).toBe("session");
  });

  it("survives stock MEJ having scrubbed the flag entirely", () => {
    expect(mejTypeWith(scrubbedSessionPage, stockGetMEJType)).toBe("session");
  });
});
