// scripts/logic/auto-link-baseline.mjs

/** Field content as of the last full sheet render — the auto-link diff baseline. */
const baselines = new Map();
const key = (uuid, field) => `${uuid}::${field}`;

export function setBaseline(uuid, field, html) {
  baselines.set(key(uuid, field), html ?? "");
}
export function getBaseline(uuid, field) {
  return baselines.get(key(uuid, field));
}
export function clearBaseline(uuid, field) {
  baselines.delete(key(uuid, field));
}
