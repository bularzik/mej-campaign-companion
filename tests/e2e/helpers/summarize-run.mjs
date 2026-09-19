// Summarise a Playwright JSON report (reporter=json) as a markdown table:
// one row per spec file with passed/failed/skipped, then one line per
// failed test with its first error line.
//   node tests/e2e/helpers/summarize-run.mjs <report.json> [label]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** @returns {{ rows: Map<string, {passed:number,failed:number,skipped:number}>, failures: Array<{file:string,line:number,title:string,error:string}> }} */
export function summarize(report) {
  const rows = new Map();
  const failures = [];
  const walk = (suite, inherited) => {
    const file = suite.file ?? inherited;
    for (const spec of suite.specs ?? []) {
      const row = rows.get(file) ?? { passed: 0, failed: 0, skipped: 0 };
      for (const t of spec.tests ?? []) {
        const status = t.status ?? "skipped";
        if (status === "expected" || status === "flaky") row.passed++;
        else if (status === "skipped") row.skipped++;
        else {
          row.failed++;
          const message = (t.results ?? []).find((r) => r.error)?.error?.message ?? "";
          failures.push({ file, line: spec.line, title: spec.title, error: message.split("\n")[0] });
        }
      }
      rows.set(file, row);
    }
    for (const s of suite.suites ?? []) walk(s, file);
  };
  for (const s of report.suites ?? []) walk(s, s.file);
  return { rows, failures };
}

export function render({ rows, failures }, label = "") {
  const lines = ["| Spec | passed | failed | skipped |", "|---|---|---|---|"];
  const total = { passed: 0, failed: 0, skipped: 0 };
  for (const [file, r] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${file.replace(/^tests\/e2e\//, "")} | ${r.passed} | ${r.failed} | ${r.skipped} |`);
    total.passed += r.passed; total.failed += r.failed; total.skipped += r.skipped;
  }
  lines.push(`| **total${label ? ` (${label})` : ""}** | ${total.passed} | ${total.failed} | ${total.skipped} |`);
  if (failures.length) {
    lines.push("", "Failures:");
    for (const f of failures) lines.push(`- \`${f.file.replace(/^tests\/e2e\//, "")}:${f.line}\` "${f.title}" — ${f.error}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, label] = process.argv.slice(2);
  if (!file) {
    console.error("usage: summarize-run.mjs <report.json> [label]");
    process.exit(2);
  }
  console.log(render(summarize(JSON.parse(readFileSync(file, "utf8"))), label));
}
