import { describe, it, expect } from "vitest";
import { defaultImageFor, imageFor, MEJ_ASSET_PATH, COMPANION_ASSET_PATH } from "../scripts/logic/default-image.mjs";

const MEJ_TYPES = [
  "person", "place", "poi", "quest", "encounter", "event",
  "organization", "shop", "loot", "list", "slideshow", "journalentry"
];

describe("defaultImageFor", () => {
  it("returns MEJ's asset path for each of MEJ's built-in types", () => {
    for (const type of MEJ_TYPES) {
      expect(defaultImageFor(type)).toBe(`${MEJ_ASSET_PATH}/${type}.png`);
    }
  });

  it("returns the companion's asset path for session and campaign", () => {
    expect(defaultImageFor("session")).toBe(`${COMPANION_ASSET_PATH}/session.png`);
    expect(defaultImageFor("campaign")).toBe(`${COMPANION_ASSET_PATH}/campaign.png`);
  });

  it("returns null for types with no placeholder art", () => {
    expect(defaultImageFor("picture")).toBeNull();
    expect(defaultImageFor("text")).toBeNull();
    expect(defaultImageFor("pdf")).toBeNull();
    expect(defaultImageFor(undefined)).toBeNull();
    expect(defaultImageFor("")).toBeNull();
  });
});

describe("imageFor", () => {
  it("prefers a non-empty src over the type default", () => {
    expect(imageFor("x.png", "person")).toBe("x.png");
  });

  it("falls back to the type default when src is empty", () => {
    expect(imageFor("", "person")).toBe(`${MEJ_ASSET_PATH}/person.png`);
  });

  it("falls back to null when src is nullish and the type has no default", () => {
    expect(imageFor(null, "video")).toBeNull();
  });
});
