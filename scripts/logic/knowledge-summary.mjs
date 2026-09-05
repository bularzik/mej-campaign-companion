// One-line summary for the collapsed knowledge bar (spec 2026-09-04 §D):
// "3 tags · 1 attribute · 5 mentions". Zero counts are omitted; "" means
// everything is empty and the template shows knowledge.summary.empty.
import { I18N } from "../constants.mjs";

/**
 * @param {{tags?: number, attributes?: number, backlinks?: number}} counts
 * @param {(key: string, data: object) => string} format localizer (game.i18n.format in production)
 */
export function knowledgeSummary({ tags = 0, attributes = 0, backlinks = 0 } = {}, format) {
  return [[tags, "tags"], [attributes, "attributes"], [backlinks, "mentions"]]
    .filter(([n]) => n > 0)
    .map(([n, key]) => format(`${I18N}.knowledge.summary.${key}${n === 1 ? "One" : ""}`, { count: n }))
    .join(" · ");
}
