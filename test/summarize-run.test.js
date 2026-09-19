import { describe, it, expect } from "vitest";
import { summarize, render } from "../tests/e2e/helpers/summarize-run.mjs";

const report = {
  suites: [
    {
      file: "tests/e2e/02-hub-timeline.spec.mjs",
      specs: [],
      suites: [
        {
          file: "tests/e2e/02-hub-timeline.spec.mjs",
          specs: [
            { title: "opens the hub", line: 30, tests: [{ status: "expected", results: [{ status: "passed" }] }] },
            { title: "index row click", line: 120, tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "expect(received).toBe(expected)\n\nExpected: 1" } }] }] },
            { title: "skipped one", line: 200, tests: [{ status: "skipped", results: [] }] }
          ]
        }
      ]
    }
  ]
};

describe("summarize", () => {
  it("counts per spec file and lists failures with the first error line", () => {
    const { rows, failures } = summarize(report);
    expect(rows.get("tests/e2e/02-hub-timeline.spec.mjs")).toEqual({ passed: 1, failed: 1, skipped: 1 });
    expect(failures).toEqual([
      { file: "tests/e2e/02-hub-timeline.spec.mjs", line: 120, title: "index row click", error: "expect(received).toBe(expected)" }
    ]);
  });
  it("treats a flaky test (passed on retry) as passed", () => {
    const r = { suites: [{ file: "a.spec.mjs", specs: [{ title: "t", line: 1, tests: [{ status: "flaky", results: [] }] }] }] };
    expect(summarize(r).rows.get("a.spec.mjs")).toEqual({ passed: 1, failed: 0, skipped: 0 });
  });
});

describe("render", () => {
  it("includes the total row and a Failures section for the CLI path", () => {
    const out = render(summarize(report), "run 1");
    expect(out).toContain("| **total (run 1)** | 1 | 1 | 1 |");
    expect(out).toContain("Failures:");
  });
});
