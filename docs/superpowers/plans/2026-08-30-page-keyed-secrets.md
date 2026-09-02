# Page-keyed Secret Reveals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move block-secret reveal records from the JournalEntry to the JournalEntryPage that holds the section, migrate existing worlds, and make every reader page-aware.

**Architecture:** A pure planner (`planPageKeyedMigration`) decides what the v3→v4 migration writes; the existing `ready`-hook runner applies it. `secrets-ui.mjs` reads/writes `page.flags.<mod>.secretReveals`; the search index tags every secret with its `pageUuid` across all MEJ pages of an entry; the Hub tracker resolves pages by that tag. The legacy entry flag is left untouched and never read again.

**Tech Stack:** Foundry VTT v14 ESM module, vitest unit tests (`npm test`), Playwright e2e against World A (`npm run e2e -- <spec>`), Handlebars templates.

**Spec:** `docs/superpowers/specs/2026-08-30-page-keyed-secrets-design.md`

## Global Constraints

- Companion features never patch MEJ; no edits outside this repo.
- World A is the user's real world: harness cleanup is id/flag-tracked only; anything not created by the run is surfaced, never deleted.
- Test fixes wait on real conditions — no `retries`, no `waitForTimeout`.
- Every product fix ships with a regression test and a **vacuity check** (disable the fix by hand-edit, watch the test fail, restore). Record the vacuity result in the task report.
- Regression gate: a full 19-spec e2e run diffed against `main`'s baseline, not a green targeted suite.
- The migration runs once, on the elected `activeGM` client, behind the existing `dataVersion` world-setting gate. It must be idempotent and must never delete or rewrite the legacy entry flag.
- Storage shape (verbatim): `page.flags["mej-campaign-companion"].secretReveals = { [sectionId]: { users, groups, all, revealedAt } }`.
- Migration copies a record to **every** page holding the id; ids on no page are dropped and logged.
- Release is 0.14.0.
- e2e env lock: if `/Users/danbularzik/FoundryVTT-14/Data/.claude-e2e-lock` is held by another job, wait; never `npm run e2e:unlock`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/logic/reveal-migration.mjs` | pure planners; gains `planPageKeyedMigration` |
| `test/reveal-migration.test.js` | planner unit tests |
| `scripts/hooks/secrets-ui.mjs` | sheet overlay, player render, prune, live refresh — all page-scoped |
| `scripts/search/live-index.mjs` | `recordFor` tags `meta.secrets` with `pageUuid` across all MEJ pages |
| `scripts/apps/CampaignHubPage.mjs` | tracker rows with `pageUuid`; `onTrackerAudience` + `#secretSectionHtml` page-resolved |
| `templates/hub.hbs` | secret row carries `data-page-uuid` |
| `lang/en.json` | `secrets.pageGone` |
| `scripts/constants.mjs` | `CURRENT_DATA_VERSION = 4` |
| `scripts/campaign-companion.mjs` | v4 runner step |
| `tests/e2e/09-secrets.spec.mjs` | page-flag rewrites + two new tests |
| `tests/e2e/10-secrets-hub.spec.mjs` | page-flag rewrite + duplicate-id tracker test |
| `tests/e2e/19-reveal-migration.spec.mjs` | new: v4 migration on World A with backup |
| `docs/gm-guide.md`, `CHANGELOG.md`, `module.json` | docs + 0.14.0 |

---

### Task 1: `planPageKeyedMigration` (pure planner)

**Files:**
- Modify: `scripts/logic/reveal-migration.mjs` (append)
- Test: `test/reveal-migration.test.js` (append)

**Interfaces:**
- Produces: `planPageKeyedMigration(entries) → { steps: [{ pageUuid, reveals }], dropped: [{ entryUuid, sectionId }] }` where `entries` is `[{ entryUuid, reveals: {[id]: audience}, pages: [{ pageUuid, sectionIds: string[], existing: {[id]: audience} }] }]`. Task 4 consumes it.

- [ ] **Step 1: Write the failing tests** — append to `test/reveal-migration.test.js`:

Change the import to `import { planNativeRevealMigration, planPageKeyedMigration } from "../scripts/logic/reveal-migration.mjs";` and append:

