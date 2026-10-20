// Unsaved Session text kept on this device (spec 2026-10-19 §2: no path where
// typed text is lost silently). A Recap or GM Prep value whose save is in
// flight or failed, and a My Notes draft, are mirrored into browser storage so
// a reload, a crash or a closed tab still has them; a successful save clears
// the entry. Keyed by user, page and field. Every storage access is guarded:
// private windows, blocked site data and full quotas make storage throw, and
// the in-memory copy (session-autosave.mjs) still works without it. Pure: the
// storage is passed in. No Foundry imports.

const PREFIX = "mej-cc-draft";
const SEP = "|";

export const draftStorageKey = (userId, pageUuid, field) => [PREFIX, userId, pageUuid, field].join(SEP);

function parseKey(key, userId) {
  const head = `${PREFIX}${SEP}${userId}${SEP}`;
  if (typeof key !== "string" || !key.startsWith(head)) return null;
  const rest = key.slice(head.length);
  const at = rest.lastIndexOf(SEP);
  if (at <= 0) return null;
  return { pageUuid: rest.slice(0, at), field: rest.slice(at + 1) };
}

function parseEntry(raw) {
  if (typeof raw !== "string") return null;
  try {
    const e = JSON.parse(raw);
    if (!e || typeof e.value !== "string") return null;
    return { value: e.value, base: typeof e.base === "string" ? e.base : null, at: Number.isFinite(e.at) ? e.at : 0 };
  } catch {
    return null;
  }
}

/**
 * @param {() => Storage|null|undefined} getStorage  Returns the storage (e.g. () => window.localStorage); may throw.
 * @param {string} userId
 * @param {() => number} [now]
 */
export function createDraftStore(getStorage, userId, now = () => Date.now()) {
  const storage = () => {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  };
  const ok = (pageUuid) => !!userId && !!pageUuid;
  return {
    /** Keep `value` (written over `base`, the stored value it replaces). True when stored. */
    save(pageUuid, field, value, base = null) {
      const s = storage();
      if (!s || !ok(pageUuid) || typeof value !== "string") return false;
      try {
        s.setItem(draftStorageKey(userId, pageUuid, field), JSON.stringify({ value, base: typeof base === "string" ? base : null, at: now() }));
        return true;
      } catch {
        return false;
      }
    },
    /** @returns {{value: string, base: string|null, at: number}|null} */
    load(pageUuid, field) {
      const s = storage();
      if (!s || !ok(pageUuid)) return null;
      try {
        return parseEntry(s.getItem(draftStorageKey(userId, pageUuid, field)));
      } catch {
        return null;
      }
    },
    clear(pageUuid, field) {
      const s = storage();
      if (!s || !ok(pageUuid)) return;
      try {
        s.removeItem(draftStorageKey(userId, pageUuid, field));
      } catch {
        // Nothing to do: the entry stays until the next successful save clears it.
      }
    },
    /** Every draft this user has on this device. */
    list() {
      const s = storage();
      if (!s || !userId) return [];
      const out = [];
      try {
        for (let i = 0; i < s.length; i++) {
          const where = parseKey(s.key(i), userId);
          if (!where) continue;
          const entry = parseEntry(s.getItem(s.key(i)));
          if (entry) out.push({ ...where, ...entry });
        }
      } catch {
        return out;
      }
      return out;
    }
  };
}
