import { describe, it, expect } from "vitest";
import { attendeeChoices } from "../scripts/logic/attendee-choices.mjs";

const users = [
  { id: "gm", name: "GM", isGM: true, characterUuid: null },
  { id: "u1", name: "Jeff", isGM: false, characterUuid: "Actor.a" },
  { id: "u2", name: "Glen", isGM: false, characterUuid: "Actor.b" },
  { id: "u3", name: "Sam", isGM: false, characterUuid: "Actor.c" }];
const actorOf = (u) => ({ name: u.slice(6), img: "x.webp" });

describe("attendeeChoices", () => {
  it("first use: contributors' characters, all checked", () => {
    const r = attendeeChoices({ contributorUserIds: ["u1", "u2"], users, current: [], actorOf });
    expect(r.source).toBe("contributors");
    expect(r.rows.map((x) => [x.uuid, x.player, x.checked])).toEqual([["Actor.a", "Jeff", true], ["Actor.b", "Glen", true]]);
  });
  it("existing list wins: a removed character stays unchecked", () => {
    const r = attendeeChoices({ contributorUserIds: ["u1", "u2"], users, current: ["Actor.a"], actorOf });
    expect(r.rows.find((x) => x.uuid === "Actor.b").checked).toBe(false);
  });
  it("guests already attending are kept and checked", () => {
    const r = attendeeChoices({ contributorUserIds: ["u1"], users, current: ["Actor.npc"], actorOf });
    expect(r.rows.at(-1)).toMatchObject({ uuid: "Actor.npc", checked: true });
  });
  it("no contributors falls back to all players", () => {
    expect(attendeeChoices({ contributorUserIds: [], users, current: [], actorOf }).source).toBe("allPlayers");
  });
  it("nobody has a character", () => {
    expect(attendeeChoices({ contributorUserIds: [], users: [users[0]], current: [], actorOf })).toEqual({ rows: [], source: "none" });
  });
});
