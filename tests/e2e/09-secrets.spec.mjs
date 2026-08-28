import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, KNOWN_MEJ_SESSION_ICON_404, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEW = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
// Per-run-unique secret text (not just a fixed literal): chat messages are
// never deleted by Foundry on their own, and this suite's own cleanup can
// only delete what it knows to look for. Without a per-run-unique needle, a
// whisper left behind by a *previous* run of this file would still satisfy
// the "a whisper was sent" assertion below even if a future regression broke
// whisper-sending entirely — the check would pass vacuously against stale
// data forever. Computed once at module load, so both tests in this file
// (which share one createPlaceWithSecret template) see the same value.
const SECRET_TEXT = `TT-secret-${Date.now()}`;
const SECRET_HTML = `<p>Public intro.</p><section class="secret" id="secret-e2e1"><p>${SECRET_TEXT}</p></section>`;

async function createPlaceWithSecret(page, name) {
  return page.evaluate(async ({ n, html }) => {
    const entry = await JournalEntry.create({
      name: n,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      pages: [{ name: n, type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: html } }]
    });
    return { id: entry.id, uuid: entry.uuid };
  }, { n: name, html: SECRET_HTML });
}

// Scope to the enriched, read-only preview container. The MEJ/Foundry
// editor field scaffold *also* mounts a `<prose-mirror>` editable element
// carrying the page's raw (un-enriched) text.content — present in the DOM
// for any user who can open the sheet, editable or not, permanently
// 0x0/offsetParent-null (never actually rendered on screen) — independent
// of this module's secrets layer and present with or without it (confirmed
// live: same element shows up for a plain MEJ place page with a native
// `section.secret`, no companion involvement). An unscoped `section.secret`
// query double-counts it, and `.toContainText()` (which reads full
// `textContent`, not just visible text) would see straight through it too.
// The enriched `.editor-display` container is what a reveal actually
// controls and what a real user's screen shows, so that's what these tests
// assert against.
function contentPreview(shell) {
  return shell.locator('.editor-display[data-key="text.content"]');
}

async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  // Load-bearing render guard: several callers go on to assert something is
  // ABSENT from this shell (no secret visible, no whisper received). A
  // purely negative assertion like that passes vacuously if the shell never
  // actually rendered for this user in the first place (permission error,
  // crash, stale page) — so assert real, positive content actually mounted
  // (the page's own public text, always present regardless of reveal state)
  // before any caller relies on something else being absent from it.
  await expect(contentPreview(shell)).toContainText("Public intro.");
  return shell;
}

