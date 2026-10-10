import { describe, it, expect } from "vitest";
import { partyWriters, partyReaders, notebookOwnership, ownershipUpdate } from "../scripts/logic/party-access.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const campaign = (contributors, ownershipDefault = "observer") => ({ flags: { [P]: { campaign: { ownershipDefault, contributors } } } });
const users = [
  { id: "gm", isGM: true }, { id: "u1", isGM: false }, { id: "u2", isGM: false }, { id: "u3", isGM: false }
];

describe("partyWriters (today: Contributors)", () => {
  it("direct users and group members, never GMs, deduped", () => {
    const c = campaign({ userIds: ["u1", "gm"], groupIds: ["g1"] });
    const groups = [{ id: "g1", name: "Red", members: ["u1", "u2"] }];
    expect(partyWriters(c, users, groups).sort()).toEqual(["u1", "u2"]);
  });
  it("no contributors: nobody", () => expect(partyWriters(campaign(undefined), users, [])).toEqual([]));
});

describe("partyReaders (today: the baseline)", () => {
  it("maps the campaign baseline", () => {
    expect(partyReaders(campaign({}, "observer"), LEVELS)).toBe(2);
    expect(partyReaders(campaign({}, "none"), LEVELS)).toBe(0);
  });
});

describe("notebookOwnership", () => {
  const opts = { defaultLevel: 2, writerIds: ["u1"], ownerLevel: 3 };
  it("sets default and writers", () => {
    expect(notebookOwnership({ default: 0 }, opts)).toEqual({ default: 2, u1: 3 });
  });
  it("removes a writer who left (Review Focus 5) but keeps GM entries", () => {
    const current = { default: 2, u1: 3, u2: 3, gm: 3 };
    expect(notebookOwnership(current, { ...opts, gmIds: ["gm"] })).toEqual({ default: 2, u1: 3, gm: 3 });
  });
  it("null when already right", () => {
    expect(notebookOwnership({ default: 2, u1: 3 }, opts)).toBeNull();
  });
});

describe("ownershipUpdate", () => {
  it("removes dropped writers with a -= key and sets changed keys", () => {
    expect(ownershipUpdate({ default: 2, u1: 3, u2: 3 }, { default: 2, u2: 3, u3: 3 })).toEqual({
      "ownership.-=u1": null, "ownership.u3": 3
    });
  });
  it("is null when unchanged or next is null", () => {
    expect(ownershipUpdate({ default: 2, u1: 3 }, { default: 2, u1: 3 })).toBeNull();
    expect(ownershipUpdate({ default: 2 }, null)).toBeNull();
  });
});
