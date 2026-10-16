import { describe, it, expect } from "vitest";
import { ORDER_MODES, buildTimelineRows, buildOrderOptions } from "../scripts/logic/hub-timeline.mjs";

describe("buildTimelineRows", () => {
  const tps = [
    { id: "a", label: "A", sort: 200000, createdAt: 2 },
    { id: "b", label: "B", sort: 100000, createdAt: 1 }
  ];
  const formatDate = () => "date";
  const resolveRowLinks = (tp) => [{ id: `link-${tp.id}` }];

  it("orders by the requested mode and stamps position/canEdit/dateLabel/links", () => {
    const rows = buildTimelineRows(tps, "manual", { canEdit: true, formatDate, resolveRowLinks });
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({ position: 0, canEdit: true, dateLabel: "date" });
    expect(rows[0].links).toEqual([{ id: "link-b" }]);
    expect(rows[1].position).toBe(1);
  });

  it("respects canEdit: false for read-only viewers", () => {
    const rows = buildTimelineRows(tps, "manual", { canEdit: false, formatDate, resolveRowLinks });
    expect(rows.every((r) => r.canEdit === false)).toBe(true);
  });

  it("handles an empty timeline", () => {
    expect(buildTimelineRows([], "manual", { canEdit: true, formatDate, resolveRowLinks })).toEqual([]);
    expect(buildTimelineRows(undefined, "manual", { canEdit: true, formatDate, resolveRowLinks })).toEqual([]);
  });
});

describe("buildOrderOptions", () => {
  const labelOf = (m) => `L:${m}`;

  it("lists every order mode with resolved labels", () => {
    const items = buildOrderOptions("manual", labelOf);
    expect(items.map((i) => i.value)).toEqual(ORDER_MODES);
    expect(items.map((i) => i.label)).toEqual(ORDER_MODES.map((m) => `L:${m}`));
  });

  it("marks only the current mode selected", () => {
    const items = buildOrderOptions("campaign", labelOf);
    expect(items.filter((i) => i.selected).map((i) => i.value)).toEqual(["campaign"]);
  });
});

describe("buildTimelineRows with notes (spec item 16)", () => {
  const tps = [
    { id: "a", label: "A", sort: 1, createdAt: 1, campaignDate: { year: 1490, month: 0, day: 5 } },
    { id: "b", label: "B", sort: 2, createdAt: 2, campaignDate: { year: 1490, month: 2, day: 1 } }
  ];
  const notes = [
    { id: "n1", text: "between", authorName: "Jo", at: 9, worldDate: { year: 1490, month: 1, day: 1 } },
    { id: "n2", text: "undated", authorName: "Jo", at: 10, worldDate: null }
  ];
  const opts = { canEdit: true, formatDate: () => "d", resolveRowLinks: () => [], notes, formatNoteDate: () => "nd" };
  it("interleaves dated notes in Campaign Date order and skips undated ones", () => {
    const rows = buildTimelineRows(tps, "campaign", opts);
    expect(rows.map((r) => r.id)).toEqual(["a", "n1", "b"]);
    expect(rows[1]).toMatchObject({ kind: "note", label: "between", dateLabel: "nd", authorName: "Jo", canEdit: false, position: -1 });
  });
  it("ignores notes in manual and created order", () => {
    expect(buildTimelineRows(tps, "manual", opts).map((r) => r.id)).toEqual(["a", "b"]);
    expect(buildTimelineRows(tps, "created", opts).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("skips partially dated notes (NaN sort key)", () => {
    const partial = [{ id: "p", text: "x", worldDate: { year: 1490 } }];
    expect(buildTimelineRows(tps, "campaign", { ...opts, notes: partial }).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
