import { describe, it, expect } from "vitest";
import { attendeePlayerName, attendeeUuidsFor } from "../scripts/logic/attendee-player.mjs";

const actor = { id: "a1", testUserPermission: (u, level) => u.owns === true && level === "OWNER" };

describe("attendeePlayerName", () => {
  it("prefers the non-GM user whose assigned character is the actor", () => {
    const users = [
      { name: "Owner", isGM: false, owns: true, character: null },
      { name: "Assigned", isGM: false, owns: false, character: { id: "a1" } }
    ];
    expect(attendeePlayerName(actor, users)).toBe("Assigned");
  });
  it("falls back to the first non-GM owner", () => {
    const users = [
      { name: "GM", isGM: true, owns: true, character: null },
      { name: "Owner", isGM: false, owns: true, character: null }
    ];
    expect(attendeePlayerName(actor, users)).toBe("Owner");
  });
  it("is empty for an actor no player owns, or a missing actor", () => {
    expect(attendeePlayerName(actor, [{ name: "GM", isGM: true, owns: true }])).toBe("");
    expect(attendeePlayerName(null, [])).toBe("");
  });
});

describe("attendeeUuidsFor (spec item 9: attendees default to connected players)", () => {
  const users = [
    { id: "gm", isGM: true, character: { uuid: "Actor.gmpc" } },
    { id: "u1", isGM: false, character: { uuid: "Actor.a1" } },
    { id: "u2", isGM: false, character: null },
    { id: "u3", isGM: false, character: { uuid: "Actor.a3" } }
  ];
  it("adds each non-GM user's character once, keeping what is already there", () => {
    expect(attendeeUuidsFor(users, ["Actor.a3", "Actor.npc"])).toEqual(["Actor.a3", "Actor.npc", "Actor.a1"]);
  });
  it("empty inputs", () => {
    expect(attendeeUuidsFor([], [])).toEqual([]);
    expect(attendeeUuidsFor(users, undefined)).toEqual(["Actor.a1", "Actor.a3"]);
  });
});
