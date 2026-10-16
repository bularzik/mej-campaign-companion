import { describe, it, expect } from "vitest";
import { notesWriters } from "../scripts/logic/notes-access.mjs";
import { isNotesEntry, isLinkableEntity } from "../scripts/logic/campaigns.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const campaign = (ownershipDefault) => ({ flags: { [P]: { campaign: { ownershipDefault } } } });
const users = [{ id: "gm", isGM: true }, { id: "u1", isGM: false }, { id: "u2", isGM: false }];

describe("notesWriters (owner decision §11.1)", () => {
  it("every non-GM at observer baseline", () => {
    expect(notesWriters(campaign("observer"), users, LEVELS)).toEqual(["u1", "u2"]);
    expect(notesWriters(campaign("owner"), users, LEVELS)).toEqual(["u1", "u2"]);
  });
  it("nobody at a none baseline", () => {
    expect(notesWriters(campaign("none"), users, LEVELS)).toEqual([]);
  });
  it("missing flag reads as observer (ownershipLevelFor default)", () => {
    expect(notesWriters({ flags: {} }, users, LEVELS)).toEqual(["u1", "u2"]);
  });
});

describe("isNotesEntry", () => {
  it("matches the flag and is never a linkable entity", () => {
    const e = { flags: { [P]: { notesEntry: true } } };
    expect(isNotesEntry(e)).toBe(true);
    expect(isNotesEntry({ flags: {} })).toBe(false);
    expect(isLinkableEntity(e, () => "person")).toBe(false);
  });
});
