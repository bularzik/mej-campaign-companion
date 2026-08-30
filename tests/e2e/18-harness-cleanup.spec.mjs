// The harness testing itself (spec H1/H2): the two hazards the name-keyed
// cleanupTimelineJournal could not express. World A really does hold a
// pre-existing, empty journal named "Campaign Timeline", and campaign-owned
// timelines are named "<Campaign> — Timeline" and never matched the name filter
// at all, so they leaked.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, timelineJournalIds, cleanupTimelineJournals,
  gotoGame, reloadGame, trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const MODULE_ID = "mej-campaign-companion";

test.describe("18 harness cleanup", () => {
  test("deletes only flagged timelines that appeared, and never a name-alike", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // Seeded BEFORE the snapshot, deliberately EMPTY: this is what makes
    // preexistingAllSurvive below pin the id ledger rather than the TT-content
    // guard. World A's own flagged timeline ("Radiant Citadel — Timeline")
    // carries 33 real timepoints, so it survives cleanup on content alone -
    // drop the keepSet clause from cleanupTimelineJournals and that journal
    // still lives, and the assertion passes vacuously. An empty pre-existing
    // flagged timeline has nothing but the ledger protecting it, which is
    // precisely the hazard the old name-keyed helper could not express.
    const preseededId = await page.evaluate(async (id) => {
      const j = await JournalEntry.create({
        name: "TT-Preexisting Empty Timeline",
        flags: { [id]: { timeline: { timepoints: [] } } }
      });
      return j.id;
    }, MODULE_ID);
    const preexisting = await timelineJournalIds(page);
    expect(preexisting).toContain(preseededId);

    const seeded = await page.evaluate(async ({ id, prefix }) => {
      // A user document that merely shares the singleton's name - the exact
      // World A hazard. No module flag, so it is not a timeline at all.
      const lookalike = await JournalEntry.create({ name: "Campaign Timeline" });
      // A flagged timeline created after the snapshot: fair game.
      const appeared = await JournalEntry.create({
        name: `${prefix}Appeared Timeline`,
        flags: { [id]: { timeline: { timepoints: [{ id: "t1", label: `${prefix}point` }] } } }
      });
      // A flagged timeline carrying real content: never deleted, only stripped.
      const real = await JournalEntry.create({
        name: `${prefix}Real Timeline`,
        flags: { [id]: { timeline: { timepoints: [{ id: "t2", label: "Session Zero" }, { id: "t3", label: `${prefix}point` }] } } }
      });
      return { lookalikeId: lookalike.id, appearedId: appeared.id, realId: real.id };
    }, { id: MODULE_ID, prefix: TT_PREFIX });

    await cleanupTimelineJournals(page, preexisting);

    const after = await page.evaluate(({ ids, keep, id }) => ({
      lookalikeSurvives: !!game.journal.get(ids.lookalikeId),
      appearedGone: !game.journal.get(ids.appearedId),
      realSurvives: !!game.journal.get(ids.realId),
      realLabels: (game.journal.get(ids.realId)?.getFlag(id, "timeline")?.timepoints ?? []).map((t) => t.label),
      preexistingAllSurvive: keep.every((k) => !!game.journal.get(k))
    }), { ids: seeded, keep: preexisting, id: MODULE_ID });

    expect(after.lookalikeSurvives).toBe(true);
    expect(after.appearedGone).toBe(true);
    expect(after.realSurvives).toBe(true);
    expect(after.realLabels).toEqual(["Session Zero"]);
    expect(after.preexistingAllSurvive).toBe(true);

    // Tear down this test's own fixtures by id, never by name.
    await page.evaluate(async (ids) => {
      const doomed = [ids.lookalikeId, ids.realId, ids.preseededId].filter((i) => game.journal.get(i));
      if (doomed.length) await JournalEntry.implementation.deleteDocuments(doomed);
    }, { ...seeded, preseededId });
    assertNoConsoleErrors(errors);
  });

  test("gotoGame and reloadGame return on a session-bound document", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await gotoGame(page);
    await settle(page, 300);
    expect(await page.evaluate(() => !!game.socket?.session?.userId)).toBe(true);
    await reloadGame(page);
    await settle(page, 300);
    expect(await page.evaluate(() => !!game.socket?.session?.userId)).toBe(true);
    assertNoConsoleErrors(errors);
  });
});
