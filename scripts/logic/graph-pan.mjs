// Background-drag panning for the Hub's Graph pane (spec 2026-09-25
// hub-ux-fixes §3). The SVG uses the default preserveAspectRatio
// (xMidYMid meet), so one screen pixel is max(w/cw, h/ch) viewBox units.
export function panViewBox([x, y, w, h], dxPx, dyPx, clientWidth, clientHeight) {
  const scale = clientWidth > 0 && clientHeight > 0 ? Math.max(w / clientWidth, h / clientHeight) : 1;
  return [x - dxPx * scale, y - dyPx * scale, w, h];
}
