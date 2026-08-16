/**
 * The companion's single query grammar (spec §4): consumed by the Hub
 * dashboards, the @CampaignQuery page enricher, and any future filter
 * surface, so they can't drift apart. Pure (vitest-loadable).
 *
 * Grammar: whitespace-separated tokens.
 *   type:<key>            merged-registry type key, e.g. type:person
 *   tag:<tag>             companion tag (case-insensitive match)
 *   attr:<key>            has an attribute with this key
 *   attr:<key>=<value>    ...whose value contains <value> (case-insensitive)
 *   anything else         free text, forwarded to search-index.mjs's search()
 * All conditions AND together.
 */
import { search } from "./search-index.mjs";

export function parseQuery(str) {
  const parsed = { types: [], tags: [], attrs: [], text: "" };
  const free = [];
  for (const token of String(str ?? "").trim().split(/\s+/).filter(Boolean)) {
    const m = /^(type|tag|attr):(.+)$/i.exec(token);
    if (!m) {
      free.push(token);
      continue;
    }
    const prefix = m[1].toLowerCase();
    const rest = m[2];
    if (prefix === "type") parsed.types.push(rest.toLowerCase());
    else if (prefix === "tag") parsed.tags.push(rest);
    else {
      const eq = rest.indexOf("=");
      parsed.attrs.push(eq === -1
        ? { key: rest, value: null }
        : { key: rest.slice(0, eq), value: rest.slice(eq + 1) });
    }
  }
  parsed.text = free.join(" ");
  if (!parsed.text && !parsed.types.length && !parsed.tags.length && !parsed.attrs.length) {
    throw new Error("empty-query");
  }
  return parsed;
}

export function matchesMeta(rec, parsed, { gm = false } = {}) {
  if (parsed.types.length && !parsed.types.includes(rec.type)) return false;
  const meta = rec.meta ?? { tags: [], attrs: [] };
  const tagSet = new Set(meta.tags.map((t) => t.toLowerCase()));
  for (const tag of parsed.tags) {
    if (!tagSet.has(tag.toLowerCase())) return false;
  }
  const visibleAttrs = meta.attrs.filter((a) => gm || !a.playerHidden);
  for (const { key, value } of parsed.attrs) {
    const keyLc = key.toLowerCase();
    const hit = visibleAttrs.some((a) =>
      a.key.toLowerCase() === keyLc &&
      (value === null || a.value.toLowerCase().includes(value.toLowerCase()))
    );
    if (!hit) return false;
  }
  return true;
}

export function runQuery(index, queryString, { gm = false } = {}) {
  const parsed = parseQuery(queryString);
  if (parsed.text) {
    return search(index, parsed.text, { gm })
      .filter((hit) => matchesMeta(index.records.get(hit.uuid), parsed, { gm }));
  }
  const hits = [];
  for (const rec of index.records.values()) {
    if (!matchesMeta(rec, parsed, { gm })) continue;
    hits.push({ uuid: rec.uuid, name: rec.name, type: rec.type, matches: [] });
  }
  return hits.sort((a, b) => a.name.localeCompare(b.name));
}
