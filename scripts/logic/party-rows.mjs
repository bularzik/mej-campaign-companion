// Party relationships (spec 2026-10-10). Pure and Foundry-free: the row
// model, who may target what, the lines one entry shows, and the keyed
// update paths every write uses. Rows live on the campaign's party notebook
// JournalEntry at flags["mej-campaign-companion"].partyRows = {[key]: Row}.
// Identity is the stored a/b pair, never the key: an Omnipresence sync
// rewrites uuids inside flags but leaves flag keys alone.
import { MODULE_ID, PARTY_ROWS_FLAG } from "../constants.mjs";

export const LABEL_MAX = 200;
const ROOT = `flags.${MODULE_ID}.${PARTY_ROWS_FLAG}`;
const WORLD_ENTRY = /^JournalEntry\.([A-Za-z0-9]+)$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** The id of a world JournalEntry uuid, else null (compendium and page uuids are refused). */
export function entryIdOf(uuid) {
  const m = typeof uuid === "string" ? WORLD_ENTRY.exec(uuid) : null;
  return m ? m[1] : null;
}

/** Order-independent, flag-safe key for a pair; null for self or non-world uuids. */
export function pairId(uuidA, uuidB) {
  const x = entryIdOf(uuidA);
  const y = entryIdOf(uuidB);
  if (!x || !y || x === y) return null;
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}

export function normalizeRows(flagValue) {
  if (!isObj(flagValue)) return [];
  const rows = [];
  for (const [key, r] of Object.entries(flagValue)) {
    if (!isObj(r) || typeof r.a !== "string" || typeof r.b !== "string" || !r.a || !r.b || r.a === r.b) continue;
    const labels = isObj(r.labels) ? r.labels : {};
    rows.push({
      key, a: r.a, b: r.b,
      labels: { a: str(labels.a), b: str(labels.b) },
      createdBy: str(r.createdBy), createdName: str(r.createdName),
      editedBy: str(r.editedBy), editedName: str(r.editedName),
      updated: Number.isFinite(r.updated) ? r.updated : 0
    });
  }
  return rows;
}

export function sideOf(row, uuid) {
  if (row?.a === uuid) return "a";
  if (row?.b === uuid) return "b";
  return null;
}

export function findPair(rows, uuidA, uuidB) {
  return (rows ?? []).find((r) => (r.a === uuidA && r.b === uuidB) || (r.a === uuidB && r.b === uuidA)) ?? null;
}

export function targetProblem(target, { sourceUuid, allowed, typeOf, canLimited }) {
  if (!target || !entryIdOf(target.uuid)) return "not-journal";
  if (target.uuid === sourceUuid) return "self";
  if (!canLimited(target)) return "no-access";
  const type = typeOf(target);
  if (!type || !(allowed ?? []).includes(type)) return "type-not-allowed";
  return null;
}

export function eligibleTargets(entries, ctx, filter = "") {
  const q = String(filter).trim().toLocaleLowerCase();
  return [...(entries ?? [])]
    .filter((entry) => targetProblem(entry, ctx) === null)
    .filter((entry) => !q || String(entry.name ?? "").toLocaleLowerCase().includes(q))
    .map((entry) => ({ uuid: entry.uuid, name: String(entry.name ?? ""), type: ctx.typeOf(entry) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One line per readable row touching `uuid`, in notebook order (spec §2.5, §3.2). */
export function linesForEntry(uuid, notebooks, { canLimited }) {
  const lines = [];
  for (const nb of notebooks ?? []) {
    for (const row of nb.rows ?? []) {
      const side = sideOf(row, uuid);
      if (!side) continue;
      const other = side === "a" ? row.b : row.a;
      if (!canLimited(other)) continue;
      lines.push({
        notebookUuid: nb.uuid, key: row.key, campaignName: nb.campaignName, other, side,
        label: row.labels[side], otherLabel: row.labels[side === "a" ? "b" : "a"], editedName: row.editedName
      });
    }
  }
  return lines;
}

/** `label` (optional) is the source side's first label, so create + label is one write. */
export function createRowUpdate({ sourceUuid, targetUuid, user, now, label = "" }) {
  const key = pairId(sourceUuid, targetUuid);
  return {
    key,
    update: {
      [`${ROOT}.${key}`]: {
        a: sourceUuid, b: targetUuid, labels: { a: str(label).trim().slice(0, LABEL_MAX), b: "" },
        createdBy: user.id, createdName: user.name, editedBy: user.id, editedName: user.name, updated: now
      }
    }
  };
}

export function labelUpdate(row, side, text, { user, now }) {
  if ((side !== "a" && side !== "b") || typeof text !== "string") return null;
  const clean = text.trim();
  if (clean.length > LABEL_MAX) return null;
  const base = `${ROOT}.${row.key}`;
  return {
    [`${base}.labels.${side}`]: clean,
    [`${base}.editedBy`]: user.id,
    [`${base}.editedName`]: user.name,
    [`${base}.updated`]: now
  };
}

export function deleteUpdate(key) {
  return { [`${ROOT}.-=${key}`]: null };
}

/** Word export lines for one entry: `Mara — Sister of (edited by Jo)` (spec §5.2). */
export function exportLines(lines, labels) {
  return [...(lines ?? [])]
    .sort((x, y) => x.otherName.localeCompare(y.otherName))
    .map((l) => ({
      text: [l.otherName, l.label ? `— ${l.label}` : null, l.editedName ? `(${labels.edited(l.editedName)})` : null]
        .filter(Boolean).join(" "),
      children: []
    }));
}
