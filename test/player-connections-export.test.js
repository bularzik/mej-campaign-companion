import { describe, it, expect } from "vitest";
import { normalizeConnections, exportLines } from "../scripts/logic/player-connections.mjs";
import { playerConnectionsHtml, recordSnapshot } from "../scripts/logic/doc-export-snapshot.mjs";

const labels = { by: (n) => `by ${n}`, private: "private", secret: "Secret" };
const n = (authorName, label, secret = "", revealed = false) => ({ authorName, label, secret, revealed });
const rows = normalizeConnections({
  c1: { id: "c1", to: "J.mara", authorId: "u1", authorName: "Dana", shared: true, sides: {
    from: { notes: { u1: n("Dana", "Sister of", "owes her"), u2: n("Jo", "half-sister, actually", "jealous", true) } },
    to: { notes: { u1: n("Dana", "Brother of") } } } },
  c2: { id: "c2", to: "J.bren", authorId: "u2", authorName: "Jo", shared: false, sides: {
    from: { notes: { u2: n("Jo", "Owes money to", "a lot") } } } }
}, "J.ilva");
const items = [{ row: rows[0], side: "from", otherName: "Mara" }, { row: rows[1], side: "from", otherName: "Bren" }];

describe("exportLines (spec §6.2)", () => {
  it("GM with GM content: every connection, private marked, unrevealed secrets included", () => {
    expect(exportLines(items, { includeGM: true, viewerId: "gm", labels })).toEqual([
      { text: "Bren — Owes money to (by Jo) (private)", children: ["Secret: a lot"] },
      { text: "Mara — Sister of (by Dana)", children: ["Secret: owes her", "Jo: \"half-sister, actually\" — Secret: jealous"] }
    ]);
  });
  it("any other export: shared connections, revealed secrets only", () => {
    expect(exportLines(items, { includeGM: false, viewerId: "gm", labels })).toEqual([
      { text: "Mara — Sister of (by Dana)", children: ["Jo: \"half-sister, actually\" — Secret: jealous"] }
    ]);
  });
  it("the exporter's own private connection and own secrets stay in", () => {
    expect(exportLines(items, { includeGM: false, viewerId: "u2", labels })[0]).toEqual(
      { text: "Bren — Owes money to (by Jo)", children: ["Secret: a lot"] });
  });
  it("uses this entry's side", () => {
    expect(exportLines([{ row: rows[0], side: "to", otherName: "Ilva" }], { includeGM: false, viewerId: "gm", labels }))
      .toEqual([{ text: "Ilva — Brother of (by Dana)", children: [] }]);
  });
  it("omits an empty label", () => {
    expect(exportLines([{ row: rows[1], side: "to", otherName: "Ilva" }], { includeGM: true, viewerId: "gm", labels }))
      .toEqual([{ text: "Ilva (by Jo) (private)", children: [] }]);
  });
});

describe("playerConnectionsHtml", () => {
  it("nests notes under each connection and escapes everything", () => {
    const html = playerConnectionsHtml([{ text: "Mara — <b>Sister</b> (by Dana)", children: ["Jo: \"<i>x</i>\""] }], "Player connections");
    expect(html).toBe("<p><strong>Player connections</strong></p><ul><li>Mara — &lt;b&gt;Sister&lt;/b&gt; (by Dana)<ul><li>Jo: \"&lt;i&gt;x&lt;/i&gt;\"</li></ul></li></ul>");
  });
  it("is empty with nothing to list", () => {
    expect(playerConnectionsHtml([], "Player connections")).toBe("");
    expect(playerConnectionsHtml(undefined, "Player connections")).toBe("");
  });
});

describe("recordSnapshot appends player connections after relationships", () => {
  it("MEJ record", () => {
    const row = { uuid: "J.ilva", name: "Ilva", kind: "person", page: { text: { content: "<p>Body</p>" } } };
    const record = recordSnapshot(row, {
      includeGM: false, relationships: [{ name: "Duke", hidden: false }],
      playerConnections: [{ text: "Mara — Sister of (by Dana)", children: [] }],
      labels: { relationships: "Relationships", playerConnections: "Player connections", sessionNumber: "S", campaignDate: "D" }
    });
    expect(record.html.indexOf("Relationships")).toBeLessThan(record.html.indexOf("Player connections"));
    expect(record.html).toContain("<li>Mara — Sister of (by Dana)</li>");
  });
});
