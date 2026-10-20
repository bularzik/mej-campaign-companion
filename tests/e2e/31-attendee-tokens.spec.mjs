// Session attendees render as small chips in the page header (portrait +
// character name, the owning player's name as the tooltip). They used to be
// 64px tokens on the Details tab.
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

    // Attendees are chips in the session header: portrait + character name,
    // the owning player's name in the tooltip.
    const chips = shell.locator(".mej-cc-session-header .mej-cc-attendee-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toBeVisible();
    for (const box of await chips.locator(".mej-cc-attendee-token").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.width).toBeGreaterThanOrEqual(12);
      expect(box.width).toBeLessThanOrEqual(32);
      expect(box.height).toBeLessThanOrEqual(32);
    }
    const pcChip = chips.filter({ hasText: pcName });
    await expect(pcChip.locator(".mej-cc-attendee-name")).toHaveText(pcName);
    await expect(pcChip).toHaveAttribute("data-tooltip", playerName);
    // An actor no player owns carries no player name at all.
    await expect(chips.filter({ hasText: npcName })).not.toHaveAttribute("data-tooltip", /.+/);
    // The Details tab no longer lists attendees.
    await expect(shell.locator(".attendees-list")).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });
});
