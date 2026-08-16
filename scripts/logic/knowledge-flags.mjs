/**
 * Pure readers/normalizers for the companion's Phase B knowledge flags
 * (tags + attributes) on MEJ journal pages. Foundry-free (vitest-loadable).
 * Flag shapes (spec §3, all under flags["mej-campaign-companion"]):
 *   tags:       string[]
 *   attributes: [{id, key, value, playerHidden}]
 */
const COMPANION_FLAGS = "mej-campaign-companion";

function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function getTags(page) {
  return dedupeTags(page?.flags?.[COMPANION_FLAGS]?.tags ?? []);
}

export function getAttributes(page) {
  const rows = page?.flags?.[COMPANION_FLAGS]?.attributes ?? [];
  return (Array.isArray(rows) ? rows : []).filter(
    (r) => r && typeof r === "object" && typeof r.key === "string" && r.key.length && typeof r.value === "string"
  ).map((r) => ({ id: String(r.id ?? ""), key: r.key, value: r.value, playerHidden: r.playerHidden === true }));
}

export function splitAttributeText(attributes) {
  const join = (rows) => rows.map((r) => `${r.key} ${r.value}`.trim()).join(" ");
  const hidden = (attributes ?? []).filter((r) => r.playerHidden);
  const visible = (attributes ?? []).filter((r) => !r.playerHidden);
  return { visible: join(visible), hidden: join(hidden) };
}

export function normalizeTagInput(raw) {
  return dedupeTags(String(raw ?? "").split(","));
}
