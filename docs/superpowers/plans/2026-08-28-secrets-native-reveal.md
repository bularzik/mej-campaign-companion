# Secrets Native Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the companion's "Everyone" reveal write Foundry's own `revealed` class instead of a private flag, and let recap-sourced secrets be revealed at all.

**Architecture:** One pure helper (`setSectionRevealed`) owns adding/removing the native class in stored page HTML, and both reveal surfaces — the per-block sheet button and the Hub tracker — call it, so there is a single write path regardless of whether a sheet is open. Reads treat "everyone" as `native class OR legacy audience.all`, permanently. A dataVersion 2→3 migration converts existing `all: true` records once.

**Tech Stack:** Foundry VTT v14 (ApplicationV2, `HTMLSecretBlockElement`), vanilla ESM, vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-28-secrets-native-reveal-design.md`

## Global Constraints

- Companion features **never patch Monk's Enhanced Journal**. All changes live in this repo.
- Pure, Foundry-free logic goes in `scripts/logic/` and is unit-tested with vitest. Anything touching `game`/`ui`/`CONFIG` stays out of `scripts/logic/`.
- `audience.all` is **never written as `true`** after this change. It is still read forever as a legacy "everyone" signal.
- The body write only ever adds or removes the `revealed` class on one `<section>` open tag. It never rewrites prose and never touches another section.
- Every new e2e assertion guarding this behaviour is **vacuity-checked**: disable the fix, confirm the test fails, restore. Assert what a user can do, not that an element exists.
- Run `npm test` from inside the worktree. Never trust a test count from the main checkout while worktrees exist.
- Baseline: unit suite is **635 passing** before this plan starts.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/logic/secret-blocks.mjs` (modify) | Gains `setSectionRevealed` — the single place that edits native reveal state in a body string. |
| `scripts/logic/field-extractors.mjs` (modify) | Gains `bodyRegion(page)`; `bodyText` becomes a thin wrapper so key and content cannot drift. |
| `scripts/logic/reveal-migration.mjs` (create) | Pure planner deciding which records the dataVersion-3 migration converts. |
| `scripts/hooks/secrets-ui.mjs` (modify) | Sheet-side reveal write; body-region selectors instead of hardcoded `text.content`. |
| `scripts/apps/CampaignHubPage.mjs` (modify) | Tracker-side reveal write; drops the `canAudience` suppression. |
| `scripts/campaign-companion.mjs` (modify) | Runs the migration in the existing ready-hook block. |
| `scripts/constants.mjs` (modify) | `CURRENT_DATA_VERSION` 2 → 3. |
| `test/secret-blocks.test.js` (modify) | `setSectionRevealed` unit tests. |
| `test/field-extractors.test.js` (modify) | `bodyRegion` unit tests. |
| `test/reveal-migration.test.js` (create) | Planner unit tests. |
| `tests/e2e/09-secrets.spec.mjs` (modify) | Equivalence, reveal-to-everyone, recap reveal, migration. |

---

### Task 1: `setSectionRevealed` pure helper

