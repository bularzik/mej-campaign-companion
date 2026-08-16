import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Hoisted by vitest above the imports below. The specifier is resolved
// relative to this file but lands on the same module scripts/hooks/media-relay.mjs
// imports as "../apps/import-upload.mjs" - real path scripts/apps/import-upload.mjs.
// uploadCompanionFile hits Foundry's FilePicker (foundry.applications.apps.FilePicker,
// game.world.id for its directory-creation fallback), which isn't worth faking whole;
// mock the module so handleUploadRequest's own branching is what's under test here.
vi.mock("../scripts/apps/import-upload.mjs", () => ({
  uploadCompanionFile: vi.fn(async () => "worlds/w/mej-campaign-companion/uploads/rid-photo.png")
}));

import { handleUploadRequest } from "../scripts/hooks/media-relay.mjs";
import { uploadCompanionFile } from "../scripts/apps/import-upload.mjs";

// Model the payload on chunkProblem/createRelayAssembler (scripts/logic/media-relay.mjs,
// unit-tested in test/media-relay.test.js): a single-chunk (seq 0 of 1) relayed upload
// request with a valid renderable-image MIME type.
function validPayload(overrides = {}) {
  const data = btoa("fake-png-bytes");
  return {
    action: "relay-upload-media", requestId: "req1", senderId: "user1",
    groupId: "JournalEntry.j1.JournalEntryPage.p1", name: "photo.png",
    type: "image/png", seq: 0, total: 1, data, ...overrides
  };
}

describe("handleUploadRequest", () => {
  let emitted;
  class FakeJournalEntryPage {}

  beforeEach(() => {
    emitted = [];
    uploadCompanionFile.mockClear();
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal("foundry", { utils: { randomID: () => "rid" } });
    // game.world.id is read by RELAY_UPLOAD_DIR() (constants.mjs), which
    // handleUploadRequest evaluates as an argument to uploadCompanionFile
    // even though uploadCompanionFile itself is mocked above.
    vi.stubGlobal("game", {
      socket: { emit: (channel, msg) => emitted.push({ channel, msg }) },
      users: { get: (id) => (id === "user1" ? { id: "user1" } : undefined) },
      world: { id: "w" }
    });
    vi.stubGlobal("JournalEntryPage", FakeJournalEntryPage);
    vi.stubGlobal("fromUuid", vi.fn(async () => {
      const page = new FakeJournalEntryPage();
      page.type = "mej-campaign-companion.session";
      page.parent = { testUserPermission: () => true };
      return page;
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("replies bad-sender for an unknown senderId", async () => {
    await handleUploadRequest(validPayload({ requestId: "req1", senderId: "ghost" }));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].msg.error).toBe("bad-sender");
  });

  it("replies bad-context when the uuid does not resolve to a session page", async () => {
    vi.stubGlobal("fromUuid", vi.fn(async () => null));
    await handleUploadRequest(validPayload({ requestId: "req2" }));
    expect(emitted[0].msg.error).toBe("bad-context");
  });

  it("replies bad-context when the sender cannot observe the session", async () => {
    vi.stubGlobal("fromUuid", vi.fn(async () => {
      const page = new FakeJournalEntryPage();
      page.type = "mej-campaign-companion.session";
      page.parent = { testUserPermission: () => false };
      return page;
    }));
    await handleUploadRequest(validPayload({ requestId: "req3" }));
    expect(emitted[0].msg.error).toBe("bad-context");
  });

  it("replies an error for an invalid assembled request (bad MIME)", async () => {
    await handleUploadRequest(validPayload({ requestId: "req4", type: "text/html", name: "evil.html" }));
    expect(emitted[0].msg.error).toBeTruthy();
    expect(uploadCompanionFile).not.toHaveBeenCalled();
  });

  it("uploads and replies {path} on the success path", async () => {
    await handleUploadRequest(validPayload({ requestId: "req5" }));
    expect(uploadCompanionFile).toHaveBeenCalledTimes(1);
    expect(emitted[0].msg.path).toContain("uploads/");
  });
});