```js
const AUD = { users: ["u1"], groups: [], all: false, revealedAt: 1 };
const pk = (over = {}) => ({ entryUuid: "JournalEntry.e1", reveals: {}, pages: [], ...over });
const pg = (pageUuid, sectionIds = [], existing = {}) => ({ pageUuid, sectionIds, existing });

describe("planPageKeyedMigration", () => {
  it("copies a record to the one page holding its section", () => {
    expect(planPageKeyedMigration([pk({
      reveals: { "secret-a": AUD }, pages: [pg("P1", ["secret-a"])]
    })])).toEqual({ steps: [{ pageUuid: "P1", reveals: { "secret-a": AUD } }], dropped: [] });
  });

  it("copies a record to EVERY page holding a duplicate id", () => {
    const { steps } = planPageKeyedMigration([pk({
      reveals: { "secret-dup": AUD }, pages: [pg("P1", ["secret-dup"]), pg("P2", ["secret-dup"])]
    })]);
    expect(steps).toEqual([
      { pageUuid: "P1", reveals: { "secret-dup": AUD } },
      { pageUuid: "P2", reveals: { "secret-dup": AUD } }
    ]);
  });

  it("drops an id found on no page, naming entry and id", () => {
    expect(planPageKeyedMigration([pk({
      reveals: { "secret-gone": AUD }, pages: [pg("P1", ["secret-a"])]
    })])).toEqual({ steps: [], dropped: [{ entryUuid: "JournalEntry.e1", sectionId: "secret-gone" }] });
  });

  it("skips ids the page already holds; a second pass plans nothing", () => {
    const first = planPageKeyedMigration([pk({
      reveals: { "secret-a": AUD, "secret-b": AUD },
      pages: [pg("P1", ["secret-a", "secret-b"], { "secret-a": { users: ["u9"], groups: [], all: false, revealedAt: 5 } })]
    })]);
    expect(first.steps).toEqual([{ pageUuid: "P1", reveals: { "secret-b": AUD } }]);
    const second = planPageKeyedMigration([pk({
      reveals: { "secret-a": AUD, "secret-b": AUD },
      pages: [pg("P1", ["secret-a", "secret-b"], { "secret-a": AUD, "secret-b": AUD })]
    })]);
    expect(second).toEqual({ steps: [], dropped: [] });
  });

  it("copies a legacy all:true record verbatim", () => {
    const legacy = { users: [], groups: [], all: true, revealedAt: 2 };
    expect(planPageKeyedMigration([pk({
      reveals: { "secret-a": legacy }, pages: [pg("P1", ["secret-a"])]
    })]).steps[0].reveals["secret-a"]).toEqual(legacy);
  });

  it("plans nothing for an entry without reveals or a page ending empty", () => {
    expect(planPageKeyedMigration([pk({ pages: [pg("P1", ["secret-a"])] }), pk({ entryUuid: "JournalEntry.e2" })]))
      .toEqual({ steps: [], dropped: [] });
  });

  it("tolerates junk without throwing", () => {
    expect(() => planPageKeyedMigration([null, {}, pk({ reveals: "junk", pages: [null, { pageUuid: "P1" }] })])).not.toThrow();
    expect(planPageKeyedMigration(null)).toEqual({ steps: [], dropped: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- test/reveal-migration.test.js`. Expected: FAIL, `planPageKeyedMigration` is not exported.

- [ ] **Step 3: Implement** — append to `scripts/logic/reveal-migration.mjs`:

