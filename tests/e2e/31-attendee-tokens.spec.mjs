// Session sheet attendees render as small tokens (<= 80px) with the
// character name under each and, when a player owns the character, the
// player's name beneath that. They used to inherit MEJ's .item-image sizing
// and filled the tab.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, deleteActorsByPrefix, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

test.describe("31 attendee tokens", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      });
      await deleteActorsByPrefix(gmPage);
    });
  });

  test("attendees are small tokens with character and player names", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { sessionId, pcName, playerName, npcName } = await page.evaluate(async ({ prefix }) => {
      const player = game.users.find((u) => !u.isGM);
      const pcName = `${prefix}Attendee Pc`;
      const npcName = `${prefix}Attendee Npc`;
      const pc = await Actor.create({ name: pcName, type: "character", ownership: { default: 0, [player.id]: 3 } });
      const npc = await Actor.create({ name: npcName, type: "npc" });
      const session = await JournalEntry.create({
        name: `${prefix}Attendee-Session`,
        pages: [{
          name: "s",
          type: "mej-campaign-companion.session",
          flags: {
            "mej-campaign-companion": { session: { sessionNumber: 1, campaignDate: null, attendees: [pc.uuid, npc.uuid], secrets: [] } },
            "monks-enhanced-journal": { type: "session" }
          }
        }]
      });
      return { sessionId: session.id, pcName, playerName: player.name, npcName };
    }, { prefix: TT_PREFIX });

    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, sessionId);
    await settle(page, 500);
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell).toContainText(pcName);

    const tiles = shell.locator(".attendees-list .mej-cc-attendee");
    await expect(tiles).toHaveCount(2);
    for (const box of await tiles.locator(".mej-cc-attendee-token").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.width).toBeGreaterThan(24);
      expect(box.width).toBeLessThanOrEqual(80);
      expect(box.height).toBeLessThanOrEqual(80);
    }
    const pcTile = tiles.filter({ hasText: pcName });
    await expect(pcTile.locator(".mej-cc-attendee-name")).toHaveText(pcName);
    await expect(pcTile.locator(".mej-cc-attendee-player")).toHaveText(playerName);
    // An actor no player owns shows no player line at all.
    await expect(tiles.filter({ hasText: npcName }).locator(".mej-cc-attendee-player")).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });
});