test.describe("09 secrets", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "playerGroups", []);
        // Reveal whispers aren't deleted by anything else — a stale one left
        // in game.messages from a prior run could otherwise satisfy a future
        // run's "a whisper was sent" check even if whisper-sending had
        // regressed (see SECRET_TEXT's per-run-unique comment above; this
        // cleanup is the other half of closing that gap).
        const chatIds = game.messages.filter((m) => m.content?.includes("TT-")).map((m) => m.id);
        if (chatIds.length) await ChatMessage.implementation.deleteDocuments(chatIds);
      });
    });
  });

  test("GM reveals a block to User 1: A sees block + whisper, User 2 sees neither", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { id } = await createPlaceWithSecret(page, `${TT_PREFIX}Secret-Place`);
    const gmShell = await openEntry(page, id);
    // GM sees the secret and the audience button.
    await expect(contentPreview(gmShell).locator("section.secret")).toHaveCount(1);
    const btn = gmShell.locator(".mej-cc-secret-audience");
    await expect(btn).toHaveCount(1);

    // Player 1 before reveal: no secret content.
    const p1Ctx = await browser.newContext(VIEW);
    const p1 = await p1Ctx.newPage();
    await login(p1, "User 1");
    const p1Shell = await openEntry(p1, id);
    await expect(contentPreview(p1Shell).locator("section.secret")).toHaveCount(0);
    // This baseline (no section, no text) is Foundry-core secret stripping
    // at enrichHTML() time, not this module's code — the module's own
    // contribution is the .mej-cc-revealed-to-you re-render after a reveal,
    // asserted below. Kept as a sanity baseline for the "before" state.
    await expect(contentPreview(p1Shell)).not.toContainText(SECRET_TEXT);

    // GM reveals to User 1.
    await btn.click();
    await settle(page, 300);
    const dialog = page.locator("dialog.application").last();
    await expect(dialog).toBeVisible();
    const u1Id = await page.evaluate(() => game.users.getName("User 1").id);
    await dialog.locator(`input[name="user-${u1Id}"]`).check();
    await dialog.locator('button[data-action="ok"]').click();
    await settle(page, 800);

    // Player 1 now sees the block (live update) and got a whisper.
    await expect(contentPreview(p1Shell).locator("section.secret.mej-cc-revealed-to-you")).toHaveCount(1);
    await expect(contentPreview(p1Shell)).toContainText(SECRET_TEXT);
    const whispered = await p1.evaluate(
      (text) => game.messages.contents.some((m) => m.content?.includes(text) && m.whisper?.length),
      SECRET_TEXT
    );
    expect(whispered).toBe(true);

    // Player 2 sees neither the block nor its own whisper (a whisper
    // targeted at User 1 has no User 2 recipient at all — its `whisper`
    // array simply won't include User 2's id — so this also confirms the
    // reveal didn't fan out beyond the intended audience).
    const p2Ctx = await browser.newContext(VIEW);
    const p2 = await p2Ctx.newPage();
    await login(p2, "User 2");
    const p2Shell = await openEntry(p2, id);
    await expect(contentPreview(p2Shell).locator("section.secret")).toHaveCount(0);
    const p2Whisper = await p2.evaluate(
      (text) => game.messages.contents.some((m) => m.content?.includes(text) && m.whisper?.includes(game.user.id)),
      SECRET_TEXT
    );
    expect(p2Whisper).toBe(false);

    await p1Ctx.close();
    await p2Ctx.close();
    assertNoConsoleErrors(errors);
  });

  test("group reveal follows live membership", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { id } = await createPlaceWithSecret(page, `${TT_PREFIX}Group-Place`);
    // Group contains only User 1; reveal to the group.
    await page.evaluate(async (entryId) => {
      const u1 = game.users.getName("User 1").id;
      await game.settings.set("mej-campaign-companion", "playerGroups", [{ id: "gA", name: "TT Group", members: [u1] }]);
      const entry = game.journal.get(entryId);
      await entry.update({ "flags.mej-campaign-companion.secretReveals.secret-e2e1": { users: [], groups: ["gA"], all: false, revealedAt: 1 } });
    }, id);

    const p2Ctx = await browser.newContext(VIEW);
    const p2 = await p2Ctx.newPage();
    await login(p2, "User 2");
    let p2Shell = await openEntry(p2, id);
    await expect(contentPreview(p2Shell).locator("section.secret")).toHaveCount(0);

    // User 2 joins the group -> sees the previously revealed secret.
    await page.evaluate(async () => {
      const u1 = game.users.getName("User 1").id;
      const u2 = game.users.getName("User 2").id;
      await game.settings.set("mej-campaign-companion", "playerGroups", [{ id: "gA", name: "TT Group", members: [u1, u2] }]);
    });
    await settle(p2, 600);
    p2Shell = await openEntry(p2, id); // reopen to re-render with new membership
    await expect(contentPreview(p2Shell)).toContainText(SECRET_TEXT);

    await p2Ctx.close();
    assertNoConsoleErrors(errors);
  });

  // setSectionRevealed reimplements what core's
  // HTMLSecretBlockElement#toggleRevealed does to a stored body. A pure
  // reimplementation can drift silently as Foundry changes, so assert the two
  // agree on real markup, in the live client, rather than trusting them to.
  test("setSectionRevealed agrees with Foundry's own toggleRevealed", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const mismatches = await page.evaluate(async () => {
      const { setSectionRevealed } = await import("/modules/mej-campaign-companion/scripts/logic/secret-blocks.mjs");
      const bodies = [
        '<p>A</p><section class="secret" id="secret-a">Hidden.</section>',
        '<section class="secret revealed" id="secret-a">Shown.</section>',
        '<section class="secret" id="secret-a">A</section><section class="secret" id="secret-b">B</section>'
      ];
      const out = [];
      for (const body of bodies) {
        const host = document.createElement("div");
        host.innerHTML = body;
        for (const section of host.querySelectorAll("section.secret")) {
          const el = document.createElement("secret-block");
          el.secret = section;
          const want = !section.classList.contains("revealed");
          const ours = setSectionRevealed(body, section.id, want);
          const theirs = el.toggleRevealed(body);
          if (ours !== theirs) out.push({ body, id: section.id, ours, theirs });
        }
      }
      return out;
    });

    expect(mismatches).toEqual([]);
    assertNoConsoleErrors(errors);
  });

  // The point of the whole round: "Everyone" must land in the page body as
  // Foundry's own class, so it survives outside this module's re-enrichment.
  test("revealing to everyone writes the native class and survives in the raw body", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    let entryId = null;
    try {
      entryId = await page.evaluate(async (prefix) => {
        const entry = await JournalEntry.create({
          name: `${prefix}NativeReveal`,
          pages: [{
            name: `${prefix}NativeReveal`,
            type: "monks-enhanced-journal.person",
            flags: { "monks-enhanced-journal": { type: "person" } },
            text: { content: '<p>Public.</p><section class="secret" id="secret-native">Hidden truth.</section>' }
          }],
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });
        return entry.id;
      }, TT_PREFIX);

      const applied = await page.evaluate(async (id) => {
        const { applyBlockReveal } = await import("/modules/mej-campaign-companion/scripts/hooks/secrets-ui.mjs");
        const entry = game.journal.get(id);
        const pg = entry.pages.contents[0];
        const stored = await applyBlockReveal(pg, "secret-native", { all: true, users: [], groups: [] });
        await entry.update({ "flags.mej-campaign-companion.secretReveals.secret-native": stored });
        return {
          body: entry.pages.contents[0].text.content,
          storedAll: entry.getFlag("mej-campaign-companion", "secretReveals")["secret-native"].all
        };
      }, entryId);

      // The class is in the stored body...
      expect(applied.body).toContain("secret revealed");
      // ...and the private flag is NOT what carries it any more.
      expect(applied.storedAll).toBe(false);

      // Un-revealing removes it again.
      const after = await page.evaluate(async (id) => {
        const { applyBlockReveal } = await import("/modules/mej-campaign-companion/scripts/hooks/secrets-ui.mjs");
        const entry = game.journal.get(id);
        await applyBlockReveal(entry.pages.contents[0], "secret-native", { all: false, users: [], groups: [] });
        return game.journal.get(id).pages.contents[0].text.content;
      }, entryId);
      expect(after).not.toContain("revealed");

      assertNoConsoleErrors(errors);
    } finally {
      if (entryId) {
        await page.evaluate(async (id) => {
          if (game.journal.get(id)) await JournalEntry.implementation.deleteDocuments([id]);
        }, entryId);
      }
    }
  });

  // Legacy audience.all records convert on load; a record whose section has
  // since been deleted must be left alone and keep reading as "everyone",
  // rather than silently un-revealing.
  test("dataVersion 3 migration converts legacy Everyone reveals and leaves orphans intact", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    let entryId = null;
    const versionBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "dataVersion"));
    try {
      entryId = await page.evaluate(async (prefix) => {
        const entry = await JournalEntry.create({
          name: `${prefix}LegacyReveal`,
          pages: [{
            name: `${prefix}LegacyReveal`,
            type: "monks-enhanced-journal.person",
            flags: { "monks-enhanced-journal": { type: "person" } },
            text: { content: '<section class="secret" id="secret-live">Live.</section>' }
          }],
          flags: { "mej-campaign-companion": { secretReveals: {
            "secret-live": { all: true, users: [], groups: [], revealedAt: 1 },
            "secret-gone": { all: true, users: [], groups: [], revealedAt: 1 }
          } } }
        });
        return entry.id;
      }, TT_PREFIX);

      // Re-run the migration by rewinding dataVersion and reloading.
      await page.evaluate(async () => {
        await game.settings.set("mej-campaign-companion", "dataVersion", 2);
      });
      await page.reload();
      await settle(page, 3000);

      const result = await page.evaluate((id) => {
        const entry = game.journal.get(id);
        const reveals = entry.getFlag("mej-campaign-companion", "secretReveals");
        return {
          body: entry.pages.contents[0].text.content,
          liveAll: reveals["secret-live"].all,
          goneAll: reveals["secret-gone"].all,
          version: game.settings.get("mej-campaign-companion", "dataVersion")
        };
      }, entryId);

      expect(result.body).toContain("secret revealed");   // converted
      expect(result.liveAll).toBe(false);                 // flag cleared
      expect(result.goneAll).toBe(true);                  // orphan left alone
      expect(result.version).toBe(3);

      assertNoConsoleErrors(errors);
    } finally {
      await page.evaluate(async ({ id, versionBefore }) => {
        if (id && game.journal.get(id)) await JournalEntry.implementation.deleteDocuments([id]);
        await game.settings.set("mej-campaign-companion", "dataVersion", versionBefore);
      }, { id: entryId, versionBefore });
    }
  });

  // A secret written in a Session recap had no reveal path at all: no GM
  // audience button, no player re-enrichment, and the tracker hid the control.
  test("a recap-sourced secret can be revealed and reaches the player", async ({ browser }) => {
    const gmContext = await browser.newContext(VIEW);
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    let entryId = null;
    let playerContext = null;
    try {
      const seeded = await gmPage.evaluate(async (prefix) => {
        const entry = await JournalEntry.create({
          name: `${prefix}RecapSecret`,
          pages: [{
            name: `${prefix}RecapSecret`,
            type: "mej-campaign-companion.session",
            flags: { "monks-enhanced-journal": { type: "session" } },
            system: { recap: '<p>Public recap.</p><section class="secret" id="secret-recap">Recap truth.</section>', gmNotes: "" }
          }],
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });
        return { entryId: entry.id, userId: game.users.find((u) => !u.isGM && u.name === "User 1")?.id };
      }, TT_PREFIX);
      entryId = seeded.entryId;

      // Reveal it to User 1 through the shared write path.
      await gmPage.evaluate(async ({ id, userId }) => {
        const { applyBlockReveal } = await import("/modules/mej-campaign-companion/scripts/hooks/secrets-ui.mjs");
        const entry = game.journal.get(id);
        const stored = await applyBlockReveal(entry.pages.contents[0], "secret-recap", { all: false, users: [userId], groups: [] });
        await entry.update({ "flags.mej-campaign-companion.secretReveals.secret-recap": stored });
      }, { id: entryId, userId: seeded.userId });

      playerContext = await browser.newContext(VIEW);
      const playerPage = await playerContext.newPage();
      const errors = trackConsoleErrors(playerPage, { ignore: [...IGNORE, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG] });
      await login(playerPage, "User 1");
      await playerPage.evaluate(async (id) => {
        await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
      }, entryId);
      await settle(playerPage, 800);

      // The revealed recap secret is on screen for the player it was granted to.
      const shell = playerPage.locator("#MonksEnhancedJournal");
      await expect(shell.locator("section.secret.mej-cc-revealed-to-you")).toHaveCount(1);
      await expect(shell).toContainText("Recap truth.");

      assertNoConsoleErrors(errors);
    } finally {
      if (playerContext) await playerContext.close();
      await gmPage.evaluate(async (id) => {
        if (id && game.journal.get(id)) await JournalEntry.implementation.deleteDocuments([id]);
      }, entryId);
      await gmContext.close();
    }
  });
});
