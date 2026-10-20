// Single count shown on the Links rail tab. Pure.

export function linksCount({ notes = 0, tags = 0, attributes = 0, backlinks = 0 }) {
  return notes + tags + attributes + backlinks;
}
