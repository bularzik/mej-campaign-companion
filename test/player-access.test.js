import { describe, it, expect } from "vitest";
import {
  shouldOfferPlayerAccess, shouldPromptReload, playerAccessWrites, MEJ_ALLOW_PLAYER_FULL_KEY
} from "../scripts/logic/player-access.mjs";

describe("shouldOfferPlayerAccess (spec 2026-10-08 §When the check runs)", () => {
  const base = { isGM: true, allowPlayer: false, warnEnabled: true };
  it("offers to a GM when the setting is off and the warning is on", () => {
    expect(shouldOfferPlayerAccess(base)).toBe(true);
  });
  it("never offers to a player", () => {
    expect(shouldOfferPlayerAccess({ ...base, isGM: false })).toBe(false);
  });
  it("does not offer when the setting is already on", () => {
    expect(shouldOfferPlayerAccess({ ...base, allowPlayer: true })).toBe(false);
  });
  it("does not offer when MEJ's setting is unregistered", () => {
    expect(shouldOfferPlayerAccess({ ...base, allowPlayer: undefined })).toBe(false);
  });
  it("does not offer after 'Don't show this again'", () => {
    expect(shouldOfferPlayerAccess({ ...base, warnEnabled: false })).toBe(false);
  });
});

describe("shouldPromptReload (spec §Player reload prompt)", () => {
  const base = { isGM: false, key: MEJ_ALLOW_PLAYER_FULL_KEY, oldValue: false, newValue: true };
  it("prompts a player when the setting goes off -> on", () => {
    expect(shouldPromptReload(base)).toBe(true);
  });
  it("prompts when the setting record did not exist before (undefined -> on)", () => {
    expect(shouldPromptReload({ ...base, oldValue: undefined })).toBe(true);
  });
  it("never prompts a GM (second GM online)", () => {
    expect(shouldPromptReload({ ...base, isGM: true })).toBe(false);
  });
  it("ignores other settings", () => {
    expect(shouldPromptReload({ ...base, key: "monks-enhanced-journal.open-new-tab" })).toBe(false);
  });
  it("ignores on -> on", () => {
    expect(shouldPromptReload({ ...base, oldValue: true })).toBe(false);
  });
  it("ignores on -> off", () => {
    expect(shouldPromptReload({ ...base, oldValue: true, newValue: false })).toBe(false);
  });
});

describe("playerAccessWrites (spec §Results table)", () => {
  const allow = { namespace: "monks-enhanced-journal", key: "allow-player", value: true };
  const silence = { namespace: "mej-campaign-companion", key: "warnPlayerAccess", value: false };
  it("Enable, unticked: only allow-player", () => {
    expect(playerAccessWrites({ enable: true, dontShowAgain: false })).toEqual([allow]);
  });
  it("Enable, ticked: allow-player and the warning off", () => {
    expect(playerAccessWrites({ enable: true, dontShowAgain: true })).toEqual([allow, silence]);
  });
  it("Not now, unticked: nothing", () => {
    expect(playerAccessWrites({ enable: false, dontShowAgain: false })).toEqual([]);
  });
  it("Not now, ticked: only the warning off", () => {
    expect(playerAccessWrites({ enable: false, dontShowAgain: true })).toEqual([silence]);
  });
});