```js
/**
 * dataVersion 3 -> 4 planner: copy each entry-level reveal record onto EVERY
 * page whose body holds that section id (spec 2026-08-30 §2). Ids found on no
 * page are reported in `dropped`, never written. Ids a page already holds in
 * `existing` are skipped, so a re-run after a partial failure never overwrites
 * a record the GM may since have edited. Pure and Foundry-free; junk input is
 * tolerated because this runs during world load.
 *
 * @param {Array<{entryUuid:string, reveals:object, pages:Array<{pageUuid:string, sectionIds:string[], existing:object}>}>} entries
 * @returns {{steps:Array<{pageUuid:string, reveals:object}>, dropped:Array<{entryUuid:string, sectionId:string}>}}
 */
export function planPageKeyedMigration(entries) {
  const steps = [];
  const dropped = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const reveals = entry?.reveals && typeof entry.reveals === "object" ? entry.reveals : {};
    const ids = Object.keys(reveals);
    if (!ids.length) continue;
    const pages = (Array.isArray(entry.pages) ? entry.pages : []).filter((p) => p && typeof p.pageUuid === "string");
    const seen = new Set();
    for (const page of pages) {
      const present = new Set(Array.isArray(page.sectionIds) ? page.sectionIds : []);
      const existing = page.existing && typeof page.existing === "object" ? page.existing : {};
      const out = {};
      for (const id of ids) {
        if (!present.has(id)) continue;
        seen.add(id);
        if (id in existing) continue;
        out[id] = reveals[id];
      }
      if (Object.keys(out).length) steps.push({ pageUuid: page.pageUuid, reveals: out });
    }
    for (const id of ids) if (!seen.has(id)) dropped.push({ entryUuid: entry.entryUuid, sectionId: id });
  }
  return { steps, dropped };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- test/reveal-migration.test.js`. Expected: all pass (existing 8 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/reveal-migration.mjs test/reveal-migration.test.js
git commit -m "feat(secrets): pure planner for page-keyed reveal migration"
```

---

### Task 2: `secrets-ui.mjs` reads and writes the page flag

**Files:**
- Modify: `scripts/hooks/secrets-ui.mjs`
- Modify: `tests/e2e/09-secrets.spec.mjs` (flag writes at lines 207, 308, 311, 465, 534, 612–650, 695, 749 → page flags; two new tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: page-flag storage contract used by Tasks 3 and 4: `page.getFlag(MODULE_ID, "secretReveals")`.

- [ ] **Step 1: Rewrite the reader and the write sites** in `scripts/hooks/secrets-ui.mjs`:

```js
// replace
const revealsOf = (entry) => entry?.getFlag?.(MODULE_ID, REVEALS_FLAG) ?? {};
// with
/** Reveal records live on the PAGE that holds the section (spec 2026-08-30). */
const revealsOf = (page) => page?.getFlag?.(MODULE_ID, REVEALS_FLAG) ?? {};
```

In `injectGmOverlay`: `const reveals = revealsOf(page);` (was `revealsOf(entry)`); `await pruneOrphans(page);` (was `(entry, page)`).

In `editAudience`: `const record = revealsOf(page)[sectionId];` and
```js
await page.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}.${sectionId}`]: stored });
```
(was `entry.update`). Keep `entry` for the whisper's `entryUuid`/`entryName`.

`pruneOrphans` becomes:

```js
/**
 * Drop reveal records whose section no longer exists in THIS page's body.
 * Page-scoped read and page-scoped write: the entry-level version deleted
 * page 2's records whenever page 1 was opened (spec 2026-08-30 defect 2).
 */
async function pruneOrphans(page) {
  const reveals = revealsOf(page);
  if (!Object.keys(reveals).length) return;
  const liveIds = extractSecretBlocks(bodyRegion(page).content).map((s) => s.id);
  const { map, changed } = pruneReveals(reveals, liveIds);
  // recursive:false replaces the whole map - a merging update would leave
  // pruned ids in storage, ready to reattach if a section id is reused.
  if (changed) await page.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}`]: map }, { recursive: false });
}
```

In `injectPlayerSecrets`: `const reveals = revealsOf(page);` (delete the `entry ?? {}` read; keep `entry` only if still referenced — it is not, so remove `const entry = page.parent;`).

Live refresh: in `registerSecretsUi`, the `updateJournalEntry` hook watches only `relReveals`:
```js
Hooks.on("updateJournalEntry", (entry, changes) => {
  if (changes?.flags?.[MODULE_ID]?.relReveals === undefined) return;
  refreshRevealViews(entry);
});
```
and the `updateJournalEntryPage` hook widens:
```js
Hooks.on("updateJournalEntryPage", (page, changes) => {
  const flags = changes?.flags?.[MODULE_ID];
  if (flags?.[REVEALS_FLAG] === undefined && flags?.session?.secrets === undefined) return;
  const entry = page.parent;
  if (!entry) return;
  refreshRevealViews(entry);
});
```
Update the two hooks' comments to say block reveals are now a page-level flag.

- [ ] **Step 2: Rewrite 09's direct flag access to page flags.** Every `entry.update({ "flags.mej-campaign-companion.secretReveals.<id>": … })` becomes `entry.pages.contents[0].update({ … })`; every `entry.getFlag("mej-campaign-companion", "secretReveals")` becomes `entry.pages.contents[0].getFlag(...)`; the `JournalEntry.create` at line ~612 that seeds `flags: { "mej-campaign-companion": { secretReveals: {…} } }` on the entry is the **v3 migration test** and stays entry-level (it exercises the legacy shape; the v4 step, added in Task 4, copies it to the page — assert nothing about page flags there). Line 642's read of the entry flag in that test stays.

- [ ] **Step 3: Add the two-page fixture and tests** to `09-secrets.spec.mjs`:

```js
const DUP_HTML_1 = `<p>Page one intro.</p><section class="secret" id="secret-dup"><p>${SECRET_TEXT}-one</p></section>`;
const DUP_HTML_2 = `<p>Page two intro.</p><section class="secret" id="secret-dup"><p>${SECRET_TEXT}-two</p></section>`;

