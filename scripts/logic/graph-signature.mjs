/**
 * Fingerprint of everything the graph pane draws, so a re-render that changes
 * none of it can skip the redraw (C6).
 *
 * The Hub re-renders its `main` part for reasons that have nothing to do with
 * the graph - most visibly, every debounced keystroke in the index filter.
 * Each of those reached drawGraphPane, which tears the SVG down
 * (`replaceChildren`) and stops and rebuilds the d3 force simulation from
 * scratch. Typing a filter therefore restarted the physics repeatedly, with
 * the graph tab not necessarily even visible, and any layout the simulation
 * had settled into was thrown away each time.
 *
 * Deliberately a whole-structure stringify rather than a hand-picked list of
 * fields: the node and edge shapes are built elsewhere (logic/graph-data.mjs,
 * logic/graph-rows.mjs) and gain fields over time - portraits did exactly
 * that in 0.13.0. A hand-picked signature would silently stop noticing a new
 * field and leave the pane showing stale output, which is a worse failure
 * than the redraw this exists to avoid. Stringifying up to MAX_NODES (200)
 * nodes costs far less than one simulation rebuild.
 *
 * `width`/`height` are part of the fingerprint because the pane falls back to
 * 800x540 when the SVG has no layout box - which is the case while its tab is
 * hidden. Without them, a graph first drawn at the fallback size would be
 * pinned there by this very cache once the tab became visible.
 */
export function graphSignature(graph, { centerUuid = null, width = 0, height = 0 } = {}) {
  if (!graph) return null;
  return JSON.stringify({ graph, centerUuid, width, height });
}
