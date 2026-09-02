/**
 * True when `s` parses as an absolute URL. Stands in for the static
 * `URL.parse()` (Baseline 2024): Foundry 14 core uses it, Foundry 13 core
 * never does, so v13's supported-browser floor cannot be assumed to have it.
 * `new URL()` is universal.
 */
export function isAbsoluteUrl(s) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}