async function createTwoPagePlace(page, name) {
  return page.evaluate(async ({ n, h1, h2 }) => {
    const mej = { "monks-enhanced-journal": { type: "place" } };
    const entry = await JournalEntry.create({
      name: n, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      pages: [
        { name: `${n} p1`, type: "monks-enhanced-journal.place", flags: mej, text: { content: h1 } },
        { name: `${n} p2`, type: "monks-enhanced-journal.place", flags: mej, text: { content: h2 } }
      ]
    });
    const [p1, p2] = entry.pages.contents;
    return { id: entry.id, p1Id: p1.id, p2Id: p2.id };
  }, { n: name, h1: DUP_HTML_1, h2: DUP_HTML_2 });
}

async function openPage(page, entryId, pageId, anchor) {
  await page.evaluate(async ({ e, p }) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(e).pages.get(p));
  }, { e: entryId, p: pageId });
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  await expect(contentPreview(shell)).toContainText(anchor);
  return shell;
}

test("duplicate section id on two pages: reveal from page 2 touches only page 2", async ({ page, browser }) => {
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, "Gamemaster");
  const { id, p1Id, p2Id } = await createTwoPagePlace(page, `${TT_PREFIX}Dup-Place`);
  const gmShell = await openPage(page, id, p2Id, "Page two intro.");
  const u1Id = await page.evaluate(() => game.users.getName("User 1").id);
  await clickWithHitDiagnostics(gmShell.locator(".mej-cc-secret-audience"), page);
  const dialog = page.locator("dialog.application").last();
  await expect(dialog).toBeVisible();
  await dialog.locator(`input[name="user-${u1Id}"]`).check();
  await dialog.locator('button[data-action="ok"]').click();

  const flags = await page.evaluate(({ e, a, b }) => {
    const entry = game.journal.get(e);
    return {
      p1: entry.pages.get(a).getFlag("mej-campaign-companion", "secretReveals") ?? null,
      p2: entry.pages.get(b).getFlag("mej-campaign-companion", "secretReveals") ?? null,
      entryLevel: entry.getFlag("mej-campaign-companion", "secretReveals") ?? null
    };
  }, { e: id, a: p1Id, b: p2Id });
  expect(flags.p1).toBeNull();
  expect(flags.entryLevel).toBeNull();
  expect(flags.p2?.["secret-dup"]?.users).toEqual([u1Id]);

  const p1Ctx = await browser.newContext(VIEW);
  const p1 = await p1Ctx.newPage();
  await login(p1, "User 1");
  const s2 = await openPage(p1, id, p2Id, "Page two intro.");
  await expect(contentPreview(s2).locator("section.secret.mej-cc-revealed-to-you")).toHaveCount(1);
  await expect(contentPreview(s2)).toContainText(`${SECRET_TEXT}-two`);
  const s1 = await openPage(p1, id, p1Id, "Page one intro.");
  await expect(contentPreview(s1).locator("section.secret")).toHaveCount(0);
  await p1Ctx.close();
  assertNoConsoleErrors(errors);
});

