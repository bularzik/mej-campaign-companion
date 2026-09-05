// The import result summary is a toast, not a dialog (spec rule: a
// notification that needs no decision is ui.notifications, never a
// dialog). This helper builds the message strings; the wizard just hands
// them to ui.notifications.info/warn. See scripts/apps/import-wizard.mjs
// #showResult.
import { describe, it, expect } from "vitest";
import { importResultMessages } from "../scripts/logic/import-result.mjs";

const format = (k, d) => `${k.split(".").pop()}:${JSON.stringify(d)}`;

describe("importResultMessages", () => {
  it("counts only: resultSummary key, no issues", () => {
    const { info, issues } = importResultMessages(
      { created: 3, timepoints: 1, failed: [] }, [], 0, format
    );
    expect(info).toBe(`resultSummary:${JSON.stringify({ pages: 3, timepoints: 1, links: 0 })}`);
    expect(issues).toBeNull();
  });

  it("links > 0: resultSummaryLinked key", () => {
    const { info, issues } = importResultMessages(
      { created: 3, timepoints: 1, failed: [] }, [], 2, format
    );
    expect(info).toBe(`resultSummaryLinked:${JSON.stringify({ pages: 3, timepoints: 1, links: 2 })}`);
    expect(issues).toBeNull();
  });

  it("failures only: resultIssues message and failed names carried through", () => {
    const { issues } = importResultMessages(
      { created: 1, timepoints: 0, failed: ["Loot", "Recap"] }, [], 0, format
    );
    expect(issues.message).toBe(`resultIssues:${JSON.stringify({ failed: 2, warnings: 0 })}`);
    expect(issues.failed).toEqual(["Loot", "Recap"]);
    expect(issues.warnings).toEqual([]);
  });

  it("warnings only: resultIssues message and warnings carried through", () => {
    const { issues } = importResultMessages(
      { created: 1, timepoints: 0, failed: [] }, ["Some images could not be uploaded."], 0, format
    );
    expect(issues.message).toBe(`resultIssues:${JSON.stringify({ failed: 0, warnings: 1 })}`);
    expect(issues.failed).toEqual([]);
    expect(issues.warnings).toEqual(["Some images could not be uploaded."]);
  });

  it("both failures and warnings: counts both", () => {
    const { issues } = importResultMessages(
      { created: 1, timepoints: 0, failed: ["Loot"] }, ["Some images could not be uploaded."], 0, format
    );
    expect(issues.message).toBe(`resultIssues:${JSON.stringify({ failed: 1, warnings: 1 })}`);
    expect(issues.failed).toEqual(["Loot"]);
    expect(issues.warnings).toEqual(["Some images could not be uploaded."]);
  });

  it("results undefined: zeros, no issues", () => {
    const { info, issues } = importResultMessages(undefined, undefined, undefined, format);
    expect(info).toBe(`resultSummary:${JSON.stringify({ pages: 0, timepoints: 0, links: 0 })}`);
    expect(issues).toBeNull();
  });
});
