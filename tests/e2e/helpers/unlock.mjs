import { forceUnlock } from "./env-lock.mjs";
import { pinSymlink, MAIN_CHECKOUT, moduleLinkPath } from "./deploy.mjs";

const prior = forceUnlock();
if (prior.held) {
  console.log(
    `Removed lock held by pid ${prior.info?.pid ?? "?"} (worktree ${prior.info?.worktree ?? "?"})` +
    (prior.alive ? " — NOTE: that process was still alive." : " — process was dead.")
  );
} else {
  console.log("No lock was held.");
}
pinSymlink(MAIN_CHECKOUT);
console.log(`Module symlink restored: ${moduleLinkPath()} -> ${MAIN_CHECKOUT}`);