test("opening page 1 does not prune page 2's reveal records", async ({ page }) => {
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, "Gamemaster");
  const { id, p1Id, p2Id } = await createTwoPagePlace(page, `${TT_PREFIX}Prune-Place`);
  await page.evaluate(async ({ e, b }) => {
    const p2 = game.journal.get(e).pages.get(b);
    await p2.update({ "flags.mej-campaign-companion.secretReveals.secret-dup": { users: [], groups: ["gX"], all: false, revealedAt: 1 } });
    // A record page 2 no longer holds a section for: the page-scoped prune must drop it from page 2 ONLY when page 2 renders.
    await p2.update({ "flags.mej-campaign-companion.secretReveals.secret-stale": { users: [], groups: ["gX"], all: false, revealedAt: 1 } });
  }, { e: id, b: p2Id });
  await openPage(page, id, p1Id, "Page one intro.");
  // pruneOrphans runs inside the render hook; poll the stored state rather than sleeping.
  await page.waitForFunction(({ e, a }) => {
    const p1 = game.journal.get(e).pages.get(a);
    return document.querySelector("#MonksEnhancedJournal .mej-cc-secret-audience") && p1 !== undefined;
  }, { e: id, a: p1Id });
  const after = await page.evaluate(({ e, b }) => game.journal.get(e).pages.get(b).getFlag("mej-campaign-companion", "secretReveals"), { e: id, b: p2Id });
  expect(Object.keys(after).sort()).toEqual(["secret-dup", "secret-stale"]);
  await openPage(page, id, p2Id, "Page two intro.");
  await expect.poll(() => page.evaluate(({ e, b }) => Object.keys(game.journal.get(e).pages.get(b).getFlag("mej-campaign-companion", "secretReveals") ?? {}), { e: id, b: p2Id })).toEqual(["secret-dup"]);
  assertNoConsoleErrors(errors);
});
```

- [ ] **Step 4: Run** `npm test` (unit, unchanged) then `npm run e2e -- tests/e2e/09-secrets.spec.mjs`. Expected: all 09 tests pass.

- [ ] **Step 5: Vacuity checks.** (a) Revert `editAudience`'s write to `entry.update(...)` → the duplicate-id test must fail on `flags.p2` / `flags.entryLevel`. (b) Revert `pruneOrphans` to read `revealsOf(page.parent)` and write `page.parent.update(...)` with `liveIds` from `page` → the prune test must fail on `after`. Restore both; re-run the two tests green. Record results.

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/secrets-ui.mjs tests/e2e/09-secrets.spec.mjs
git commit -m "fix(secrets): store block reveals on the page that holds the section"
```

---

### Task 3: Page-aware index and Hub tracker

**Files:**
- Modify: `scripts/search/live-index.mjs:104-108` (`recordFor`)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`#secretsContext` ~673-700, `#secretSectionHtml` ~903-911, `onTrackerAudience` block branch ~925-955)
- Modify: `templates/hub.hbs:275`
- Modify: `lang/en.json` (`secrets.pageGone`)
- Modify: `tests/e2e/10-secrets-hub.spec.mjs` (line 61 → page flag; new test)
- Test: `test/secrets-tracker.test.js` (append)

**Interfaces:**
- Consumes: page-flag contract from Task 2.
- Produces: index secret shape `{ id, preview, revealedAll, pageUuid }`; tracker row field `pageUuid`; row `data-page-uuid`.

- [ ] **Step 1: Unit test** — append to `test/secrets-tracker.test.js`:

```js
it("passes a row's pageUuid through untouched", () => {
  const row = { entryType: "place", audience: { users: ["u1"] }, revealedAll: false, pageUuid: "JournalEntry.e.JournalEntryPage.p" };
  expect(filterTrackerRows([row], {})[0].pageUuid).toBe("JournalEntry.e.JournalEntryPage.p");
});
```
Run `npm test -- test/secrets-tracker.test.js` — passes already (filter spreads nothing away); it documents the contract. Keep it.

- [ ] **Step 2: Index** — in `recordFor`, replace line 108:

```js
  // Phase C (spec §9) + page-keyed reveals (spec 2026-08-30 §3): secret
  // blocks from EVERY MEJ page of the entry, each tagged with its page uuid.
  // Records are keyed by entry with last-page-wins, so reading only `page`
  // here left a multi-page entry's other secrets out of the tracker. GM-gated
  // at the accessors below - meta.secrets never reaches non-GM consumers.
  const siblings = (page.parent?.pages?.contents ?? [page]).filter((p) => mejType(p));
  record.meta.secrets = (siblings.length ? siblings : [page]).flatMap((p) =>
    extractSecretBlocks(bodyText(p)).map((s) => ({ ...s, pageUuid: p.uuid }))
  );
```

- [ ] **Step 3: Hub rows** — in `#secretsContext`, replace the block-secrets loop body:

