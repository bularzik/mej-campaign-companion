// Campaign Hub openers shared by the specs. openHub/scopeHub came from
// 14-campaigns.spec.mjs and openHubViaToolbar from 02-hub-timeline.spec.mjs
// (moved verbatim); keep their differences - openHub bootstraps the shell
// from an UNFILED entry, openHubViaToolbar from any non-timeline entry.
import { settle, unfiledBootstrapEntryId } from "./foundry.mjs";

/** Open any journal entry (bootstraps the MEJ shell), then open the Campaign Hub. Lands on the Index tab. */
export async function openHub(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  // Unfiled on purpose: since 0.27.0 the Hub button scopes the Hub to the
  // campaign of the entry the shell shows, which would hide this spec's
  // unfiled TT- fixtures. See unfiledBootstrapEntryId().
  const anyEntryId = await unfiledBootstrapEntryId(page);
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

/** Select the Hub's campaign-scope <select> ("" = All, "unfiled", or a campaign Folder id). */
export async function scopeHub(shell, page, value) {
  await shell.locator('select[name="campaign-scope"]').selectOption(value);
  await settle(page, 300);
}

/** Open any journal entry (so the MEJ shell + its toolbar exist), then click
 * the Campaign Hub toolbar button. Returns the shell locator. */
export async function openHubViaToolbar(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  // Not contents[0]: a timeline journal refuses to open in the MEJ shell
  // (hooks/timeline-open.mjs, spec 2026-09-03 §C), so picking one bootstraps
  // nothing and every later shell locator times out. See 16-multi-timeline's
  // openHub() for the full account.
  const anyEntryId = await page.evaluate(
    () => game.journal.contents.find((e) => !e.getFlag("mej-campaign-companion", "timeline"))?.id
  );
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}
