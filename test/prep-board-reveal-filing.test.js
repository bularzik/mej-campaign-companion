import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fileRevealChange: vi.fn(async () => {}),
  audience: { users: ["u1"], groups: [], all: false },
  secrets: [{ id: "s1", text: "The vizier lies", revealed: false }]
}));

vi.mock("../scripts/hooks/reveal-filing.mjs", () => ({
  fileRevealChange: (...a) => h.fileRevealChange(...a),
  revealLabel: (kind, name) => `${kind}:${name}`
}));
vi.mock("../scripts/apps/audience-dialog.mjs", () => ({
  promptAudience: async () => h.audience,
  sendRevealWhisper: async () => {}
}));
vi.mock("../scripts/sheets/session-data.mjs", () => ({ sessionData: () => ({ secrets: h.secrets, attendees: [] }) }));
vi.mock("../scripts/search/live-index.mjs", () => ({ outboundRefsForEntry: () => [], mentionBadgeCounts: () => ({}) }));

globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B } },
  utils: { escapeHTML: (s) => s }
};

const { PrepBoardApp } = await import("../scripts/apps/prep-board-app.mjs");

describe("PrepBoardApp.onRevealSecret files the reveal", () => {
  beforeEach(() => {
    h.fileRevealChange.mockClear();
    const entry = { name: "Session 4", uuid: "JournalEntry.e1" };
    globalThis.game = {
      user: { isGM: true },
      i18n: { localize: (k) => k },
      settings: { get: () => ({}) }
    };
    globalThis.page = { parent: entry, update: vi.fn(async () => {}) };
  });

  it("calls fileRevealChange with the pre-write seed, new audience and entry label", async () => {
    const page = globalThis.page;
    const self = { page, render: vi.fn(async () => {}) };
    const target = { closest: () => ({ dataset: { id: "s1" } }) };
    await PrepBoardApp.onRevealSecret.call(self, {}, target);
    expect(page.update).toHaveBeenCalledTimes(1);
    expect(h.fileRevealChange).toHaveBeenCalledTimes(1);
    const arg = h.fileRevealChange.mock.calls[0][0];
    expect(arg).toMatchObject({
      entry: page.parent, target: page, kind: "checklist", id: "s1",
      audience: h.audience, label: "checklist:Session 4"
    });
    expect(arg.previous).toMatchObject({ users: [], groups: [], all: false });
  });
});