```js
    for (const rec of gmSecretRecords()) {
      if (!scopedUuids.has(rec.uuid)) continue;
      const entry = fromUuidSync(rec.uuid);
      const multi = (entry?.pages?.contents ?? []).filter((p) => mejType(p)).length > 1;
      for (const s of rec.secrets) {
        // Records live on the page that holds the section (spec 2026-08-30);
        // sectionRevealedAll reads that page's own body and record.
        const page = s.pageUuid ? fromUuidSync(s.pageUuid) : null;
        if (!page) continue;
        const record = page.getFlag(MODULE_ID, "secretReveals")?.[s.id];
        const entryName = multi ? `${rec.name} · ${page.name}` : rec.name;
        rows.push({ kind: "block", entryUuid: rec.uuid, entryName, entryType: rec.type, secretId: s.id, pageUuid: page.uuid, preview: s.preview, audience: normalizeAudience(record), revealedAll: sectionRevealedAll(bodyRegion(page).content, s.id, record) });
      }
    }
```
Delete the old `reveals`/`body` lines and their comment.

- [ ] **Step 4: `#secretSectionHtml(page, secretId)`**:

```js
  static #secretSectionHtml(page, secretId) {
    if (!page || !secretId) return null;
    const body = bodyRegion(page).content;
    if (!body) return null;
    const parsed = new DOMParser().parseFromString(body, "text/html");
    const section = parsed.body.querySelector(`section.secret[id="${CSS.escape(secretId)}"]`);
    return section ? section.innerHTML : null;
  }
```
Update its doc comment: reads the resolved page's body region; null only when the section was deleted between render and click.

- [ ] **Step 5: `onTrackerAudience` block branch** — read `pageUuid` from the row and replace the containment lookup + entry write:

```js
    const { secretKind, entryUuid, secretId, pageUuid } = row.dataset;
    …
    if (secretKind === "block") {
      const page = pageUuid ? await fromUuid(pageUuid) : null;
      if (!page) { ui.notifications.warn(game.i18n.localize(`${I18N}.secrets.pageGone`)); return; }
      const record = page.getFlag(MODULE_ID, "secretReveals")?.[secretId];
      const previous = { ...normalizeAudience(record), all: sectionRevealedAll(bodyRegion(page).content, secretId, record) };
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.revealTitle`), audience: previous, groups });
      if (!audience) return;
      const stored = await applyBlockReveal(page, secretId, audience, { legacyAll: record?.all === true });
      await page.update({ [`flags.${MODULE_ID}.secretReveals.${secretId}`]: stored });
      const html = CampaignHubPage.#secretSectionHtml(page, secretId)
        ?? `<p>${foundry.utils.escapeHTML(row.dataset.preview ?? "")}</p>`;
      await sendRevealWhisper({ audience, previousAudience: previous, groups, html, entryUuid, entryName: entry.name });
    }
