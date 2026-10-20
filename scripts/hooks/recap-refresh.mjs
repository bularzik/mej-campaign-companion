// Keep open views of a Session page current when it changes on any client
// (spec 2026-09-04, Deviations; spec 2026-10-19 §4.4). MEJ's own
// updateJournalEntryPage hook reloads the shell for text.content, ownership
// and its flag keys - never for system.* or this module's flags, so a viewer
// kept a stale recap until they reopened the page.
//
// A Session sheet is never re-rendered for these changes: its editors are
// always available, so its header and Table talk are patched in place and its
// idle displays repainted (sheets/session-regions.mjs). Other views (a page
// whose body is the recap field but is not a Session sheet) keep the reload,
// never while an editor is open. Inert without MEJ (no shell; the popped-out
// branch's `!sheet.enhancedjournal` guard is defensive - a subsheet hosted
// inside the shell never reports `rendered` the way a standalone sheet does).
import { MODULE_ID, CAMPAIGN_FLAG } from "../constants.mjs";
import { recapChanged, shouldRefreshForRecap } from "../logic/recap-refresh.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { patchesRegions, patchSessionViews } from "../sheets/session-regions.mjs";

function rootOf(app) {
  const el = app?.element;
  return el instanceof HTMLElement ? el : (el?.[0] instanceof HTMLElement ? el[0] : null);
}

function isEditing(root) {
  return !!root?.querySelector(".editor-parent.editing");
}

const samePage = (page) => (doc) => doc?.uuid === page.uuid;

export function registerRecapRefresh() {
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    try {
      // Session state (start/end stamps, attendees, Table talk added) shows in the header and Table talk.
      if (changes?.flags?.[MODULE_ID]?.session !== undefined || recapChanged(changes)) patchSessionViews(samePage(page));
      if (!recapChanged(changes)) return;
      const shell = game.MonksEnhancedJournal?.journal;
      if (shell?.rendered) {
        const activeEntityId = shell.tabs?.active?.()?.entityId ?? null;
        const isSessionView = patchesRegions(shell.subsheet);
        if (shouldRefreshForRecap({ changes, activeEntityId, pageId: page.id, editing: isEditing(rootOf(shell)), isSessionView })) {
          shell.render({ tempOwnership: shell.tempOwnership, reload: true, focus: false });
          return;
        }
      }
      const sheet = page._sheet;
      if (sheet?.rendered && !sheet.enhancedjournal && !patchesRegions(sheet) && !isEditing(rootOf(sheet))) {
        sheet.render(true, { reload: true });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | recap refresh failed`, err);
    }
  });
  // Which session is running lives on the campaign: every open Session page of it shows the change.
  Hooks.on("updateFolder", (folder, changes) => {
    try {
      const campaign = changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG];
      if (!campaign || !Object.keys(campaign).some((k) => k.replace(/^-=/, "") === "currentSession")) return;
      patchSessionViews((doc) => {
        try {
          return campaignOf(doc)?.id === folder.id;
        } catch {
          return false;
        }
      });
    } catch (err) {
      console.error(`${MODULE_ID} | session status refresh failed`, err);
    }
  });
}
