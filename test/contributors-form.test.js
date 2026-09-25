// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readContributors } from "../scripts/logic/campaigns.mjs";

describe("readContributors", () => {
  it("collects checked user and group boxes", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input type="checkbox" name="contributorUser" value="u1" checked>' +
      '<input type="checkbox" name="contributorUser" value="u2">' +
      '<input type="checkbox" name="contributorGroup" value="g1" checked>';
    expect(readContributors(form)).toEqual({ userIds: ["u1"], groupIds: ["g1"] });
  });
});