```
Remove the "Resolve the page by CONTAINMENT" comment. Template: add `data-page-uuid="{{this.pageUuid}}"` to the `<li class="mej-cc-secret-row …">`. Lang: after `"noId"` add `"pageGone": "That page no longer exists."`.

- [ ] **Step 6: e2e** — in `10-secrets-hub.spec.mjs` line 61, `place.update(...)` → `place.pages.contents[0].update(...)`. Add:

```js
test("tracker lists a duplicate id once per page and acts on the right page", async ({ page }) => {
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, "Gamemaster");
  const needle = `TT-dup-${Date.now()}`;
  const { id, p2Id, u1Id } = await page.evaluate(async ({ prefix, needle }) => {
    const mej = { "monks-enhanced-journal": { type: "place" } };
    const entry = await JournalEntry.create({
      name: `${prefix}Dup-Tracker`,
      pages: [
        { name: "Alpha", type: "monks-enhanced-journal.place", flags: mej, text: { content: `<section class="secret" id="secret-dup"><p>${needle}-alpha</p></section>` } },
        { name: "Beta", type: "monks-enhanced-journal.place", flags: mej, text: { content: `<section class="secret" id="secret-dup"><p>${needle}-beta</p></section>` } }
      ]
    });
    return { id: entry.id, p2Id: entry.pages.contents[1].id, u1Id: game.users.getName("User 1").id };
  }, { prefix: TT_PREFIX, needle });
  const shell = await openEntry(page, id, `${needle}-alpha`);
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  await shell.locator('nav.sheet-tabs a[data-tab="secrets"]').click();
  await settle(page, 300);
  const rows = shell.locator('.mej-cc-secret-row[data-secret-id="secret-dup"]');
  await expect(rows).toHaveCount(2);
  const beta = rows.filter({ hasText: "Beta" });
  await expect(beta).toHaveCount(1);
  await beta.locator('[data-action="trackerAudience"]').click();
  const dialog = page.locator("dialog.application").last();
  await dialog.locator(`input[name="user-${u1Id}"]`).check();
  await dialog.locator('button[data-action="ok"]').click();
  await expect.poll(() => page.evaluate(({ e, b }) => {
    const entry = game.journal.get(e);
    const [p1, p2] = entry.pages.contents;
    return { p1: p1.getFlag("mej-campaign-companion", "secretReveals") ?? null, p2users: p2.getFlag("mej-campaign-companion", "secretReveals")?.["secret-dup"]?.users ?? null };
  }, { e: id, b: p2Id })).toEqual({ p1: null, p2users: [u1Id] });
  // Whisper carries Beta's real section HTML, not Alpha's and not the preview.
  const whisper = await page.evaluate((n) => game.messages.contents.filter((m) => m.content?.includes(`${n}-beta`)).length, needle);
  expect(whisper).toBeGreaterThan(0);
  assertNoConsoleErrors(errors);
});
```

- [ ] **Step 7: Run** `npm test`, then `npm run e2e -- tests/e2e/10-secrets-hub.spec.mjs tests/e2e/09-secrets.spec.mjs`. Expected green.

- [ ] **Step 8: Vacuity.** Revert Step 5's page resolution to `entry.pages.contents.find((p) => mejType(p))` (first page) → the new 10 test must fail on `p1`/`p2users` or the whisper needle. Restore. Record.

- [ ] **Step 9: Commit**

```bash
git add scripts/search/live-index.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json tests/e2e/10-secrets-hub.spec.mjs test/secrets-tracker.test.js
git commit -m "fix(hub): secrets tracker resolves the page that holds each secret"
```

---

### Task 4: v4 migration runner + e2e with World A backup

**Files:**
- Modify: `scripts/constants.mjs:80` → `export const CURRENT_DATA_VERSION = 4;`
- Modify: `scripts/campaign-companion.mjs` (import + v4 step before the `dataVersion` write at ~292)
- Create: `tests/e2e/19-reveal-migration.spec.mjs`

**Interfaces:**
- Consumes: `planPageKeyedMigration` (Task 1).

- [ ] **Step 1: Runner** — extend the import line to include `planPageKeyedMigration`, then insert after the v3 `if (converted) console.log(...)` line:

```js
    // v4: block reveal records move from the entry to the page holding the
    // section (spec 2026-08-30). Copied to EVERY page holding the id; ids on
    // no page are dropped and listed; the entry flag is left in place as a
    // rollback copy and is never read again. Idempotent via `existing`.
    const pageCandidates = [];
    for (const entry of game.journal.contents) {
      const reveals = entry.getFlag(MODULE_ID, "secretReveals");
      if (!reveals || !Object.keys(reveals).length) continue;
      pageCandidates.push({
        entryUuid: entry.uuid, reveals,
        pages: (entry.pages?.contents ?? []).filter((p) => mejType(p)).map((p) => ({
          pageUuid: p.uuid,
          sectionIds: extractSecretBlocks(bodyRegion(p).content).map((s) => s.id),
          existing: p.getFlag(MODULE_ID, "secretReveals") ?? {}
        }))
      });
    }
    const { steps, dropped } = planPageKeyedMigration(pageCandidates);
    let pagesWritten = 0;
    for (const step of steps) {
      try {
        const page = await fromUuid(step.pageUuid);
        if (!page) continue;
        const existing = page.getFlag(MODULE_ID, "secretReveals") ?? {};
        await page.update({ [`flags.${MODULE_ID}.secretReveals`]: { ...existing, ...step.reveals } });
        pagesWritten += 1;
      } catch (err) {
        console.error(`${MODULE_ID} | page-keyed reveal migration failed for ${step.pageUuid}`, err);
      }
    }
    if (pagesWritten || dropped.length) {
      console.log(`${MODULE_ID} | moved block reveals onto ${pagesWritten} page(s); ${dropped.length} record(s) had no section on any page and were not copied`, dropped);
    }
