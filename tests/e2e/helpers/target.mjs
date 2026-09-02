import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

/**
 * Harness targets. `v14` reproduces the defaults the harness has always had;
 * `v13` points at the Foundry 13.351 + stock MEJ 13.06 install used for the
 * v13 stock-smoke gate (tests/e2e/README.md, "Stock gate on v13"). Explicit
 * FOUNDRY_* variables always override the preset.
 */
export const TARGETS = {
  v14: {
    generation: 14,
    FOUNDRY_URL: "http://localhost:30000",
    FOUNDRY_TEST_WORLD: "world-a",
    FOUNDRY_APP: path.join(HOME, "FoundryVTT-14", "FoundryVTT-Node-14.365"),
    FOUNDRY_DATA: path.join(HOME, "FoundryVTT-14", "Data"),
    FOUNDRY_NODE: "/opt/homebrew/bin/node"
  },
  v13: {
    generation: 13,
    FOUNDRY_URL: "http://localhost:30013",
    FOUNDRY_TEST_WORLD: "world-b",
    FOUNDRY_APP: path.join(HOME, "FoundryVTT", "FoundryVTT-Node-13.351"),
    FOUNDRY_DATA: path.join(HOME, "FoundryVTT", "Data"),
    // Foundry 13 is launched with node 22 (see ~/FoundryVTT/start-foundry.command).
    FOUNDRY_NODE: "/opt/homebrew/opt/node@22/bin/node"
  }
};

export function resolveTarget(env = process.env) {
  const name = env.FOUNDRY_TARGET ?? "v14";
  const preset = TARGETS[name];
  if (!preset) {
    throw new Error(`Unknown FOUNDRY_TARGET "${name}" — expected one of ${Object.keys(TARGETS).join(", ")}`);
  }
  const pick = (key) => env[key] ?? preset[key];
  const data = pick("FOUNDRY_DATA");
  return {
    name,
    generation: preset.generation,
    url: pick("FOUNDRY_URL"),
    world: pick("FOUNDRY_TEST_WORLD"),
    app: pick("FOUNDRY_APP"),
    data,
    node: pick("FOUNDRY_NODE"),
    moduleLink: env.FOUNDRY_MODULE_LINK ?? path.join(data, "Data", "modules", "mej-campaign-companion"),
    mainCheckout: env.FOUNDRY_MAIN_CHECKOUT ?? path.join(HOME, "Claude", "Projects", "mej-campaign-companion")
  };
}

/** Major version from /api/status's `version` ("13.351" → 13); null if unreadable. */
export function generationOf(version) {
  const m = /^(\d+)/.exec(String(version ?? ""));
  return m ? Number(m[1]) : null;
}

export const TARGET = resolveTarget(process.env);
