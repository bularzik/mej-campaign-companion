// Decides whether the Session sheet sits on a light or dark ground. Pure.

/** "light" unless the scheme is dark and no background image paints the ground. */
export function groundTone({ backgroundImage, isDarkScheme }) {
  if (!isDarkScheme) return "light";
  return String(backgroundImage ?? "").includes("url(") ? "light" : "dark";
}
