// Ported verbatim from campaign-record's scripts/integrations/vendor-loader.mjs
// (only the import path changed). Loads a checked-in vendor bundle by
// injecting a <script> tag rather than an esmodule import, so mammoth stays
// out of module.json's esmodules list and is only fetched when the import
// wizard is actually opened.
import { MODULE_ID } from "../constants.mjs";

const pending = new Map();

/**
 * Load a checked-in vendor bundle (UMD/IIFE) via script tag and return the
 * global it defines. Idempotent; concurrent callers share one load.
 */
export async function loadVendorGlobal(file, globalName) {
  if (globalThis[globalName]) return globalThis[globalName];
  if (!pending.has(file)) {
    pending.set(file, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `modules/${MODULE_ID}/vendor/${file}`;
      script.onload = resolve;
      script.onerror = () => {
        pending.delete(file);
        reject(new Error(`${MODULE_ID} | failed to load vendor/${file}`));
      };
      document.head.append(script);
    }));
  }
  await pending.get(file);
  const global = globalThis[globalName];
  if (!global) throw new Error(`${MODULE_ID} | vendor/${file} did not define ${globalName}`);
  return global;
}
