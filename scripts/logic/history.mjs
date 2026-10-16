// History view of an entry's backlinks (spec 2026-10-15 §5.4): grouped by
// session, in session order, then everything else. Pure.
export function historyGroups(backlinks, sessions) {
  const byUuid = new Map((sessions ?? []).map((s) => [s.uuid, s]));
  const ordered = [...(sessions ?? [])].sort((a, b) => a.order - b.order);
  const groups = ordered.map((session) => ({ session, rows: (backlinks ?? []).filter((b) => b.uuid === session.uuid) }));
  groups.push({ session: null, rows: (backlinks ?? []).filter((b) => !byUuid.has(b.uuid)) });
  return groups.filter((g) => g.rows.length);
}
