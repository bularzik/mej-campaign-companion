import { describe, it, expect } from "vitest";
import os from "node:os";
import { resolveTarget, generationOf } from "../tests/e2e/helpers/target.mjs";

const HOME = os.homedir();

describe("resolveTarget", () => {
  it("defaults to the v14 target with today's values when FOUNDRY_TARGET is unset", () => {
    const t = resolveTarget({});
    expect(t).toEqual({
      name: "v14",
      generation: 14,
      url: "http://localhost:30000",
      world: "world-a",
      app: `${HOME}/FoundryVTT-14/FoundryVTT-Node-14.365`,
      data: `${HOME}/FoundryVTT-14/Data`,
      node: "/opt/homebrew/bin/node",
      moduleLink: `${HOME}/FoundryVTT-14/Data/Data/modules/mej-campaign-companion`,
      mainCheckout: `${HOME}/Claude/Projects/mej-campaign-companion`
    });
  });

  it("resolves the v13 preset", () => {
    const t = resolveTarget({ FOUNDRY_TARGET: "v13" });
    expect(t).toEqual({
      name: "v13",
      generation: 13,
      url: "http://localhost:30013",
      world: "world-b",
      app: `${HOME}/FoundryVTT/FoundryVTT-Node-13.351`,
      data: `${HOME}/FoundryVTT/Data`,
      node: "/opt/homebrew/opt/node@22/bin/node",
      moduleLink: `${HOME}/FoundryVTT/Data/Data/modules/mej-campaign-companion`,
      mainCheckout: `${HOME}/Claude/Projects/mej-campaign-companion`
    });
  });

  it("lets explicit variables override the preset, and derives moduleLink from an overridden data dir", () => {
    const t = resolveTarget({ FOUNDRY_TARGET: "v13", FOUNDRY_URL: "http://localhost:31000", FOUNDRY_DATA: "/tmp/fd" });
    expect(t.url).toBe("http://localhost:31000");
    expect(t.data).toBe("/tmp/fd");
    expect(t.moduleLink).toBe("/tmp/fd/Data/modules/mej-campaign-companion");
    expect(t.world).toBe("world-b");
  });

  it("honours an explicit FOUNDRY_MODULE_LINK and FOUNDRY_MAIN_CHECKOUT", () => {
    const t = resolveTarget({ FOUNDRY_MODULE_LINK: "/x/link", FOUNDRY_MAIN_CHECKOUT: "/x/repo" });
    expect(t.moduleLink).toBe("/x/link");
    expect(t.mainCheckout).toBe("/x/repo");
  });

  it("rejects an unknown target name", () => {
    expect(() => resolveTarget({ FOUNDRY_TARGET: "v12" })).toThrow(/Unknown FOUNDRY_TARGET "v12"/);
  });
});

describe("generationOf", () => {
  it("reads the major version from /api/status's version string", () => {
    expect(generationOf("13.351")).toBe(13);
    expect(generationOf("14.367")).toBe(14);
  });
  it("returns null for missing or malformed input", () => {
    expect(generationOf(undefined)).toBeNull();
    expect(generationOf("")).toBeNull();
    expect(generationOf("dev")).toBeNull();
  });
});
