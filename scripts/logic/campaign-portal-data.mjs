// Pure campaign-portal payload + lifecycle planners (spec C §1). Same
// conventions as session-page-data.mjs (payload) and campaigns.mjs
// (doc-shaped inputs, no Foundry imports).
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";

/**
 * The pages[] payload for a campaign portal. Sets BOTH the native
 * module-declared subtype (a bare "campaign" is rejected by
 * DocumentTypeField at create time) and the MEJ interop flag that
 * search/Hub/auto-link machinery gates on - exactly the Session pattern
 * (see session-page-data.mjs's doc comment for the full citation trail).
 * The companion's own campaignPortal flag is the cheap identity marker
 * lifecycle hooks match on without re-deriving from the type string.
 */
export function buildCampaignPortalData(name) {
  return {
    name,
    type: CAMPAIGN_DOCUMENT_TYPE,
    flags: {
      [MODULE_ID]: { campaignPortal: true },
      "monks-enhanced-journal": { type: CAMPAIGN_TYPE }
    }
  };
}

/**
 * Two-way rename reconciliation (spec C §1): the side that CHANGED wins,
 * the other side follows. Equal names -> null (the loop guard: applying a
 * plan's own output always converges to null on the next event).
 */
export function renameSyncPlan({ folderName, portalName, changedSide }) {
  if (folderName === portalName) return null;
  return changedSide === "folder"
    ? { target: "portal", name: folderName }
    : { target: "folder", name: portalName };
}

/** Migration planner (spec C §1): campaigns lacking a portal, in input order. Idempotent by construction. */
export function missingPortalPlan(campaigns, portalOf) {
  return (campaigns ?? []).filter((c) => !portalOf(c));
}
