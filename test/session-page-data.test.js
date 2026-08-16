import { describe, it, expect } from "vitest";
import { buildSessionPageData } from "../scripts/logic/session-page-data.mjs";
import { MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../scripts/constants.mjs";

describe("buildSessionPageData", () => {
  it("uses the real prefixed module-subtype native type, not the bare key", () => {
    const data = buildSessionPageData("Session 1", "<p>recap</p>", null, 1);
    expect(data.type).toBe(SESSION_DOCUMENT_TYPE);
    expect(data.type).toBe("mej-campaign-companion.session");
    expect(data.type).not.toBe(SESSION_TYPE);
  });

  it("also sets the MEJ interop flag so search/Hub/auto-link recognize the page", () => {
    const data = buildSessionPageData("Session 1", "<p>recap</p>", null, 1);
    expect(data.flags["monks-enhanced-journal"]).toEqual({ type: SESSION_TYPE });
  });

  it("carries the recap html and companion session flags under the module's own namespace", () => {
    const campaignDate = { year: 1372, month: 3, day: 12, hour: 20, minute: 0 };
    const data = buildSessionPageData("Session 3", "<p>the party arrives</p>", campaignDate, 3);
    expect(data.name).toBe("Session 3");
    expect(data.system).toEqual({ recap: "<p>the party arrives</p>", gmNotes: "" });
    expect(data.flags[MODULE_ID]).toEqual({
      session: { sessionNumber: 3, campaignDate, attendees: [], secrets: [] }
    });
  });

  it("defaults null html/campaignDate/sessionNumber cleanly", () => {
    const data = buildSessionPageData("Session Zero", undefined, undefined, undefined);
    expect(data.system.recap).toBe("");
    expect(data.flags[MODULE_ID].session.campaignDate).toBeNull();
    expect(data.flags[MODULE_ID].session.sessionNumber).toBeNull();
  });
});