**Files:**
- Modify: `scripts/logic/secret-blocks.mjs`
- Test: `test/secret-blocks.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `setSectionRevealed(html: string, sectionId: string, revealed: boolean) -> string`. Returns the input unchanged when the body is empty, `sectionId` is falsy, the section is absent, or the state already matches.

- [ ] **Step 1: Write the failing tests**

Append to `test/secret-blocks.test.js` (add `setSectionRevealed` to the existing import from `../scripts/logic/secret-blocks.mjs`):

```js
describe("setSectionRevealed", () => {
  const plain = '<p>Intro.</p><section class="secret" id="secret-a">Hidden.</section><p>Outro.</p>';
  const revealed = '<p>Intro.</p><section class="secret revealed" id="secret-a">Hidden.</section><p>Outro.</p>';

  it("adds the revealed class", () => {
    expect(setSectionRevealed(plain, "secret-a", true)).toBe(revealed);
  });

  it("removes the revealed class", () => {
    expect(setSectionRevealed(revealed, "secret-a", false)).toBe(plain);
  });

  it("is idempotent in both directions", () => {
    expect(setSectionRevealed(revealed, "secret-a", true)).toBe(revealed);
    expect(setSectionRevealed(plain, "secret-a", false)).toBe(plain);
  });

  it("leaves other sections alone", () => {
    const two = '<section class="secret" id="secret-a">A</section><section class="secret" id="secret-b">B</section>';
    expect(setSectionRevealed(two, "secret-a", true)).toBe(
      '<section class="secret revealed" id="secret-a">A</section><section class="secret" id="secret-b">B</section>'
    );
  });

  it("preserves other classes and attributes on the section", () => {
    const rich = '<section id="secret-a" class="secret fancy" data-x="1">A</section>';
    expect(setSectionRevealed(rich, "secret-a", true)).toBe(
      '<section id="secret-a" class="secret fancy revealed" data-x="1">A</section>'
    );
  });

  it("handles single-quoted attributes", () => {
    const sq = "<section class='secret' id='secret-a'>A</section>";
    expect(setSectionRevealed(sq, "secret-a", true)).toBe("<section class='secret revealed' id='secret-a'>A</section>");
  });

  it("ignores non-secret sections with a matching id", () => {
    const notSecret = '<section class="note" id="secret-a">A</section>';
    expect(setSectionRevealed(notSecret, "secret-a", true)).toBe(notSecret);
  });

  it("returns the input unchanged for a missing id, empty body, or junk", () => {
    expect(setSectionRevealed(plain, "secret-zzz", true)).toBe(plain);
    expect(setSectionRevealed("", "secret-a", true)).toBe("");
    expect(setSectionRevealed(null, "secret-a", true)).toBe("");
    expect(setSectionRevealed(plain, "", true)).toBe(plain);
    expect(setSectionRevealed(plain, null, true)).toBe(plain);
  });

  it("does not treat $-sequences in the body as replacement patterns", () => {
    const dollars = '<section class="secret" id="secret-a">Cost $5 &amp; $&amp; $` $\'</section>';
    expect(setSectionRevealed(dollars, "secret-a", true)).toBe(
      '<section class="secret revealed" id="secret-a">Cost $5 &amp; $&amp; $` $\'</section>'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/secret-blocks.test.js`
Expected: FAIL — `(0 , setSectionRevealed) is not a function`.

- [ ] **Step 3: Implement**

Append to `scripts/logic/secret-blocks.mjs`:

```js
/** Replace an open tag's class attribute value, preserving its quote style. */
function withClasses(openTag, classes) {
  return openTag.replace(/(\sclass\s*=\s*)(["'])(.*?)\2/i, (match, prefix, quote) => `${prefix}${quote}${classes}${quote}`);
}

/**
 * Add or remove Foundry's native `revealed` class on ONE secret section.
 *
 * Native reveal state lives as a class inside the stored page HTML - it is
 * what `.secret:not(.revealed)` strips, what core sheets honour, and what the
 * player-safe export keys on (stripSecretSections above). This is the single
 * place that edits it, so both reveal surfaces (the per-block sheet button and
 * the Hub tracker, which may act with no sheet open and therefore no
 * <secret-block> element to call core's toggleRevealed on) share one
 * implementation.
 *
 * Total: returns the input unchanged for an empty body, a falsy id, a section
 * that isn't there, a non-secret section, or a state that already matches - so
 * a caller can always write back whatever it gets.
 */
export function setSectionRevealed(html, sectionId, revealed) {
  const src = String(html ?? "");
  if (!src || typeof sectionId !== "string" || !sectionId) return src;
  const want = revealed === true;
  // Function replacement, never a string: bodies are GM prose and String#replace
  // would expand `$&`/`$'` inside them as replacement patterns.
  return src.replace(SECTION_RE, (block) => {
    if (!isSecret(block)) return block;
    const close = block.indexOf(">") + 1;
    const openTag = block.slice(0, close);
    if (attr(openTag, "id") !== sectionId) return block;
    const classes = classesOf(block);
    if (classes.includes("revealed") === want) return block;
    const next = want ? [...classes, "revealed"] : classes.filter((c) => c !== "revealed");
    return withClasses(openTag, next.join(" ")) + block.slice(close);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/secret-blocks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/secret-blocks.mjs test/secret-blocks.test.js
git commit -m "feat: setSectionRevealed - single place that edits native reveal state"
```

---

### Task 2: `bodyRegion` pure helper

**Files:**
- Modify: `scripts/logic/field-extractors.mjs` (`bodyText` is at line 61)
- Test: `test/field-extractors.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `bodyRegion(page) -> { key: "system.recap" | "text.content", content: string }`. `bodyText(page)` keeps its existing signature and returns `bodyRegion(page).content`.

- [ ] **Step 1: Write the failing tests**

Append to `test/field-extractors.test.js` (add `bodyRegion` to the existing import from `../scripts/logic/field-extractors.mjs`):

```js
describe("bodyRegion", () => {
  it("routes a session page to system.recap", () => {
    expect(bodyRegion({ system: { recap: "<p>Recap.</p>" } })).toEqual({
      key: "system.recap", content: "<p>Recap.</p>"
    });
  });

  it("routes every other page to text.content", () => {
    expect(bodyRegion({ text: { content: "<p>Body.</p>" } })).toEqual({
      key: "text.content", content: "<p>Body.</p>"
    });
  });

  it("treats an empty-string recap as the recap region, not a fallback", () => {
    // Matches bodyText's `??`: only null/undefined falls through.
    expect(bodyRegion({ system: { recap: "" }, text: { content: "<p>Body.</p>" } })).toEqual({
      key: "system.recap", content: ""
    });
  });

  it("falls through when recap is null or undefined", () => {
    expect(bodyRegion({ system: { recap: null }, text: { content: "x" } }).key).toBe("text.content");
    expect(bodyRegion({ system: {}, text: { content: "x" } }).key).toBe("text.content");
  });

  it("defaults to an empty text.content for a page with neither", () => {
    expect(bodyRegion({})).toEqual({ key: "text.content", content: "" });
    expect(bodyRegion(null)).toEqual({ key: "text.content", content: "" });
  });

  it("agrees with bodyText on every shape", () => {
    for (const page of [
      { system: { recap: "<p>R</p>" } },
      { text: { content: "<p>T</p>" } },
      { system: { recap: "" }, text: { content: "<p>T</p>" } },
      { system: { recap: null }, text: { content: "<p>T</p>" } },
      {},
      null
    ]) {
      expect(bodyRegion(page).content).toBe(bodyText(page));
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/field-extractors.test.js`
Expected: FAIL — `(0 , bodyRegion) is not a function`.

- [ ] **Step 3: Implement**

In `scripts/logic/field-extractors.mjs`, replace the existing `bodyText` (line 61) with:

```js
/**
 * Which field holds a page's body, and what is in it. Session pages keep their
 * body in system.recap; everything else uses text.content. Callers that need
 * to WRITE the body (hooks/secrets-ui.mjs, apps/CampaignHubPage.mjs) need the
 * key as well as the content, and a second copy of this fallback would be free
 * to drift from this one - so bodyText is defined in terms of it below rather
 * than beside it.
 */
export function bodyRegion(page) {
  const recap = page?.system?.recap;
  if (recap !== undefined && recap !== null) return { key: "system.recap", content: String(recap) };
  return { key: "text.content", content: String(page?.text?.content ?? "") };
}

export function bodyText(page) {
  return bodyRegion(page).content;
}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS, 635 + new tests. `bodyText`'s existing callers (`live-index.mjs`, `doc-export-snapshot.mjs`, `secrets-ui.pruneOrphans`) are unchanged and must stay green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/field-extractors.mjs test/field-extractors.test.js
git commit -m "feat: bodyRegion - body key and content from one fallback"
```

---

### Task 3: Reveal writes the native class

**Files:**
- Modify: `scripts/hooks/secrets-ui.mjs` (`editAudience`)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onTrackerAudience`, block branch)

**Interfaces:**
- Consumes: `setSectionRevealed(html, sectionId, revealed)` (Task 1); `bodyRegion(page) -> {key, content}` (Task 2).
- Produces: `applyBlockReveal(page, sectionId, audience) -> Promise<void>` exported from `scripts/hooks/secrets-ui.mjs` — writes the native class for `audience.all` and returns the audience to store with `all` forced false. Task 4 and Task 7 both rely on this name.

No unit test: both call sites need `game`/document APIs. Covered by Task 7's e2e.

- [ ] **Step 1: Add the shared write helper**

In `scripts/hooks/secrets-ui.mjs`, add these imports:

```js
import { extractSecretBlocks, setSectionRevealed } from "../logic/secret-blocks.mjs";
import { bodyRegion } from "../logic/field-extractors.mjs";
```

(The file already imports `extractSecretBlocks`; extend that line rather than adding a second import from the same module.)

Then add, above `editAudience`:

```js
/**
 * Apply an audience to one block secret.
 *
 * "Everyone" is Foundry's own `revealed` class in the page body, not a flag of
 * ours - that is what core sheets, viewers without this module, and the
 * player-safe docx export all honour. So this writes the class and stores the
 * audience with `all` forced false; `audience.all` is never written true again
 * (readers still honour a legacy true forever - see the sweep spec).
 *
 * The body is re-read here rather than taken from a render-time snapshot: a
 * co-GM or another window may have edited it while the dialog was open, and
 * writing back a stale body would revert their edit. Same discipline
 * SessionSheet.onSecretAudience already applies to the secrets array.
 *
 * Returns the audience to persist. Throws only if the body update itself
 * fails, so the caller can skip the flag write and leave the two halves from
 * disagreeing.
 */
export async function applyBlockReveal(page, sectionId, audience) {
  const stored = { ...normalizeAudience(audience), all: false };
  if (!page) return stored;
  const { key, content } = bodyRegion(page);
  const next = setSectionRevealed(content, sectionId, audience?.all === true);
  if (next !== content) await page.update({ [key]: next });
  return stored;
}
```

- [ ] **Step 2: Route the sheet-side reveal through it**

In `editAudience`, replace:

```js
  await entry.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}.${sectionId}`]: audience });
```

with:

```js
  const stored = await applyBlockReveal(page, sectionId, audience);
  await entry.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}.${sectionId}`]: stored });
```

- [ ] **Step 3: Route the tracker reveal through it**

In `scripts/apps/CampaignHubPage.mjs`, add to the imports:

```js
import { applyBlockReveal } from "../hooks/secrets-ui.mjs";
```

In `onTrackerAudience`'s `if (secretKind === "block")` branch, replace:

```js
      await entry.update({ [`flags.${MODULE_ID}.secretReveals.${secretId}`]: audience });
```

with:

```js
      // The tracker can act with no sheet open, so there is no <secret-block>
      // element here to call core's toggleRevealed on - applyBlockReveal works
      // from the body string instead, which is why it is shared with the
      // sheet-side path rather than each surface doing its own thing.
      const page = entry.pages?.contents?.find((p) => mejType(p));
      const stored = await applyBlockReveal(page, secretId, audience);
      await entry.update({ [`flags.${MODULE_ID}.secretReveals.${secretId}`]: stored });
```

- [ ] **Step 4: Make the tracker read native state as "everyone"**

In `#secretsContext`'s block-secrets loop, the row already carries `revealedAll: s.revealedAll` from `extractSecretBlocks`. Change the row's `revealedAll` to honour the legacy flag too:

```js
        rows.push({ kind: "block", entryUuid: rec.uuid, entryName: rec.name, entryType: rec.type, secretId: s.id, preview: s.preview, audience: normalizeAudience(reveals[s.id]), revealedAll: s.revealedAll || normalizeAudience(reveals[s.id]).all });
```

- [ ] **Step 5: Verify the unit suite still passes**

Run: `npm test`
Expected: PASS (no unit tests cover these files; this is a regression check that nothing imported broke).

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/secrets-ui.mjs scripts/apps/CampaignHubPage.mjs
git commit -m "feat: Everyone reveals write Foundry's native revealed class"
```

---

### Task 4: Recap-sourced secrets get a reveal path

**Files:**
- Modify: `scripts/hooks/secrets-ui.mjs` (`injectGmOverlay` line 48, `injectPlayerSecrets` line 140)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`canAudience`, line 745)

**Interfaces:**
- Consumes: `bodyRegion(page)` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Generalise the GM overlay selector**

In `injectGmOverlay`, replace:

```js
  const sections = element.querySelectorAll('.editor-display[data-key="text.content"] section.secret');
```

with:

```js
  // A session page renders its body into data-key="system.recap"; everything
  // else into text.content. Pinning text.content meant recap secrets got no
  // audience button at all, so they could be seen in the tracker and never
  // revealed to anyone.
  const { key } = bodyRegion(page);
  const sections = element.querySelectorAll(`.editor-display[data-key="${key}"] section.secret`);
```

- [ ] **Step 2: Generalise the player path**

In `injectPlayerSecrets`, replace:

```js
  const container = element.querySelector('.editor-display[data-key="text.content"]');
  if (!container) return;
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    page.text?.content ?? "", { relativeTo: page, secrets: true, async: true }
  );
```

with:

```js
  const { key, content } = bodyRegion(page);
  const container = element.querySelector(`.editor-display[data-key="${key}"]`);
  if (!container) return;
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    content, { relativeTo: page, secrets: true, async: true }
  );
```

- [ ] **Step 3: Stop suppressing the tracker control for session rows**

In `#secretsContext`, replace:

```js
        canAudience: row.kind !== "block" || (!!row.secretId && row.entryType !== "session")
```

with:

```js
        // Session-type block rows used to be excluded here: recap secrets had
        // no player re-enrichment path, so a reveal on one could never display
        // to the player it was granted to. injectPlayerSecrets now works from
        // the page's actual body region, so the control can be honoured.
        canAudience: row.kind !== "block" || !!row.secretId
```

Delete the now-stale comment block directly above it (the one beginning "Block rows on a session-type page are recap-sourced").

- [ ] **Step 4: Verify the unit suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/secrets-ui.mjs scripts/apps/CampaignHubPage.mjs
git commit -m "feat: recap-sourced secrets can be revealed"
```

---

### Task 5: Migration planner (pure)

**Files:**
- Create: `scripts/logic/reveal-migration.mjs`
- Test: `test/reveal-migration.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `planNativeRevealMigration(entries) -> [{ entryUuid, pageUuid, bodyKey, sectionIds }]`. Input is a normalized array of `{ entryUuid, pageUuid, bodyKey, reveals, sectionIds }`, built by Task 6 from live documents.

- [ ] **Step 1: Write the failing tests**

Create `test/reveal-migration.test.js`:

```js
import { describe, it, expect } from "vitest";
import { planNativeRevealMigration } from "../scripts/logic/reveal-migration.mjs";

const entry = (over = {}) => ({
  entryUuid: "JournalEntry.e1", pageUuid: "JournalEntry.e1.JournalEntryPage.p1",
  bodyKey: "text.content", reveals: {}, sectionIds: [], ...over
});

describe("planNativeRevealMigration", () => {
  it("plans a record revealed to everyone whose section still exists", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: true } }, sectionIds: ["secret-a"]
    })])).toEqual([{
      entryUuid: "JournalEntry.e1", pageUuid: "JournalEntry.e1.JournalEntryPage.p1",
      bodyKey: "text.content", sectionIds: ["secret-a"]
    }]);
  });

  it("ignores per-user and per-group audiences", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { users: ["u1"] }, "secret-b": { groups: ["g1"] } },
      sectionIds: ["secret-a", "secret-b"]
    })])).toEqual([]);
  });

  it("omits ids whose section is no longer in the body, keeping the rest", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: true }, "secret-gone": { all: true } },
      sectionIds: ["secret-a"]
    })])[0].sectionIds).toEqual(["secret-a"]);
  });

  it("plans nothing for an entry whose only all-records are missing sections", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-gone": { all: true } }, sectionIds: ["secret-a"]
    })])).toEqual([]);
  });

  it("plans nothing on a second pass, once all is cleared", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: false, users: ["u1"] } }, sectionIds: ["secret-a"]
    })])).toEqual([]);
  });

  it("keeps entries separate and skips empty input", () => {
    const plan = planNativeRevealMigration([
      entry({ reveals: { "secret-a": { all: true } }, sectionIds: ["secret-a"] }),
      entry({ entryUuid: "JournalEntry.e2", pageUuid: "JournalEntry.e2.JournalEntryPage.p2",
              bodyKey: "system.recap", reveals: { "secret-b": { all: true } }, sectionIds: ["secret-b"] })
    ]);
    expect(plan).toHaveLength(2);
    expect(plan[1]).toEqual({
      entryUuid: "JournalEntry.e2", pageUuid: "JournalEntry.e2.JournalEntryPage.p2",
      bodyKey: "system.recap", sectionIds: ["secret-b"]
    });
    expect(planNativeRevealMigration([])).toEqual([]);
    expect(planNativeRevealMigration(null)).toEqual([]);
  });

  it("tolerates junk records rather than throwing during a world load", () => {
    expect(planNativeRevealMigration([entry({ reveals: { a: null, b: 7 }, sectionIds: ["a"] })])).toEqual([]);
    expect(planNativeRevealMigration([null, undefined])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/reveal-migration.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/reveal-migration.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/logic/reveal-migration.mjs`:

```js
/**
 * dataVersion 2 -> 3 planner: which "revealed to everyone" records need
 * converting from the companion's private `audience.all` flag to Foundry's
 * native `revealed` class.
 *
 * Pure and Foundry-free so the decision is unit-tested on its own; the caller
 * (campaign-companion.mjs's ready hook) builds the input from live documents
 * and applies the result.
 *
 * A record whose section is no longer in the body is deliberately OMITTED
 * rather than reported as an error: there is nothing to add a class to, and
 * the reader keeps honouring a leftover `all: true` forever, so leaving it
 * alone degrades to today's behaviour instead of silently un-revealing a
 * secret someone was shown.
 *
 * @param {Array<{entryUuid:string, pageUuid:string, bodyKey:string, reveals:object, sectionIds:string[]}>} entries
 * @returns {Array<{entryUuid:string, pageUuid:string, bodyKey:string, sectionIds:string[]}>}
 */
export function planNativeRevealMigration(entries) {
  const plan = [];
  for (const entry of entries ?? []) {
    if (!entry) continue;
    const present = new Set(entry.sectionIds ?? []);
    const sectionIds = Object.entries(entry.reveals ?? {})
      .filter(([, audience]) => audience?.all === true)
      .map(([id]) => id)
      .filter((id) => present.has(id));
    if (!sectionIds.length) continue;
    plan.push({
      entryUuid: entry.entryUuid, pageUuid: entry.pageUuid, bodyKey: entry.bodyKey, sectionIds
    });
  }
  return plan;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/reveal-migration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/reveal-migration.mjs test/reveal-migration.test.js
git commit -m "feat: dataVersion 3 migration planner for native reveals"
```

---

### Task 6: Wire the migration

**Files:**
- Modify: `scripts/constants.mjs` (`CURRENT_DATA_VERSION`, line 80)
- Modify: `scripts/campaign-companion.mjs` (ready-hook migration block)

**Interfaces:**
- Consumes: `planNativeRevealMigration(entries)` (Task 5), `setSectionRevealed(html, id, revealed)` (Task 1), `bodyRegion(page)` (Task 2), `extractSecretBlocks(html)` (existing).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Bump the data version**

In `scripts/constants.mjs`, change line 80:

```js
export const CURRENT_DATA_VERSION = 3;
```

- [ ] **Step 2: Add the migration**

In `scripts/campaign-companion.mjs`, add imports:

```js
import { planNativeRevealMigration } from "./logic/reveal-migration.mjs";
import { setSectionRevealed, extractSecretBlocks } from "./logic/secret-blocks.mjs";
import { bodyRegion } from "./logic/field-extractors.mjs";
```

Inside the existing `if (game.user === game.users.activeGM && ... < CURRENT_DATA_VERSION)` block, after the v2 portal loop and **before** the `game.settings.set(..., CURRENT_DATA_VERSION)` line:

```js
    // v3: "revealed to everyone" moves from our private audience.all flag to
    // Foundry's own `revealed` class, so core sheets, viewers without this
    // module, and the player-safe export all honour it. Per-page failures are
    // logged and skipped rather than aborting: the record's flag is left
    // intact and the reader's legacy fallback keeps that secret working.
    const candidates = [];
    for (const entry of game.journal.contents) {
      const reveals = entry.getFlag(MODULE_ID, "secretReveals");
      if (!reveals || !Object.keys(reveals).length) continue;
      const page = entry.pages?.contents?.find((p) => mejType(p));
      if (!page) continue;
      const { key, content } = bodyRegion(page);
      candidates.push({
        entryUuid: entry.uuid, pageUuid: page.uuid, bodyKey: key, reveals,
        sectionIds: extractSecretBlocks(content).map((s) => s.id)
      });
    }
    let converted = 0;
    for (const step of planNativeRevealMigration(candidates)) {
      try {
        const page = await fromUuid(step.pageUuid);
        const entry = await fromUuid(step.entryUuid);
        if (!page || !entry) continue;
        const { key, content } = bodyRegion(page);
        let next = content;
        for (const id of step.sectionIds) next = setSectionRevealed(next, id, true);
        if (next !== content) await page.update({ [key]: next });
        const cleared = {};
        for (const id of step.sectionIds) cleared[`flags.${MODULE_ID}.secretReveals.${id}.all`] = false;
        await entry.update(cleared);
        converted += step.sectionIds.length;
      } catch (err) {
        console.error(`${MODULE_ID} | native-reveal migration failed for ${step.pageUuid}`, err);
      }
    }
    if (converted) console.log(`${MODULE_ID} | converted ${converted} "everyone" reveal(s) to Foundry's native revealed class`);
```

- [ ] **Step 3: Verify the unit suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs
git commit -m "feat: dataVersion 3 migration converts legacy Everyone reveals"
```

---

### Task 7: End-to-end verification

**Files:**
- Modify: `tests/e2e/09-secrets.spec.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

Each scenario seeds `TT_`-prefixed fixtures and deletes them by id in a `finally`, matching this suite's existing discipline. Never delete by name.

- [ ] **Step 1: Write the equivalence scenario**

This is the guard against the pure helper drifting from core. Append inside the existing `test.describe` in `tests/e2e/09-secrets.spec.mjs`:

```js
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
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --trace off --grep "agrees with Foundry" tests/e2e/09-secrets.spec.mjs`
Expected: PASS. If it fails with a mismatch, core's markup differs from the helper's assumption — fix `setSectionRevealed`, not the test.

- [ ] **Step 3: Write the reveal-to-everyone scenario**

```js
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
```

- [ ] **Step 4: Write the migration scenario**

```js
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
```

- [ ] **Step 5: Write the recap-reveal scenario**

```js
  // A secret written in a Session recap had no reveal path at all: no GM
  // audience button, no player re-enrichment, and the tracker hid the control.
  test("a recap-sourced secret can be revealed and reaches the player", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
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

      playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
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
```

- [ ] **Step 6: Run the whole secrets suite**

Run: `npx playwright test --trace off tests/e2e/09-secrets.spec.mjs tests/e2e/10-secrets-hub.spec.mjs`
Expected: all PASS, including the pre-existing scenarios.

- [ ] **Step 7: Vacuity-check the two load-bearing scenarios**

For each of "revealing to everyone writes the native class" and the migration scenario:

1. Disable its fix — for the first, make `applyBlockReveal` skip the body write (`const next = content;`); for the second, comment out the v3 block in `campaign-companion.mjs`.
2. Run that scenario. It **must fail**. If it passes, the assertion is not testing the fix — fix the test.
3. Restore with `git checkout -- <file>` **only if you have no uncommitted work in that file**; otherwise undo the edit by hand. (Both fixes are committed by this point, so `git checkout` is safe here.)
4. Re-run to confirm it passes again.

- [ ] **Step 8: Run the full suites**

Run: `npm test && npm run check:vendor && npm run check:links`
Then: `npx playwright test --trace off tests/e2e/01-session.spec.mjs tests/e2e/03-search.spec.mjs tests/e2e/05-docx-import.spec.mjs tests/e2e/07-knowledge.spec.mjs tests/e2e/09-secrets.spec.mjs tests/e2e/10-secrets-hub.spec.mjs tests/e2e/14-campaigns.spec.mjs`
Expected: all green. `05-docx-import` matters here — it covers the export path that now honours these reveals.

- [ ] **Step 9: Commit**

```bash
git add tests/e2e/09-secrets.spec.mjs
git commit -m "test: e2e for native reveal, recap secrets, and the v3 migration"
```

---

## Self-Review

**Spec coverage.** §1 division of responsibility → Tasks 1, 3. §2 write path (incl. the equivalence guard) → Tasks 1, 3, 7 step 1. §3 concurrency (re-read body at write time) → Task 3 step 1. §4 reading → Task 3 step 4. §5 migration → Tasks 5, 6, 7 step 4. §6 recap → Tasks 2, 4, 7 step 5. Error handling → Task 1 (total helper), Task 6 (per-page try/catch). Testing → Tasks 1, 2, 5 (unit), 7 (e2e + vacuity).

**Type consistency.** `setSectionRevealed(html, sectionId, revealed)`, `bodyRegion(page) -> {key, content}`, `planNativeRevealMigration(entries) -> [{entryUuid, pageUuid, bodyKey, sectionIds}]`, and `applyBlockReveal(page, sectionId, audience) -> Promise<audience>` are used with those exact names and shapes in Tasks 3, 4, 6, and 7.

**Known risk, called out for the executor.** Task 7 step 1 assumes `<secret-block>` accepts a `secret` property and exposes `toggleRevealed(content)`. If that construction shape is wrong in this Foundry build, the equivalence test will error rather than mismatch — treat that as "find the right way to construct it", not as licence to delete the test. It is the only thing standing between the pure helper and silent drift from core.
