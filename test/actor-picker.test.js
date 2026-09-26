import { describe, it, expect, vi } from "vitest";
vi.mock("../scripts/constants.mjs", () => ({ I18N: "MEJCampaignCompanion" }));
import { pickerRows } from "../scripts/apps/actor-picker-dialog.mjs";

const actors = [
  { id: "b", name: "Boren", img: "b.png", seen: true },
  { id: "a", name: "aldric", img: "", seen: true },
  { id: "h", name: "Hidden", img: "h.png", seen: false }
];
const canObserve = (a) => a.seen;

describe("pickerRows", () => {
  it("lists observable actors sorted by name, with a fallback image", () => {
    expect(pickerRows(actors, canObserve)).toEqual([
      { id: "a", name: "aldric", img: "icons/svg/mystery-man.svg" },
      { id: "b", name: "Boren", img: "b.png" }
    ]);
  });
  it("filters case-insensitively on name", () => {
    expect(pickerRows(actors, canObserve, "  BOR ").map((r) => r.id)).toEqual(["b"]);
    expect(pickerRows(actors, canObserve, "hid")).toEqual([]);
  });
});
