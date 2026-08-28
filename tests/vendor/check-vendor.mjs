#!/usr/bin/env node
// Verify the checked-in vendor bundles still match their recorded checksums.
//
// These files ship in the release zip but are installed by nothing, so
// `npm audit` never inspects them and no lockfile pins them (S5). This is the
// integrity half of that gap: it does not tell you WHICH version a bundle is
// (see vendor/README.md - currently unknown, and unrecoverable by checksum
// against published releases), but it does guarantee the bytes in a release
// are the bytes that were reviewed, and that a regeneration was accompanied by
// an updated record rather than landing silently.
//
// Run: npm run check:vendor   (also runs in CI, beside the unit suite)
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR_DIR = join(REPO_ROOT, "vendor");
const MANIFEST = join(VENDOR_DIR, "checksums.txt");

/** Parse `shasum -a 256` output: "<hex>  <filename>" per line. */
function parseManifest(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
      if (!match) throw new Error(`vendor/checksums.txt: cannot parse line: ${line}`);
      return { expected: match[1], file: match[2] };
    });
}

const problems = [];
let entries;

try {
  entries = parseManifest(await readFile(MANIFEST, "utf8"));
} catch (error) {
  console.error(`check:vendor — could not read vendor/checksums.txt: ${error.message}`);
  process.exit(1);
}

if (!entries.length) {
  console.error("check:vendor — vendor/checksums.txt lists no files; expected at least one.");
  process.exit(1);
}

for (const { expected, file } of entries) {
  let bytes;
  try {
    bytes = await readFile(join(VENDOR_DIR, file));
  } catch {
    problems.push(`${file}: listed in checksums.txt but missing from vendor/`);
    continue;
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    problems.push(
      `${file}: checksum mismatch\n    recorded ${expected}\n    actual   ${actual}`
    );
  }
}

if (problems.length) {
  console.error("check:vendor — vendor bundles do not match their recorded checksums:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nIf this was a deliberate re-vendor, follow the regeneration steps in " +
    "vendor/README.md and update both that file and vendor/checksums.txt."
  );
  process.exit(1);
}

console.log(`check:vendor — ${entries.length} vendor bundles match their recorded checksums.`);
