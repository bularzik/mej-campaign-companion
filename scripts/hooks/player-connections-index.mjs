// Live reverse index for player connections (spec §4.3): which connections
// point AT an entry. Built lazily on first use (the tab wrap or the block
// asks for it on a sheet's first render), then patched from the journal CRUD
// hooks - updates that arrive through an Omnipresence sync fire the same
// hooks, so they show without a reload. Every patch re-renders the sheets
// showing an affected entry, because the "to" end's page never changes when
// a connection to it is written.
import { MODULE_ID, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { buildReverseIndex, reindexSource, removeSource, incomingFor } from "../logic/player-connections.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { poppedOutPageSheets } from "./secrets-ui.mjs";

let index = null;
let registered = false;

/** The entry's MEJ-typed page (first typed page wins, like graphRowsFor). */
export function typedPageOf(entry) {
  return entry?.pages?.contents?.find((p) => mejType(p)) ?? null;
}

function sourceOf(entry) {
  return { fromUuid: entry.uuid, flag: typedPageOf(entry)?.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG] };
}

export function ensureConnectionIndex() {
  if (!index) index = buildReverseIndex((game.journal?.contents ?? []).map(sourceOf));
  return index;
}

/** Connections stored on other entries that point at `toUuid`. */
export function incomingConnections(toUuid) {
  return incomingFor(ensureConnectionIndex(), toUuid);
}

/**
 * Re-render the shell and popped-out sheets showing any entry in `uuids`;
 * `null` = every one (a setting change implicates no single entry).
 */
export function refreshConnectionViews(uuids) {
  const hit = (uuid) => !uuids || uuids.has(uuid);
  const shell = game.MonksEnhancedJournal?.journal;
  if (shell?.rendered) {
    const shown = shell.document?.parent ?? shell.document;
    if (shown && hit(shown.uuid)) shell.render({ tempOwnership: shell.tempOwnership, reload: true });
  }
  for (const app of poppedOutPageSheets()) {
    if (hit(app.document?.parent?.uuid)) app.render?.();
  }
}

export function registerPlayerConnectionsIndex() {
  if (registered) return;
  registered = true;
  const patch = (entry) => {
    if (!index || !entry?.uuid) return;
    refreshConnectionViews(reindexSource(index, sourceOf(entry)));
  };
  Hooks.on("createJournalEntry", (entry) => patch(entry));
  Hooks.on("createJournalEntryPage", (page) => patch(page.parent));
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    const ours = changes?.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG] !== undefined;
    const retyped = changes?.flags?.["monks-enhanced-journal"]?.type !== undefined;
    if (ours || retyped) patch(page.parent);
  });
  Hooks.on("deleteJournalEntryPage", (page) => patch(page.parent));
  // Deleting the "from" entry removes its connections with it (spec §2);
  // deleting a "to" entry leaves rows pointing at it, which now render
  // unresolved (GM-only) on their source entries - refresh those too.
  Hooks.on("deleteJournalEntry", (entry) => {
    if (!index) return;
    const sources = incomingFor(index, entry.uuid).map((e) => e.fromUuid);
    const affected = removeSource(index, entry.uuid);
    for (const uuid of sources) affected.add(uuid);
    refreshConnectionViews(affected);
  });
}
