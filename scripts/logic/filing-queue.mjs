/**
 * Shared filing queue: serializes every write to the singleton timeline
 * journal's timepoints flag (data/timepoints.mjs's addTimepoint/addLink)
 * through one module-scoped promise chain, regardless of which subsystem is
 * writing. Timepoints.addTimepoint/addLink rewrite the whole timepoints
 * array read-modify-write style, so any two overlapping writers - a combat
 * ending (hooks/auto-capture.mjs) while a GM is mid-docx-import
 * (apps/import-wizard.mjs), or a rapid double Show-Players click - would
 * otherwise silently drop whichever write loses the race. Both callers must
 * route every timeline mutation through queueFiling() from this one module
 * for the guarantee to hold; a caller that writes directly bypasses it.
 *
 * A task's own errors are caught and logged here rather than left to
 * reject the chain: a rejected promise would poison every subsequent
 * `.then(task)` in the chain (skipping it without running), permanently
 * breaking filing for the rest of the session. The returned promise itself
 * settles the same way (never rejects), matching the original
 * hooks/auto-capture.mjs behavior this was extracted from - callers that
 * need per-task success/failure should have their task record the outcome
 * into a closed-over variable rather than relying on the returned promise
 * to reject.
 */
let fileQueue = Promise.resolve();

/** Queue a filing task so it never overlaps a prior in-flight one. */
export function queueFiling(task) {
  fileQueue = fileQueue.then(task).catch((err) => console.error("mej-campaign-companion | filing failed", err));
  return fileQueue;
}
