// scripts/apps/confirm-delete.mjs
// One confirm for the five destructive clicks that had none (spec
// 2026-10-15 §5.7): dashboards, player groups, checklist secrets,
// attributes, attendees. Timepoints and timelines keep their own, richer
// confirms. The key builder is pure so vitest pins the copy wiring; the
// dialog itself is Foundry glue. Importable without Foundry: nothing at
// module scope touches `foundry`/`game`.
import { I18N } from "../constants.mjs";

export const DELETE_KINDS = Object.freeze(["dashboard", "group", "secret", "attribute", "attendee"]);

export function deletePromptKeys(kind) {
  if (!DELETE_KINDS.includes(kind)) throw new Error(`unknown delete kind: ${kind}`);
  return { title: `${I18N}.confirmDelete.${kind}.title`, body: `${I18N}.confirmDelete.${kind}.body` };
}

/** @returns {Promise<boolean>} true only when the user confirmed (DialogV2.confirm resolves true/false/null) */
export async function confirmDelete({ kind, name = "" }) {
  const keys = deletePromptKeys(kind);
  const body = game.i18n.format(keys.body, { name: foundry.utils.escapeHTML(name) });
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(keys.title) },
    content: `<p>${body}</p>`,
    rejectClose: false
  });
  return ok === true;
}
