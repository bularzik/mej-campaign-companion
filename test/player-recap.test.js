import { describe, it, expect } from "vitest";
import {
  MAX_RECAP_HTML_LENGTH, playerRecaps, buildRecapEntries, recapWriteRoute, recapPayloadProblem
} from "../scripts/logic/player-recap.mjs";

describe("playerRecaps", () => {
  it("reads the flag, defaulting to {}", () => {
    expect(playerRecaps({ getFlag: () => undefined })).toEqual({});
    expect(playerRecaps({ getFlag: () => ({ u1: "<p>hi</p>" }) })).toEqual({ u1: "<p>hi</p>" });
  });
});

describe("buildRecapEntries", () => {
  const users = [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];

  it("always includes the current user's own entry, even when empty", () => {
    const entries = buildRecapEntries({}, users, "u1");
    expect(entries).toEqual([{ userId: "u1", html: "", name: "Alice", isSelf: true }]);
  });
  it("includes other users only when they have non-empty content", () => {
    const entries = buildRecapEntries({ u1: "<p>mine</p>", u2: "", u3: "  " }, users, "u1");
    expect(entries).toEqual([{ userId: "u1", html: "<p>mine</p>", name: "Alice", isSelf: true }]);
  });
  it("includes other users with real content, sorted after self", () => {
    const entries = buildRecapEntries({ u1: "", u2: "<p>bob's take</p>" }, users, "u1");
    expect(entries).toEqual([
      { userId: "u1", html: "", name: "Alice", isSelf: true },
      { userId: "u2", html: "<p>bob's take</p>", name: "Bob", isSelf: false }
    ]);
  });
  it("falls back to the raw userId as a name for an unknown user", () => {
    const entries = buildRecapEntries({ u1: "", ghost: "<p>x</p>" }, users, "u1");
    expect(entries.find((e) => e.userId === "ghost")).toEqual({ userId: "ghost", html: "<p>x</p>", name: "ghost", isSelf: false });
  });
});

describe("recapWriteRoute", () => {
  it("writes directly when the caller already owns the document", () => {
    expect(recapWriteRoute({ isOwner: true, hasActiveGM: true })).toBe("direct");
    expect(recapWriteRoute({ isOwner: true, hasActiveGM: false })).toBe("direct");
  });
  it("relays through the active GM when not owner but a GM is online", () => {
    expect(recapWriteRoute({ isOwner: false, hasActiveGM: true })).toBe("relay");
  });
  it("is unavailable when neither owner nor a GM is online", () => {
    expect(recapWriteRoute({ isOwner: false, hasActiveGM: false })).toBe("unavailable");
  });
});

describe("recapPayloadProblem", () => {
  const payload = (over = {}) => ({ senderId: "u1", documentUuid: "JournalEntry.abc.JournalEntryPage.def", html: "<p>hi</p>", ...over });

  it("passes a well-formed payload", () => {
    expect(recapPayloadProblem(payload())).toBeNull();
  });
  it("names the defect for malformed payloads", () => {
    expect(recapPayloadProblem(payload({ senderId: "" }))).toBe("bad-sender");
    expect(recapPayloadProblem(payload({ senderId: 7 }))).toBe("bad-sender");
    expect(recapPayloadProblem(payload({ documentUuid: "" }))).toBe("bad-document");
    expect(recapPayloadProblem(payload({ html: 42 }))).toBe("bad-html");
    expect(recapPayloadProblem(null)).toBe("bad-sender");
  });
  it("rejects a payload whose html exceeds MAX_RECAP_HTML_LENGTH", () => {
    expect(recapPayloadProblem(payload({ html: "x".repeat(MAX_RECAP_HTML_LENGTH) }))).toBeNull();
    expect(recapPayloadProblem(payload({ html: "x".repeat(MAX_RECAP_HTML_LENGTH + 1) }))).toBe("too-large");
  });
});
