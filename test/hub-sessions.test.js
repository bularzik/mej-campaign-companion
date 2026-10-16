import { describe, it, expect } from "vitest";
import { recapPreview, sessionRows, visibleAttendeeNames } from "../scripts/logic/hub-sessions.mjs";

const P = "mej-campaign-companion";
const page = (uuid, name, session, recap = "") => ({
  uuid, name, parent: { uuid: `E.${uuid}` }, system: { recap }, flags: { [P]: { session } }
});

describe("recapPreview", () => {
  it("strips tags, collapses whitespace, cuts with an ellipsis", () => {
    expect(recapPreview("<p>The party   found the <b>caravan</b>.</p>\n<p>Boot prints.</p>")).toBe("The party found the caravan. Boot prints.");
    expect(recapPreview("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
  });
  it("empty for empty or non-string", () => {
    expect(recapPreview("")).toBe("");
    expect(recapPreview(null)).toBe("");
  });
  it("turns @UUID[...]{Label} into Label before cutting", () => {
    expect(recapPreview("Met @UUID[JournalEntry.abc]{the Duke} at dawn")).toBe("Met the Duke at dawn");
  });
  it("decodes common entities after stripping tags", () => {
    expect(recapPreview("<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot; &#39;n&#39; &nbsp;more</p>")).toBe("Tom & Jerry <3 \"cheese\" 'n' more");
    expect(recapPreview("&lt;b&gt;not a tag&lt;/b&gt;")).toBe("<b>not a tag</b>");
  });
  it("treats table, list and section tags as separators", () => {
    expect(recapPreview("<table><tr><td>one</td><td>two</td></tr></table><ul><li>a</li></ul><hr><pre>x</pre><section>y</section><ol><li>z</li></ol><th>h</th>"))
      .toBe("one two a x y z h");
  });
});

describe("visibleAttendeeNames", () => {
  const doc = (name, perm) => ({ name, id: name, testUserPermission: () => perm });
  const base = (resolve, isGM = false) => ({ resolve, isGM, user: {}, users: [], playerName: (a) => (a.name === "Aria" ? "Dana" : "") });
  it("does not throw on a compendium index entry (no testUserPermission); hides it from players", () => {
    const entry = { name: "Index Goblin", uuid: "Compendium.x.y" };
    expect(visibleAttendeeNames(["c"], base(() => entry))).toEqual([]);
  });
  it("hides a hidden actor, names a visible one with and without a player", () => {
    const map = { h: doc("Secret", false), a: doc("Aria", true), b: doc("Bram", true) };
    expect(visibleAttendeeNames(["h", "a", "b", "gone"], base((u) => map[u] ?? null))).toEqual(["Aria (Dana)", "Bram"]);
  });
  it("a GM sees everything, including index entries", () => {
    const entry = { name: "Index Goblin" };
    expect(visibleAttendeeNames(["c", "h"], base((u) => (u === "c" ? entry : doc("Secret", false)), true))).toEqual(["Index Goblin", "Secret"]);
  });
});

describe("sessionRows", () => {
  const pages = [
    page("s1", "Session 1", { sessionNumber: 1, campaignDate: { year: 1497, month: 5, day: 14 }, attendees: ["Actor.a"] }, "<p>First night</p>"),
    page("s3", "Session 3", { sessionNumber: 3, campaignDate: null, attendees: [] }),
    page("s2", "Session 2", { sessionNumber: 2, campaignDate: null, attendees: [] })
  ];
  it("sorts newest (highest number) first and maps fields", () => {
    const rows = sessionRows(pages, {
      formatDate: (d) => (d ? `${d.year}-${d.month}-${d.day}` : ""),
      attendeeNames: (uuids) => uuids.map((u) => `name:${u}`)
    });
    expect(rows.map((r) => r.number)).toEqual([3, 2, 1]);
    expect(rows[2]).toEqual({
      uuid: "s1", entryUuid: "E.s1", name: "Session 1", number: 1, worldDate: "1497-5-14",
      attendees: ["name:Actor.a"], recapPreview: "First night", noteCount: 0
    });
    expect(rows[0].worldDate).toBe("");
  });
  it("reads note counts from the map keyed by page uuid (Plan B seam)", () => {
    const rows = sessionRows(pages, { noteCounts: new Map([["s2", 4]]) });
    expect(rows.find((r) => r.uuid === "s2").noteCount).toBe(4);
    expect(rows.find((r) => r.uuid === "s1").noteCount).toBe(0);
  });
  it("malformed flags still produce a row that sorts last (Review Focus 3)", () => {
    const bad = page("sx", "Odd one", { sessionNumber: "seven", campaignDate: null });
    const none = { uuid: "sy", name: "No flag", parent: { uuid: "E.sy" }, system: {}, flags: {} };
    const rows = sessionRows([...pages, bad, none]);
    expect(rows.map((r) => r.uuid)).toEqual(["s3", "s2", "s1", "sy", "sx"]);
    expect(rows.at(-1)).toMatchObject({ number: null, worldDate: "", attendees: [], recapPreview: "" });
  });
  it("empty input gives [] (Review Focus 1)", () => {
    expect(sessionRows([])).toEqual([]);
    expect(sessionRows(undefined)).toEqual([]);
  });
});

describe("sessionRows recapText option", () => {
  const recap = '<p>Open.</p><section class="secret" id="secret-a"><p>Hidden twist</p></section><section class="secret revealed" id="secret-b"><p>Known</p></section>';
  it("stripping option drops unrevealed secrets and keeps revealed ones", async () => {
    const { stripSecretSections } = await import("../scripts/logic/secret-blocks.mjs");
    const [row] = sessionRows([page("U1", "S", { sessionNumber: 0 }, recap)], { recapText: (p) => stripSecretSections(p.system.recap) });
    expect(row.recapPreview).not.toContain("Hidden twist");
    expect(row.recapPreview).toContain("Known");
    expect(row.number).toBe(0);
  });
  it("default reads system.recap unchanged", () => {
    const [row] = sessionRows([page("U1", "S", {}, recap)]);
    expect(row.recapPreview).toContain("Hidden twist");
  });
});