```

- [ ] **Step 2: e2e** — create `tests/e2e/19-reveal-migration.spec.mjs`:

```js
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
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 4, null, { timeout: 60_000 });
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
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 4, null, { timeout: 60_000 });
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
});
```
Note `reloadGame` waits for `SESSION_BOUND`; the `waitForFunction` on `dataVersion === 4` is the real migration-complete signal (the runner sets it last).

- [ ] **Step 3: Run** `npm test` (all unit) and `npm run e2e -- tests/e2e/19-reveal-migration.spec.mjs tests/e2e/09-secrets.spec.mjs`. Expected green — including 09's existing "dataVersion 3 migration" test, which now also triggers v4 (it asserts only entry-level state, which v4 does not touch).

- [ ] **Step 4: Vacuity.** Comment out the `page.update` in the runner → 19 fails on `state.p1`. Restore. Record.

- [ ] **Step 5: Commit**

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs tests/e2e/19-reveal-migration.spec.mjs
git commit -m "feat(secrets): dataVersion 4 copies block reveals onto their pages"
```

---

### Task 5: Docs, changelog, version

**Files:**
- Modify: `docs/gm-guide.md` (Secrets section, after the paragraph beginning "Secrets a viewer isn't cleared for")
- Modify: `CHANGELOG.md` (new top section), `module.json` (`"version": "0.14.0"`)

- [ ] **Step 1: GM guide** — insert:

```markdown
**Reveals belong to the page.** Who a block secret is revealed to is recorded on the page that holds the secret, not on the entry as a whole. Two consequences worth knowing: duplicating a page copies its reveals along with it, so the copy's players see exactly what the original's did; and deleting a page takes its reveals with it. When an entry has more than one page, the Hub Secrets tab labels each row **entry · page** so you can tell which copy of a secret you are acting on.
```

- [ ] **Step 2: CHANGELOG** — new section above 0.13.6:

```markdown
## 0.14.0 (2026-08-30)

Schema change. On the first GM load, block-secret reveal records move
from the journal entry onto the page that holds the secret; the old
entry-level record is left in place as a rollback copy and is no longer
read. A record whose section exists on more than one page of an entry
is copied to each of them, so nothing a player could see changes. A
record whose section exists on no page is not copied; the console lists
each one.

- **Revealing a secret on one page no longer touches another page's
  copy.** Duplicating a page kept the secret's id, so un-revealing from
  the Hub could strip the wrong page's reveal.
- **Opening one page no longer deletes another page's reveal records.**
- **The Hub Secrets tab lists every page's secrets** on a multi-page
  entry, labels rows by page, and whispers the real section text from
  the right page instead of a preview.
```

- [ ] **Step 3: `module.json` version → `0.14.0`.** Run `npm test` and `npm run check:links`.

- [ ] **Step 4: Commit**

```bash
git add docs/gm-guide.md CHANGELOG.md module.json
git commit -m "docs: 0.14.0 — reveals belong to the page"
```

---

### Task 6: Regression gate

- [ ] **Step 1:** Full run on this branch: `npm run e2e` (all 19 specs). Record per-spec pass/fail.
- [ ] **Step 2:** Diff against `main`'s baseline (Round 5/carried-items baseline recorded in `docs/superpowers/specs/2026-08-29-carried-items-design.md` outcome section; if absent, run `main` in a second worktree with the same lock discipline). Any new failure is root-caused, not retried.
- [ ] **Step 3:** Report: World A pre-existing reveal maps found by 19's backup (count + uuids) listed for the user; nothing deleted.
- [ ] **Step 4:** No commit unless a fix was needed; then commit with a message naming the root cause.

---

## Self-review

- **Spec coverage:** §1 data model → Tasks 2/4; §2 migration → Tasks 1/4; §3 secrets-ui → 2, index → 3, Hub → 3, template/lang → 3, constants → 4; §4 unit → 1/3, e2e 09 → 2, 10 → 3, 19 → 4, docs → 5, gate → 6. Rulings (orphans dropped, entry flag kept) → Task 1 planner + Task 4 runner + 19 assertions.
- **Placeholders:** none; every code step carries the code.
- **Type consistency:** `planPageKeyedMigration(entries) → {steps, dropped}` identical in Tasks 1 and 4; `revealsOf(page)` used consistently in Task 2; row field `pageUuid` / `data-page-uuid` / `row.dataset.pageUuid` consistent in Task 3; index secret `{id, preview, revealedAll, pageUuid}` produced in Task 3 Step 2 and consumed in Step 3.
