import { describe, it, expect } from "vitest";
import { EDITOR_FIELDS, fieldsToStrip } from "../scripts/logic/session-submit.mjs";

describe("fieldsToStrip", () => {
  it("keeps only the editor that raised the submit", () => {
    expect(fieldsToStrip("system.recap")).toEqual(["system.gmNotes"]);
    expect(fieldsToStrip("system.gmNotes")).toEqual(["system.recap"]);
  });
  it("strips every editor field when the submit came from anything else", () => {
    expect(fieldsToStrip("flags.mej-campaign-companion.session.sessionNumber")).toEqual(EDITOR_FIELDS);
    expect(fieldsToStrip(null)).toEqual(EDITOR_FIELDS);
    expect(fieldsToStrip(undefined)).toEqual(EDITOR_FIELDS);
  });
});
