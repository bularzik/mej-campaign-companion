import { describe, it, expect } from "vitest";
import { linkOptionLabel } from "../scripts/apps/link-to-entity-dialog.mjs";

describe("linkOptionLabel", () => {
  it("joins name, type and folder with em dashes", () => {
    expect(linkOptionLabel({ name: "Vex", type: "Person", folder: "Act I" })).toBe("Vex — Person — Act I");
  });
  it("omits an empty folder or type", () => {
    expect(linkOptionLabel({ name: "Vex", type: "Person", folder: "" })).toBe("Vex — Person");
    expect(linkOptionLabel({ name: "Vex", type: "", folder: "" })).toBe("Vex");
  });
});
