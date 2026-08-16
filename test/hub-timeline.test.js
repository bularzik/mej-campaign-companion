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
