// The single writer for "Create Entity from Selection" (spec 2026-09-22
// §4.3 steps 3-5). Called directly on a GM client and from the relay
// handler for a contributor, so both paths write identically. Foundry
// access is injected (deps) so the branching is unit-tested.
import { linkSelectionInSource } from "./entity-from-selection.mjs";

export async function runEntityFromSelection(request, deps) {
  const { pageUuid, fieldKey, text, occurrence, total, type, name, linkOthers, maskSecrets } = request;
  const page = await deps.fromUuid(pageUuid);
  if (!page) return { ok: false, reason: "page-missing" };

  let entry;
  try {
    const created = await deps.createMejEntry(type, name.trim(), "", {}, null, page.parent?.folder?.id ?? null,
      { [deps.moduleId]: { skipRetroLink: true } });
    entry = created.parent;
  } catch (err) {
    deps.logError("entity-from-selection: create failed", err);
    return { ok: false, reason: "create-failed" };
  }

  // Re-read now, not the captured HTML: someone may have edited the page
  // while the dialog was open; a shifted occurrence fails the total check.
  // maskSecrets is set only by the relay, for a requester who cannot see
  // the page's secret sections (see linkSelectionInSource).
  const newHtml = linkSelectionInSource(deps.getProperty(page, fieldKey), { text, occurrence, total, uuid: entry.uuid },
    { maskSecrets: maskSecrets === true });
  let linked = false;
  if (newHtml !== null) {
    try {
      await page.update({ [fieldKey]: newHtml });
      linked = true;
    } catch (err) {
      deps.logError("entity-from-selection: page update failed", err);
      return { ok: true, entryUuid: entry.uuid, linked: false, retro: false };
    }
  }

  if (linkOthers) {
    Promise.resolve(deps.runRetroPass([entry])).catch((err) => deps.logError("entity-from-selection: retro pass failed", err));
  }
  return { ok: true, entryUuid: entry.uuid, linked, retro: !!linkOthers };
}

/**
 * "Link to Entity" writer (spec 2026-09-26 §4.3): links the selection to an
 * existing entity. The uuid is re-checked against the matches this client
 * computes now (deps.matchesFor), so a relayed or stale uuid cannot link an
 * entity the selection does not name. Never creates, never runs the retro pass.
 */
export async function runLinkSelection(request, deps) {
  const { pageUuid, fieldKey, text, occurrence, total, entityUuid, maskSecrets } = request;
  const page = await deps.fromUuid(pageUuid);
  if (!page) return { ok: false, reason: "page-missing" };
  const matches = deps.matchesFor(page, fieldKey, text) ?? [];
  if (!matches.some((m) => m.uuid === entityUuid)) return { ok: false, reason: "bad-entity" };

  const newHtml = linkSelectionInSource(deps.getProperty(page, fieldKey), { text, occurrence, total, uuid: entityUuid },
    { maskSecrets: maskSecrets === true });
  if (newHtml === null) return { ok: true, entryUuid: entityUuid, linked: false };
  try {
    await page.update({ [fieldKey]: newHtml });
  } catch (err) {
    deps.logError("link-to-entity: page update failed", err);
    return { ok: true, entryUuid: entityUuid, linked: false };
  }
  return { ok: true, entryUuid: entityUuid, linked: true };
}
