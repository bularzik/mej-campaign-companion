#!/usr/bin/env node
// Verify the checked-in vendor bundles still match their recorded checksums.
//
// These files ship in the release zip but are installed by nothing, so
// `npm audit` never inspects them and no lockfile pins them (S5). This is the
// integrity half of that gap: it guarantees the bytes in a release are the bytes
// that were reviewed, and that a regeneration was accompanied by an updated
// record. A third manifest field records WHICH published package a bundle is,
// where that is known (mammoth is `mammoth@1.12.0`, established by hashing
// `npm pack` output for every release 1.6.0-1.12.2); `--verify-upstream` re-checks
// that claim against the registry, and is opt-in so the default run stays offline.
//
// Run: npm run check:vendor   (also runs in CI, beside the unit suite)
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR_DIR = join(REPO_ROOT, "vendor");
const MANIFEST = join(VENDOR_DIR, "checksums.txt");

/** Parse `shasum -a 256` output plus an optional package claim: "<hex>  <file>  [<name>@<version>]". */
export function parseManifest(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^([0-9a-f]{64})\s+(\S+)(?:\s+(\S+@\S+))?$/.exec(line);
      if (!match) throw new Error(`vendor/checksums.txt: cannot parse line: ${line}`);
      return { expected: match[1], file: match[2], pkg: match[3] ?? null };
    });
}

/** Tarball path of the browser bundle we vendor, per package. */
const UPSTREAM_PATHS = {
  mammoth: "package/mammoth.browser.min.js",
  docx: "package/build/index.iife.js"
};

async function main({ verifyUpstream = false } = {}) {
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

  for (const { expected, file, pkg } of entries) {
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
      continue;
    }
    if (verifyUpstream && pkg) {
      const problem = await verifyUpstreamEntry({ file, pkg, expected });
      if (problem) problems.push(problem);
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

  console.log(`check:vendor — ${entries.length} vendor bundles match their recorded checksums ` +
    `(${entries.filter((e) => e.pkg).map((e) => e.pkg).join(", ") || "no package claims recorded"}).`);
}

/** Opt-in: re-hash the package the manifest claims, straight from the registry. */
async function verifyUpstreamEntry({ file, pkg, expected }) {
  const [name] = pkg.split("@");
  const source = UPSTREAM_PATHS[name];
  if (!source) return `${file}: no upstream path known for ${name}; cannot verify`;
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "check-vendor-"));
  try {
    const { stdout } = await run("npm", ["pack", pkg, "--pack-destination", dir], { cwd: dir });
    const tarball = stdout.trim().split("\n").pop();
    await run("tar", ["xzf", tarball, "-C", dir], { cwd: dir });
    const bytes = await readFile(join(dir, source));
    const actual = createHash("sha256").update(bytes).digest("hex");
    return actual === expected ? null : `${file}: recorded as ${pkg}, but that release hashes to ${actual}`;
  } catch (error) {
    return `${file}: could not fetch ${pkg} (${error.message})`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main({ verifyUpstream: process.argv.includes("--verify-upstream") });
}
