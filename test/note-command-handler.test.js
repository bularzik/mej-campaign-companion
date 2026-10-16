import { describe, it, expect, vi } from "vitest";
import { handleNoteCommand } from "../scripts/hooks/note-command.mjs";

const env = (over = {}) => ({
  openSessions: [{ campaignId: "c1", sessionUuid: "S" }],
  visibleCampaignIds: ["c1"],
  addNote: vi.fn(async (campaignId, fields) => ({ id: "n1", ...fields })),
  link: (campaignId, text) => `${text}!`,
  worldDate: null,
  ...over
});

describe("handleNoteCommand", () => {
  it("files into the open session with linked text", async () => {
    const e = env();
    const r = await handleNoteCommand("duke lies", e);
    expect(e.addNote).toHaveBeenCalledWith("c1", expect.objectContaining({ text: "duke lies!", sessionUuid: "S", kind: "player" }));
    expect(r).toEqual({ ok: true, key: "filed", data: { session: "S" } });
  });
  it("holds when no session is open and one campaign is visible", async () => {
    const e = env({ openSessions: [] });
    const r = await handleNoteCommand("x", e);
    expect(e.addNote).toHaveBeenCalledWith("c1", expect.objectContaining({ sessionUuid: null }));
    expect(r).toEqual({ ok: true, key: "held", data: {} });
  });
  it("refuses two open sessions (Review Focus 3) and no campaign", async () => {
    expect(await handleNoteCommand("x", env({ openSessions: [{ campaignId: "c1", sessionUuid: "a" }, { campaignId: "c2", sessionUuid: "b" }] })))
      .toEqual({ ok: false, key: "ambiguous" });
    expect(await handleNoteCommand("x", env({ openSessions: [], visibleCampaignIds: [] }))).toEqual({ ok: false, key: "none" });
  });
  it("maps a store error to its reason", async () => {
    const e = env({ addNote: vi.fn(async () => { const err = new Error("x"); err.reason = "noEntry"; throw err; }) });
    expect(await handleNoteCommand("x", e)).toEqual({ ok: false, key: "noEntry" });
  });
  it("falls back to writeFailed for an unknown error", async () => {
    const e = env({ addNote: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await handleNoteCommand("x", e)).toEqual({ ok: false, key: "writeFailed" });
  });
});
