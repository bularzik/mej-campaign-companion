// Search-snippet cleanup (spec 2026-10-15 item 13): snippets are raw page
// text sliced by search-index.mjs's snippetFor, so links show through as
// @UUID[...]{...} markup and can be cut mid-token. Pure; no Foundry imports.

const FULL = /@UUID\[([^\]]*)\](?:\{([^}]*)\})?/g;
const TRUNCATED_LABEL = /@UUID\[[^\]]*\]\{([^}]*)$/;
const TRUNCATED_REF = /@UUID\[[^\]]*$/;

export function stripUuidLinks(text, { nameOf = () => null } = {}) {
  if (typeof text !== "string" || !text) return "";
  // Order matters (Controller ruling 2): a truncated labelled link must be
  // reduced to its label before FULL could mistake it for a bare reference.
  let out = text.replace(TRUNCATED_LABEL, "$1");
  out = out.replace(FULL, (_m, uuid, label) => {
    if (typeof label === "string") return label;
    const name = nameOf(uuid);
    if (typeof name === "string" && name) return name;
    return uuid.split(".").pop() ?? "";
  });
  out = out.replace(TRUNCATED_REF, "");
  return out;
}
