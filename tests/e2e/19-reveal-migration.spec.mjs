import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { login, TT_PREFIX, trackConsoleErrors, assertNoConsoleErrors, reloadGame, KNOWN_MEJ_SESSION_ICON_404 } from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const BACKUP_DIR = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : "test-results";

test.describe("19 reveal migration v4", () => {
  test("legacy entry-level reveals are copied to every holding page; orphan dropped; entry flag kept", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    // Backup, by id, of every PRE-EXISTING entry-level record in the real
    // world before the migration is re-run against it. Never deleted here.
    const preexisting = await page.evaluate(() => game.journal.contents
      .map((e) => ({ uuid: e.uuid, name: e.name, reveals: e.getFlag("mej-campaign-companion", "secretReveals") ?? null }))
      .filter((r) => r.reveals && Object.keys(r.reveals).length));
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(join(BACKUP_DIR, "reveal-migration-backup.json"), JSON.stringify(preexisting, null, 2));
    console.log(`[19] backed up ${preexisting.length} pre-existing entry-level reveal map(s)`);

    const versionBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "dataVersion"));
    const AUD = { users: [], groups: ["g-mig"], all: false, revealedAt: 1 };
    const { id } = await page.evaluate(async ({ prefix, AUD }) => {
      const mej = { "monks-enhanced-journal": { type: "place" } };
      const entry = await JournalEntry.create({
        name: `${prefix}Migrate-Place`,
        flags: { "mej-campaign-companion": { secretReveals: { "secret-both": AUD, "secret-one": AUD, "secret-none": AUD } } },
        pages: [
          { name: "p1", type: "monks-enhanced-journal.place", flags: mej, text: { content: '<section class="secret" id="secret-both"><p>b</p></section><section class="secret" id="secret-one"><p>o</p></section>' } },
          { name: "p2", type: "monks-enhanced-journal.place", flags: mej, text: { content: '<section class="secret" id="secret-both"><p>b2</p></section>' } }
        ]
      });
      return { id: entry.id };
    }, { prefix: TT_PREFIX, AUD });
    try {
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 3));
      await reloadGame(page);
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 6, null, { timeout: 60_000 });
      const state = await page.evaluate((e) => {
        const entry = game.journal.get(e);
        const [p1, p2] = entry.pages.contents;
        return {
          p1: Object.keys(p1.getFlag("mej-campaign-companion", "secretReveals") ?? {}).sort(),
          p2: Object.keys(p2.getFlag("mej-campaign-companion", "secretReveals") ?? {}).sort(),
          entryKeys: Object.keys(entry.getFlag("mej-campaign-companion", "secretReveals") ?? {}).sort(),
          p2groups: p2.getFlag("mej-campaign-companion", "secretReveals")?.["secret-both"]?.groups
        };
      }, id);
      expect(state.p1).toEqual(["secret-both", "secret-one"]);
      expect(state.p2).toEqual(["secret-both"]);
      expect(state.p2groups).toEqual(["g-mig"]);
      expect(state.entryKeys).toEqual(["secret-both", "secret-none", "secret-one"]);
      // Idempotence: a second run writes nothing new.
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 3));
      await reloadGame(page);
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 6, null, { timeout: 60_000 });
      const again = await page.evaluate((e) => Object.keys(game.journal.get(e).pages.contents[1].getFlag("mej-campaign-companion", "secretReveals") ?? {}), id);
      expect(again).toEqual(["secret-both"]);
    } finally {
      await page.evaluate(async ({ e, v }) => {
        await game.journal.get(e)?.delete();
        await game.settings.set("mej-campaign-companion", "dataVersion", v);
      }, { e: id, v: versionBefore });
    }
    assertNoConsoleErrors(errors);
  });

  test("v6 folds per-player recaps into the shared recap and removes the flag", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const versionBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "dataVersion"));
    const { id, user1 } = await page.evaluate(async (prefix) => {
      const user1 = game.users.getName("User 1");
      const user2 = game.users.getName("User 2");
      const entry = await JournalEntry.create({
        name: `${prefix}Migrate-Session`,
        pages: [{
          name: "s",
          type: "mej-campaign-companion.session",
          flags: {
            "monks-enhanced-journal": { type: "session" },
            "mej-campaign-companion": { playerRecaps: { [user1.id]: "<p>Boot prints led away.</p>", [user2.id]: "<p></p>" } }
          },
          system: { recap: "<p>GM text.</p>", gmNotes: "" }
        }]
      });
      return { id: entry.id, user1: user1.name };
    }, TT_PREFIX);
    try {
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 5));
      await reloadGame(page);
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 6, null, { timeout: 60_000 });
      const state = await page.evaluate((e) => {
        const p = game.journal.get(e).pages.contents[0];
        return { recap: p.system.recap, flag: p.getFlag("mej-campaign-companion", "playerRecaps") };
      }, id);
      expect(state.recap).toBe(`<p>GM text.</p><h3>Recap — ${user1}</h3><p>Boot prints led away.</p>`);
      expect(state.flag).toBeUndefined();
      // Idempotence: a second run leaves the recap alone.
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 5));
      await reloadGame(page);
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 6, null, { timeout: 60_000 });
      const again = await page.evaluate((e) => game.journal.get(e).pages.contents[0].system.recap, id);
      expect(again).toBe(state.recap);
    } finally {
      await page.evaluate(async ({ e, v }) => {
        await game.journal.get(e)?.delete();
        await game.settings.set("mej-campaign-companion", "dataVersion", v);
      }, { e: id, v: versionBefore });
    }
    assertNoConsoleErrors(errors);
  });
});
