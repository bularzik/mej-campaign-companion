// scripts/logic/recap-save-state.mjs
// Spec 2026-10-15 §5.2: a visible save state replaces "click the pencil
// again to commit". Pure: the sheet reads the editor's live value and the
// stored recap and asks whether closing will write anything.
import { shouldCommitGmNotes } from "./gm-notes-commit.mjs";

/** @returns {"saving"|"idle"} */
export function recapClosePlan({ live, stored }) {
  return shouldCommitGmNotes(live, stored) ? "saving" : "idle";
}
