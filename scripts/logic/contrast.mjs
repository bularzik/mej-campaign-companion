// WCAG 2.x relative luminance and contrast ratio over CSS rgb()/rgba()
// strings (what getComputedStyle returns). No Foundry globals.

/** @returns {{r:number,g:number,b:number,a:number}|null} */
export function parseCssColor(str) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(String(str ?? "").trim());
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** @param {{r:number,g:number,b:number}} c */
export function relativeLuminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * Contrast ratio between two colours (strings or parsed objects), 1..21.
 * Unparseable input yields NaN so an assertion on it fails loudly.
 */
export function contrastRatio(fg, bg) {
  const a = typeof fg === "string" ? parseCssColor(fg) : fg;
  const b = typeof bg === "string" ? parseCssColor(bg) : bg;
  if (!a || !b) return NaN;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
