import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { sanitizeRecapHtml, handleSaveRecapRequest } from "../scripts/hooks/player-recap.mjs";
import { SESSION_DOCUMENT_TYPE } from "../scripts/constants.mjs";

// I4: sanitizeRecapHtml round-trips claimed HTML through foundry.prosemirror.dom
// (parse -> serialize) before a relayed player-recap write is ever trusted. These tests stub
// that boundary directly rather than pulling in a real ProseMirror schema, since the point
// under test is "does the GM-side handler actually call through this sanitizer and use its
// result", not ProseMirror's own schema behavior.
describe("sanitizeRecapHtml", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("strips markup ProseMirror's own schema wouldn't model (onerror handlers, <script>)", () => {
    // A real ProseMirror parse/serialize round-trip drops anything out-of-schema; simulate
    // that by having the stubbed serializer only ever emit schema-clean markup, regardless
    // of what the "parsed" DOM claims to have held - exercising sanitizeRecapHtml's own
    // parse-then-serialize call sequence, not ProseMirror's internals.
    const parseString = vi.fn((html) => ({ raw: html }));
    const serializeString = vi.fn((doc) => {
      // A schema-faithful serializer would never re-emit onerror=/<script> even if the
      // parsed doc's source text contained it - simulate that by stripping it here.
      return doc.raw.replace(/<img[^>]*onerror=[^>]*>/gi, "").replace(/<script[^>]*>.*?<\/script>/gi, "");
    });
    vi.stubGlobal("foundry", { prosemirror: { dom: { parseString, serializeString } } });

    const dirty = `<p>hi</p><img src="x.png" onerror="alert(1)"><script>alert(2)</script>`;
    const clean = sanitizeRecapHtml(dirty);

    expect(parseString).toHaveBeenCalledWith(dirty);
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("<script>");
    expect(clean).toContain("<p>hi</p>");
  });

  it("returns null when ProseMirror can't parse the payload at all", () => {
    vi.stubGlobal("foundry", {
      prosemirror: { dom: { parseString: () => { throw new Error("boom"); }, serializeString: vi.fn() } }
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sanitizeRecapHtml("<p>whatever</p>")).toBeNull();
  });
});

// I2: handleSaveRecapRequest must validate the resolved target before writing - a relayed
// payload's documentUuid is untrusted, and prior to this fix nothing checked that it
// actually resolved to a Session page the sender could observe.
describe("handleSaveRecapRequest target validation (I2)", () => {
  let updateCalls;
  let sessionPage;

  class FakeJournalEntryPage {}

  beforeEach(() => {
    updateCalls = [];
    vi.stubGlobal("JournalEntryPage", FakeJournalEntryPage);
    vi.stubGlobal("foundry", {
      prosemirror: {
        dom: { parseString: (h) => h, serializeString: (h) => h }
      }
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    sessionPage = Object.assign(new FakeJournalEntryPage(), {
      type: SESSION_DOCUMENT_TYPE,
      parent: { testUserPermission: vi.fn(() => true) },
      update: vi.fn((data) => { updateCalls.push(data); return Promise.resolve(); })
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function stubResolution({ user = { id: "u1" }, document = sessionPage } = {}) {
    vi.stubGlobal("game", { users: { get: vi.fn(() => user) } });
    vi.stubGlobal("fromUuid", vi.fn(async () => document));
  }

  const payload = (over = {}) => ({
    senderId: "u1", documentUuid: "JournalEntry.abc.JournalEntryPage.def", html: "<p>hi</p>", ...over
  });

  it("writes the sanitized html when the target is a Session page the sender can observe", async () => {
    stubResolution();
    await handleSaveRecapRequest(payload());
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toHaveProperty("flags.mej-campaign-companion.playerRecaps.u1", "<p>hi</p>");
  });

  it("drops the write when the resolved document is not a JournalEntryPage at all", async () => {
    stubResolution({ document: { type: SESSION_DOCUMENT_TYPE, parent: { testUserPermission: () => true } } });
    await handleSaveRecapRequest(payload());
    expect(updateCalls).toHaveLength(0);
  });

  it("drops the write when the resolved page is not a Session page", async () => {
    const otherPage = Object.assign(new FakeJournalEntryPage(), {
      type: "text", parent: { testUserPermission: () => true }, update: vi.fn()
    });
    stubResolution({ document: otherPage });
    await handleSaveRecapRequest(payload());
    expect(otherPage.update).not.toHaveBeenCalled();
  });

  it("drops the write when the sender can't OBSERVE the session's parent entry", async () => {
    sessionPage.parent.testUserPermission = vi.fn(() => false);
    stubResolution();
    await handleSaveRecapRequest(payload());
    expect(updateCalls).toHaveLength(0);
    expect(sessionPage.parent.testUserPermission).toHaveBeenCalledWith({ id: "u1" }, "OBSERVER");
  });
});
