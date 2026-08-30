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

    // Every id this test creates, recorded the moment its document exists, so
    // the finally below can delete exactly those and nothing else. The fixtures
    // here are named "Campaign Timeline" / "TT-Preexisting Empty Timeline" -
    // World A holds real journals with names like the first - so an assertion
    // that throws must NOT be allowed to strand them: teardown is a finally,
    // keyed by id, never a trailing statement keyed by a name.
    const createdIds = [];
    const create = async (spec) => {
      const id = await page.evaluate(async (s) => (await JournalEntry.create(s)).id, spec);
      createdIds.push(id);
      return id;
    };

    try {
      // Seeded BEFORE the snapshot, deliberately EMPTY: this is what makes
      // preexistingAllSurvive below pin the id ledger rather than the TT-content
      // guard. World A's own flagged timeline ("Radiant Citadel — Timeline")
      // carries 33 real timepoints, so it survives cleanup on content alone -
      // drop the keepSet clause from cleanupTimelineJournals and that journal
      // still lives, and the assertion passes vacuously. An empty pre-existing
      // flagged timeline has nothing but the ledger protecting it, which is
      // precisely the hazard the old name-keyed helper could not express.
      const preseededId = await create({
        name: "TT-Preexisting Empty Timeline",
        flags: { [MODULE_ID]: { timeline: { timepoints: [] } } }
      });
      const preexisting = await timelineJournalIds(page);
      expect(preexisting).toContain(preseededId);

      // One create per call, each id banked before the next runs: a throw in
      // the middle of a batched evaluate would leave an unrecorded document
      // behind, which is the same stranding this try/finally exists to stop.
      // A user document that merely shares the singleton's name - the exact
      // World A hazard. No module flag, so it is not a timeline at all.
      const lookalikeId = await create({ name: "Campaign Timeline" });
      // A flagged timeline created after the snapshot: fair game.
      const appearedId = await create({
        name: `${TT_PREFIX}Appeared Timeline`,
        flags: { [MODULE_ID]: { timeline: { timepoints: [{ id: "t1", label: `${TT_PREFIX}point` }] } } }
      });
      // A flagged timeline carrying real content: never deleted, only stripped.
      const realId = await create({
        name: `${TT_PREFIX}Real Timeline`,
        flags: { [MODULE_ID]: { timeline: { timepoints: [{ id: "t2", label: "Session Zero" }, { id: "t3", label: `${TT_PREFIX}point` }] } } }
      });

      await cleanupTimelineJournals(page, preexisting);

      const after = await page.evaluate(({ ids, keep, id }) => ({
        lookalikeSurvives: !!game.journal.get(ids.lookalikeId),
        appearedGone: !game.journal.get(ids.appearedId),
        realSurvives: !!game.journal.get(ids.realId),
        realLabels: (game.journal.get(ids.realId)?.getFlag(id, "timeline")?.timepoints ?? []).map((t) => t.label),
        preexistingAllSurvive: keep.every((k) => !!game.journal.get(k))
      }), { ids: { lookalikeId, appearedId, realId }, keep: preexisting, id: MODULE_ID });

      expect(after.lookalikeSurvives).toBe(true);
      expect(after.appearedGone).toBe(true);
      expect(after.realSurvives).toBe(true);
      expect(after.realLabels).toEqual(["Session Zero"]);
      expect(after.preexistingAllSurvive).toBe(true);
    } finally {
      // Tear down this test's own fixtures by id, never by name - and whether
      // or not the assertions above got that far.
      await page.evaluate(async (ids) => {
        const doomed = ids.filter((i) => game.journal.get(i));
        if (doomed.length) await JournalEntry.implementation.deleteDocuments(doomed);
      }, createdIds);
    }
    assertNoConsoleErrors(errors);
  });

  test("a missing id snapshot cancels the sweep instead of deleting everything", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // An empty flagged timeline is exactly what a real campaign's freshly
    // created default timeline looks like, and the TT-content guard cannot
    // tell that apart from this suite's own leavings. The id ledger is the
    // only thing between it and deletion - so a caller that never managed to
    // take its snapshot (a beforeAll that died inside withGmPage's login, which
    // happens on this host) must get NO sweep at all, not an unprotected one.
    const strandedId = await page.evaluate(async (id) => {
      const j = await JournalEntry.create({
        name: `${"TT-"}Stranded Empty Timeline`,
        flags: { [id]: { timeline: { timepoints: [] } } }
      });
      return j.id;
    }, MODULE_ID);
    const alive = () => page.evaluate((i) => !!game.journal.get(i), strandedId);

    // The last assertion below is that the sweep DID delete this fixture, so
    // in the happy path the finally finds nothing left. It exists for the
    // unhappy one: any assertion here throwing before that point would
    // otherwise leave "TT-Stranded Empty Timeline" behind in World A.
    try {
      await cleanupTimelineJournals(page, null);
      expect(await alive()).toBe(true);

      // An absent argument is the same case as an explicit null.
      await cleanupTimelineJournals(page);
      expect(await alive()).toBe(true);

      // Control, in the test itself rather than in a reviewer's hand-edit: with a
      // REAL ledger that happens to be empty ("I snapshotted, there was nothing")
      // the very same journal IS swept. Without this line the two assertions
      // above would still pass if cleanup had simply stopped working.
      await cleanupTimelineJournals(page, []);
      expect(await alive()).toBe(false);
    } finally {
      await page.evaluate(async (i) => {
        if (game.journal.get(i)) await JournalEntry.implementation.deleteDocuments([i]);
      }, strandedId);
    }

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
