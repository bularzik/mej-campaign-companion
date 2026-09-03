import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { UNLOCK_HINT } from "./env-lock.mjs";
import { TARGET } from "./target.mjs";

const DEFAULT_DATA = TARGET.data;

// There is currently only one checkout of mej-campaign-companion, so
// pinSymlink(MAIN_CHECKOUT) in global-teardown.mjs is a self-pin / no-op
// safety net (it just re-affirms the symlink already points here) rather
// than the multi-checkout dance campaign-record uses. It's kept for parity
// with that harness and in case a second checkout/worktree shows up later.
export const MAIN_CHECKOUT = TARGET.mainCheckout;

/** Files whose served bytes must match this checkout before any spec runs. */
export const SENTINELS = ["module.json", "scripts/campaign-companion.mjs"];

export function moduleLinkPath(dataDir) {
  if (!dataDir) {
    return TARGET.moduleLink;
  }
  return path.join(dataDir, "Data", "modules", "mej-campaign-companion");
}

export function md5Hex(data) {
  return crypto.createHash("md5").update(data).digest("hex");
}

export function currentSymlinkTarget(linkPath = moduleLinkPath()) {
  try {
    return fs.readlinkSync(linkPath);
  } catch {
    return null;
  }
}

/** Point the module symlink at a checkout. Refuses to clobber a non-symlink. */
export function pinSymlink(target, linkPath = moduleLinkPath()) {
  const st = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (st && !st.isSymbolicLink()) {
    throw new Error(`${linkPath} exists and is not a symlink — refusing to replace it.`);
  }
  if (st) fs.unlinkSync(linkPath);
  fs.symlinkSync(target, linkPath);
}

/**
 * Assert the running Foundry server serves exactly this checkout's code:
 * the symlink resolves here and each sentinel's served md5 matches disk.
 */
export async function verifyDeployment({
  baseURL, repoRoot, sentinels = SENTINELS, linkPath = moduleLinkPath()
}) {
  const link = currentSymlinkTarget(linkPath);
  const resolved = link == null ? null : path.resolve(path.dirname(linkPath), link);
  if (!resolved || resolved !== path.resolve(repoRoot)) {
    throw new Error(
      `Deployment check failed: module symlink points at ${link}, expected ${repoRoot}. ` +
      `Another session may own the environment. ${UNLOCK_HINT}`
    );
  }
  for (const rel of sentinels) {
    let res;
    try {
      res = await fetch(`${baseURL}/modules/mej-campaign-companion/${rel}`);
    } catch (err) {
      throw new Error(`Deployment check failed: could not reach the Foundry server for ${rel}: ${err.message}`);
    }
    if (!res.ok) {
      throw new Error(`Deployment check failed: could not fetch ${rel} (HTTP ${res.status}).`);
    }
    const served = md5Hex(Buffer.from(await res.arrayBuffer()));
    const disk = md5Hex(fs.readFileSync(path.join(repoRoot, rel)));
    if (served !== disk) {
      throw new Error(
        `Deployment check failed: Foundry is serving different code than this checkout (${rel}). ${UNLOCK_HINT}`
      );
    }
  }
}
