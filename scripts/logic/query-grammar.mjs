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
 *   scope:all|campaign    inline queries only: all opts out of the page-campaign
 *                         filter (default campaign); see scopeHits
 *   anything else         free text, forwarded to search-index.mjs's search()
 * All conditions AND together.
 */
import { search } from "./search-index.mjs";
import { sameLinkScope } from "./link-targets.mjs";

export function parseQuery(str) {
  const parsed = { types: [], tags: [], attrs: [], text: "", scope: "campaign" };
  const free = [];
  for (const token of String(str ?? "").trim().split(/\s+/).filter(Boolean)) {
    const m = /^(type|tag|attr|scope):(.+)$/i.exec(token);
    if (!m) {
      free.push(token);
      continue;
    }
    const prefix = m[1].toLowerCase();
    const rest = m[2];
    if (prefix === "type") {
      // A type key is a merged-registry key: word chars, dot or dash. Anything
      // else can name no type at all, and used to parse into a types[] entry
      // that matches every record's `type` never - an always-empty dashboard
      // with no feedback anywhere (C16).
      if (!/^[\w.-]+$/.test(rest)) throw new Error("bad-type");
      parsed.types.push(rest.toLowerCase());
    } else if (prefix === "tag") {
      // No validation: a tag is free-form user text, so every non-empty value
      // is meaningful, and `tag:` with no value never reaches here (the regex
      // above needs at least one character) - it is free text, by contract.
      parsed.tags.push(rest);
    } else if (prefix === "scope") {
      const v = rest.toLowerCase();
      if (v !== "all" && v !== "campaign") throw new Error("bad-scope");
      parsed.scope = v;
    } else {
      const eq = rest.indexOf("=");
      const key = eq === -1 ? rest : rest.slice(0, eq);
      // `attr:=:=broken` produced key "" here; matchesMeta then looked for an
      // attribute whose key lowercases to "", which cannot exist, so the query
      // returned zero rows forever with no way to tell it apart from a real
      // empty result.
      if (!key.trim()) throw new Error("bad-attr");
      parsed.attrs.push(eq === -1
        ? { key: rest, value: null }
        : { key, value: rest.slice(eq + 1) });
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

/** Drop hits outside the rendering page's campaign unless the query says scope:all (spec 2026-10-15 §5.6). */
export function scopeHits(hits, parsed, pageCampaignId, campaignIdOfUuid) {
  if (parsed?.scope === "all" || !pageCampaignId) return [...(hits ?? [])];
  return (hits ?? []).filter((h) => sameLinkScope(pageCampaignId, campaignIdOfUuid(h.uuid) ?? null));
}
