// Pure graph-focus rules (spec 2026-10-15 item 12): Focus is reachable from
// inside the pane, not only from an entry's header button.

export function focusTransition(state, uuid) {
  const current = { graphMode: state?.graphMode ?? "all", graphCenterUuid: state?.graphCenterUuid ?? null };
  if (!uuid) return { ...current, changed: false };
  if (current.graphMode === "ego" && current.graphCenterUuid === uuid) return { ...current, changed: false };
  return { graphMode: "ego", graphCenterUuid: uuid, changed: true };
}

export function focusPickerRows(nodes, centerUuid) {
  return [...(nodes ?? [])]
    .map((n) => ({ uuid: n.uuid, name: n.name, type: n.type, selected: n.uuid === centerUuid }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
