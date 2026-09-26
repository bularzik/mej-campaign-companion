import { describe, it, expect } from "vitest";
import { MENU_FLAGS, openMenuKeys, dismissPatch } from "../scripts/logic/menu-dismiss.mjs";

describe("menu-dismiss", () => {
  it("maps menu keys to HUB_STATE flags", () => {
    expect(MENU_FLAGS).toEqual({ tools: "toolsMenuOpen", type: "typeMenuOpen", sort: "sortMenuOpen" });
  });
  it("lists open menus", () => {
    expect(openMenuKeys({ toolsMenuOpen: true, typeMenuOpen: false, sortMenuOpen: true })).toEqual(["tools", "sort"]);
    expect(openMenuKeys({})).toEqual([]);
    expect(openMenuKeys(null)).toEqual([]);
  });
  it("closes every open menu on an outside click", () => {
    expect(dismissPatch({ typeMenuOpen: true, sortMenuOpen: true })).toEqual({ typeMenuOpen: false, sortMenuOpen: false });
  });
  it("keeps the menu the click was inside", () => {
    expect(dismissPatch({ typeMenuOpen: true }, { insideMenuKey: "type" })).toBeNull();
    expect(dismissPatch({ typeMenuOpen: true, toolsMenuOpen: true }, { insideMenuKey: "tools" })).toEqual({ typeMenuOpen: false });
  });
  it("returns null when nothing is open", () => {
    expect(dismissPatch({ typeMenuOpen: false })).toBeNull();
  });
});
