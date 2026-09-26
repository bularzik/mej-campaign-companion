# Selection Secret Visibility + Link to Entity Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contributor's Create/Link from a selection links correctly on pages with secrets visible to them, and the five deferred Link to Entity minors are closed.

**Architecture:** The GM computes the requester's visible secret ids from the live page flag (`visibleSecretIds` in `logic/reveal-state.mjs`) and the linker masks only secret sections that are neither `revealed` nor in that set. Candidate matching prefilters by name and is memoised per capture; the link toast drops the type when it has none; e2e specs 24/28/03 are hardened and extended.

**Tech Stack:** Foundry VTT 13/14 module, vitest, Playwright (World A 14.368 :30000; World B `FOUNDRY_TARGET=v13` :30013).

**Spec:** `docs/superpowers/specs/2026-09-26-selection-secret-visibility-design.md`

## Global Constraints

- Visibility is never taken from the payload: `visibleSecretIds` and `maskSecrets` are computed on the GM from the socket sender and the live page (`flags.mej-campaign-companion.secretReveals`).
- A secret section is visible iff its class list contains `revealed` or its `id` is in the visible set; text is masked when any enclosing secret section is not visible.
- Owners and GMs: no masking (unchanged). GM notes stay unreachable over the relay (unchanged).
- Auto-link behavior unchanged (it calls `linkCandidates` without a name key).
- E2E documents `TT-` prefixed and cleaned up; never touch Radiant Citadel.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- An `id=` attribute match must not be fooled by `data-id=` (a section whose only id-like attribute is `data-id="secret-x"` is not the visible section `secret-x`) — unit test in Task 1.
- A payload-supplied `visibleSecretIds` is ignored by the GM — unit test in Task 2.
- A revealed-to-Everyone secret nested inside a hidden secret stays masked — unit test in Task 1.
- The memoised matches are per capture: a new right-click recomputes (a stale list from the previous selection never reaches the menu) — covered by e2e spec 28 running several selections in one test (test "no match, or only the page's own entry").
- The name prefilter compares normalised names on both sides (casing/whitespace), so Link still appears for a differently-cased selection — covered by spec 28 test 1.

---

### Task 1: `visibleSecretIds` and viewer-aware masking

**Files:**
- Modify: `scripts/logic/reveal-state.mjs`, `scripts/logic/entity-from-selection.mjs`
- Test: `test/reveal-state.test.js`, `test/entity-from-selection.test.js`

**Interfaces:**
- Produces: `visibleSecretIds(reveals, userId, groups) → Set<string>`; `linkSelectionInSource(html, sel, { maskSecrets, visibleSecretIds })` where `visibleSecretIds` is any iterable of ids or null.

- [ ] **Step 1: Failing tests.** Add `visibleSecretIds` to `test/reveal-state.test.js`'s import list and append:

```js
describe("visibleSecretIds", () => {
  const groups = [{ id: "gA", name: "A", members: ["u1"] }];
  const reveals = {
    "secret-u": { users: ["u1"], groups: [], all: false, revealedAt: 1 },
    "secret-g": { users: [], groups: ["gA"], all: false, revealedAt: 1 },
    "secret-all": { users: [], groups: [], all: true, revealedAt: 1 },
    "secret-none": { users: [], groups: [], all: false, revealedAt: null },
    "secret-other": { users: ["u2"], groups: [], all: false, revealedAt: 1 }
  };
  it("returns the ids whose audience includes the user directly, by group, or via legacy all", () => {
    expect([...visibleSecretIds(reveals, "u1", groups)].sort()).toEqual(["secret-all", "secret-g", "secret-u"]);
  });
  it("group membership resolves against the live list", () => {
    expect(visibleSecretIds(reveals, "u1", []).has("secret-g")).toBe(false);
  });
  it("non-object reveals → empty set", () => {
    expect(visibleSecretIds(null, "u1", groups).size).toBe(0);
    expect(visibleSecretIds("x", "u1", groups).size).toBe(0);
  });
});
```

Append to `test/entity-from-selection.test.js` (inside the file's existing imports, `linkSelectionInSource` and `U` are already present):

```js
describe("linkSelectionInSource viewer-aware masking", () => {
  const link = (text, occurrence, total, html, opts) =>
    linkSelectionInSource(html, { text, occurrence, total, uuid: U }, opts);

  it("a secret revealed to everyone (class 'revealed') counts and can be linked", () => {
    const html = `<p>Elara</p><section class="secret revealed" id="secret-a"><p>Elara</p></section>`;
    expect(link("Elara", 1, 2, html, { maskSecrets: true })).toBe(
      `<p>Elara</p><section class="secret revealed" id="secret-a"><p>@UUID[${U}]{Elara}</p></section>`);
  });
  it("a secret whose id is in visibleSecretIds counts; others stay masked", () => {
    const html = `<p>Elara</p><section class="secret" id="secret-a"><p>Elara</p></section><section class="secret" id="secret-b"><p>Elara</p></section>`;
    const opts = { maskSecrets: true, visibleSecretIds: new Set(["secret-a"]) };
    expect(link("Elara", 0, 2, html, opts)).toBe(html.replace("<p>Elara</p><section", `<p>@UUID[${U}]{Elara}</p><section`));
    expect(link("Elara", 1, 2, html, opts)).toBe(
      html.replace(`id="secret-a"><p>Elara</p>`, `id="secret-a"><p>@UUID[${U}]{Elara}</p>`));
    expect(link("Elara", 2, 3, html, opts)).toBeNull();
  });
  it("accepts an array of ids", () => {
    const html = `<section class="secret" id="secret-a"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBe(
      `<section class="secret" id="secret-a"><p>@UUID[${U}]{Elara}</p></section>`);
  });
  it("a hidden secret nested in a visible one is masked", () => {
    const html = `<section class="secret revealed" id="secret-a"><p>Elara</p><section class="secret" id="secret-b"><p>Elara</p></section></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true })).toBe(
      html.replace(`id="secret-a"><p>Elara</p>`, `id="secret-a"><p>@UUID[${U}]{Elara}</p>`));
  });
  it("a visible secret nested in a hidden one is masked", () => {
    const html = `<section class="secret" id="secret-b"><section class="secret revealed" id="secret-a"><p>Elara</p></section></section><p>Elara</p>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBe(
      html.replace("</section><p>Elara</p>", `</section><p>@UUID[${U}]{Elara}</p>`));
  });
  it("data-id is not id", () => {
    const html = `<section class="secret" data-id="secret-a"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBeNull();
  });
  it("without maskSecrets the visible set is irrelevant (everything counts)", () => {
    const html = `<section class="secret" id="secret-b"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { visibleSecretIds: [] })).toBe(
      `<section class="secret" id="secret-b"><p>@UUID[${U}]{Elara}</p></section>`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/reveal-state.test.js test/entity-from-selection.test.js`
Expected: FAIL — `visibleSecretIds is not a function`; the `revealed`/visible-set cases return null (everything secret masked today). "data-id is not id", "hidden nested in visible" and "without maskSecrets" may already pass — note which in the ledger.

- [ ] **Step 3: Implement.** In `scripts/logic/reveal-state.mjs`, append:

```js
/**
 * Secret section ids whose audience includes `userId` (spec 2026-09-26
 * selection-secret-visibility §2.1): the GM-side mirror of what
 * injectPlayerSecrets shows that player. `reveals` = the page's
 * secretReveals flag map (section id → audience).
 */
export function visibleSecretIds(reveals, userId, groups) {
  const ids = new Set();
  if (!reveals || typeof reveals !== "object") return ids;
  for (const [id, audience] of Object.entries(reveals)) {
    if (canSee(audience, userId, groups)) ids.add(id);
  }
  return ids;
}
```

In `scripts/logic/entity-from-selection.mjs`, add beside `CLASS_ATTR_RE`:

```js
// (?:^|\s) so data-id="…" is not read as the section's id.
const ID_ATTR_RE = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
```

Replace `trackSection` with:

```js
/**
 * Push/pop the open-section stack for one tag segment. Each entry is true
 * when that section HIDES its content from the requester: a secret that is
 * neither revealed to everyone (class `revealed`, which Foundry keeps for
 * non-owners) nor in `visible` (ids revealed to this requester).
 */
function trackSection(tag, sections, visible) {
  const open = SECTION_OPEN_RE.exec(tag);
  if (open) {
    const attrs = open[1];
    if (attrs.trimEnd().endsWith("/")) return;   // self-closing: nothing to scope
    const cls = CLASS_ATTR_RE.exec(attrs);
    const classes = cls ? (cls[1] ?? cls[2] ?? cls[3]).split(/\s+/) : [];
    const idm = ID_ATTR_RE.exec(attrs);
    const id = idm ? (idm[1] ?? idm[2] ?? idm[3]) : null;
    const hides = classes.includes("secret") && !classes.includes("revealed") && !(id !== null && visible.has(id));
    sections.push(hides);
  } else if (SECTION_CLOSE_RE.test(tag)) {
    sections.pop();
  }
}
```

In `linkSelectionInSource`: change the signature to `({ maskSecrets = false, visibleSecretIds = null } = {})`, add `const visible = new Set(visibleSecretIds ?? []);` before the loop, and call `trackSection(seg.raw, sections, visible)`. Update the JSDoc's `maskSecrets` paragraph to: masks the content of secret sections the requester cannot see — not `revealed`, not in `visibleSecretIds` — because Foundry renders only revealed secrets for non-owners and the companion injects the ones revealed to that user.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/reveal-state.test.js test/entity-from-selection.test.js`
Expected: PASS, including every pre-existing maskSecrets case.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/reveal-state.mjs scripts/logic/entity-from-selection.mjs test/reveal-state.test.js test/entity-from-selection.test.js
git commit -m "fix(selection): mask only the secret sections the requester cannot see"
```

---

### Task 2: Writers and relay carry the GM-computed visible set

**Files:**
- Modify: `scripts/logic/entity-from-selection-run.mjs`, `scripts/hooks/entity-from-selection-relay.mjs`
- Test: `test/entity-from-selection-run.test.js`, `test/entity-from-selection-relay.test.js`

**Interfaces:**
- Consumes: `visibleSecretIds` (Task 1), `linkSelectionInSource` option (Task 1).
- Produces: writer requests accept `visibleSecretIds: string[]`; relay passes `{ maskSecrets, visibleSecretIds }` computed from `page.getFlag("mej-campaign-companion", "secretReveals")`, the socket sender id, and `env.groups`.

- [ ] **Step 1: Failing tests.** Append to `test/entity-from-selection-run.test.js`:

```js
describe("writers forward visibleSecretIds", () => {
  const html = '<section class="secret" id="secret-a"><p>Elara</p></section>';
  it("create: a secret visible to the requester is linkable when masked", async () => {
    const { page, deps } = setup({ content: html });
    const out = await runEntityFromSelection(req({ maskSecrets: true, visibleSecretIds: ["secret-a"], linkOthers: false }), deps);
    expect(out.linked).toBe(true);
    expect(page.text.content).toBe('<section class="secret" id="secret-a"><p>@UUID[JournalEntry.new]{Elara}</p></section>');
  });
  it("link: same", async () => {
    const { page, deps } = setup({ content: html });
    deps.matchesFor = () => [{ name: "Elara", uuid: "JournalEntry.e" }];
    const out = await runLinkSelection({ pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1,
      entityUuid: "JournalEntry.e", maskSecrets: true, visibleSecretIds: ["secret-a"] }, deps);
    expect(out.linked).toBe(true);
    expect(page.text.content).toContain("@UUID[JournalEntry.e]{Elara}");
  });
});
```

In `test/entity-from-selection-relay.test.js`, give `gmEnv`'s default page a flag reader: add `getFlag: vi.fn(() => reveals),` to the default page object and a `reveals = {}` option to `gmEnv`'s parameter object (`function gmEnv({ contributor = true, observe = true, owner = false, reveals = {}, page: pageOverride } = {})`). Then append:

```js
describe("handleEntityRequest visible secrets (GM)", () => {
  const reveals = {
    "secret-a": { users: ["u1"], groups: [], all: false, revealedAt: 1 },
    "secret-b": { users: ["u9"], groups: [], all: false, revealedAt: 1 }
  };
  it("a non-owner gets the ids revealed to the SOCKET sender, read from the live page", async () => {
    const env = gmEnv({ reveals });
    await handleEntityRequest(payload(), "u1", env);
    expect(env.page.getFlag).toHaveBeenCalledWith("mej-campaign-companion", "secretReveals");
    expect(env.run).toHaveBeenCalledWith(expect.objectContaining({ maskSecrets: true, visibleSecretIds: ["secret-a"] }));
  });
  it("ignores a payload-supplied visibleSecretIds", async () => {
    const env = gmEnv({ reveals });
    await handleEntityRequest(payload({ visibleSecretIds: ["secret-b"] }), "u1", env);
    expect(env.run).toHaveBeenCalledWith(expect.objectContaining({ visibleSecretIds: ["secret-a"] }));
  });
  it("link mode gets the same set", async () => {
    const env = gmEnv({ reveals });
    await handleEntityRequest({ action: "entity-from-selection", requestId: "r1", pageUuid: "P", fieldKey: "text.content",
      text: "Elara", occurrence: 0, total: 1, entityUuid: "JournalEntry.e" }, "u1", env);
    expect(env.runLink).toHaveBeenCalledWith(expect.objectContaining({ maskSecrets: true, visibleSecretIds: ["secret-a"] }));
  });
  it("an owner is not masked and gets no set", async () => {
    const env = gmEnv({ reveals, owner: true });
    await handleEntityRequest(payload(), "u1", env);
    expect(env.run).toHaveBeenCalledWith(expect.objectContaining({ maskSecrets: false, visibleSecretIds: [] }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/entity-from-selection-run.test.js test/entity-from-selection-relay.test.js`
Expected: FAIL — writers return `linked:false` (visible set not forwarded); relay calls lack `visibleSecretIds`.

- [ ] **Step 3: Implement writers.** In `scripts/logic/entity-from-selection-run.mjs`, both functions: add `visibleSecretIds` to the request destructuring and pass `{ maskSecrets: maskSecrets === true, visibleSecretIds: visibleSecretIds ?? null }` as `linkSelectionInSource`'s third argument. Update the comment above the create writer's call: "maskSecrets/visibleSecretIds are set only by the relay, for a requester who does not own the page: only the secrets visible to them count (see linkSelectionInSource)."

- [ ] **Step 4: Implement relay.** In `scripts/hooks/entity-from-selection-relay.mjs`: `import { isContributor, campaignOf, campaignFlagOf } from "../logic/campaigns.mjs";` stays; add `import { visibleSecretIds } from "../logic/reveal-state.mjs";`. Replace the masking lines in `handleEntityRequest` with:

```js
    // Foundry renders only `revealed` secrets for non-owners and the
    // companion injects the ones revealed to this user, so a non-owner's
    // occurrence/total covered exactly those (linkSelectionInSource). The
    // set comes from the live page and the socket sender, never the payload.
    const maskSecrets = page.testUserPermission?.(sender, "OWNER") !== true;
    const visible = maskSecrets
      ? [...visibleSecretIds(page.getFlag?.(MODULE_ID, "secretReveals"), sender.id, env.groups)]
      : [];
    return reply(await (linkMode ? env.runLink : env.run)({ ...pick(payload), maskSecrets, visibleSecretIds: visible }));
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/entity-from-selection-run.mjs scripts/hooks/entity-from-selection-relay.mjs test/entity-from-selection-run.test.js test/entity-from-selection-relay.test.js
git commit -m "fix(selection): the GM counts the secrets revealed to the requesting contributor"
```

---

### Task 3: Toast without a type; cheaper, memoised matching

**Files:**
- Modify: `scripts/logic/entity-from-selection.mjs`, `scripts/hooks/entity-from-selection.mjs`, `scripts/hooks/link-candidates.mjs`, `lang/en.json`
- Test: `test/entity-from-selection.test.js`

**Interfaces:**
- Produces: `linkedToastArgs(typeLabel, name) → [key, data]`; `linkCandidates(page, region, { nameKey } = {})`.

- [ ] **Step 1: Failing test.** Add `linkedToastArgs` to the import list of `test/entity-from-selection.test.js` and append:

```js
describe("linkedToastArgs", () => {
  it("names the type when there is one", () => {
    expect(linkedToastArgs("Person", "Vex")).toEqual(["linked", { type: "Person", name: "Vex" }]);
  });
  it("omits the type instead of leaving a double space", () => {
    expect(linkedToastArgs("", "Vex")).toEqual(["linkedNoType", { name: "Vex" }]);
  });
});
```

Run: `npx vitest run test/entity-from-selection.test.js` — Expected: FAIL (`linkedToastArgs is not a function`).

- [ ] **Step 2: Implement.** In `scripts/logic/entity-from-selection.mjs`, after `matchingEntities`:

```js
/** i18n key + data for the Link to Entity success toast; no type → no "{type} " gap. */
export function linkedToastArgs(typeLabel, name) {
  return typeLabel ? ["linked", { type: typeLabel, name }] : ["linkedNoType", { name }];
}
```

`lang/en.json`, under `entityFromSelection` after `"linked"`: `"linkedNoType": "Linked the selection to \"{name}\".",`

In `scripts/hooks/entity-from-selection.mjs` `showLinkOutcome`, replace the info toast line with:

```js
  const [key, data] = linkedToastArgs(typeLabelOf(entry), shown);
  ui.notifications.info(f(key, data));
```

(import `linkedToastArgs` with `safeMatches` from `../logic/entity-from-selection.mjs`).

Run: `npx vitest run test/entity-from-selection.test.js` — Expected: PASS.

- [ ] **Step 3: Name prefilter.** In `scripts/hooks/link-candidates.mjs`: import `normalizeEntityName` beside `matchingEntities`; change the signature to `export function linkCandidates(page, region, { nameKey = null } = {})` and the filter to:

```js
    .filter((entry) => (nameKey === null || normalizeEntityName(entry.name) === nameKey)
      && isLinkableEntity(entry, mejType)
      && sameLinkScope(pageCampaignId, campaignIdOf(entry)))
```

Add to its JSDoc: "`nameKey` (a normalizeEntityName result) drops other names before any permission work; auto-link omits it." In `matchesForField`:

```js
export function matchesForField(page, fieldKey, text) {
  const region = linkableRegions(page).find((r) => r.key === fieldKey);
  const nameKey = normalizeEntityName(text);
  return region && nameKey ? matchingEntities(text, linkCandidates(page, region, { nameKey })) : [];
}
```

- [ ] **Step 4: Memoise per capture.** In `eligibilityFromCapture`, replace the `matches` closure with one that caches on the stashed capture record (a new right-click replaces `lastCapture`, so the cache never outlives its selection):

```js
  const record = lastCapture;
  const matches = () => (record.matches ??= safeMatches(() => matchesForField(page, fieldKey, capture.text),
    (msg, err) => console.error(`${MODULE_ID} | ${msg}`, err)));
```

- [ ] **Step 5: Verify**

Run: `npx vitest run` — Expected: all pass. (E2E for Steps 3–4 runs in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/entity-from-selection.mjs scripts/hooks/entity-from-selection.mjs scripts/hooks/link-candidates.mjs lang/en.json test/entity-from-selection.test.js
git commit -m "fix(link-to-entity): typeless toast; prefilter candidates by name and compute once per selection"
```

---

### Task 4: E2E — contributor secrets, picker cases, spec 24 names

**Files:**
- Modify: `tests/e2e/28-link-to-entity.spec.mjs`, `tests/e2e/24-entity-from-selection.spec.mjs`

- [ ] **Step 1: Spec 24 per-test names.** Replace its module-level `const N = {...}` with:

```js
// Per-test names (run id + test counter): a leftover from one test can never
// be an existing entity that turns another test's Create into Link to Entity.
const names = (tag) => ({
  camp: `${PREFIX}Camp${tag}`,
  place: `${PREFIX}Place${tag}`,
  other: `${PREFIX}Other${tag}`,
  elara: `${PREFIX}Elara${tag}`,
  boren: `${PREFIX}Boren${tag}`,
  // 81 characters, no whitespace: one past the 80-character cap.
  long: `${PREFIX}Long${tag}`.padEnd(81, "z")
});
let N = names(`${RUN}t0`);
let testSeq = 0;
```

and add as the first line inside `test.describe("24 create entity from selection", () => {`:

```js
  test.beforeEach(() => { N = names(`${RUN}t${++testSeq}`); });
```

- [ ] **Step 2: Spec 28 additions.** In `tests/e2e/28-link-to-entity.spec.mjs`, add constants and helpers after `journalCount`:

```js
const entityDialog = (page) => page.locator("dialog.application", { hasText: CREATE });
async function makeContributor(page, folder, userName = "User 1") {
  await page.evaluate(async ({ folder, MOD, userName }) => {
    const u = game.users.getName(userName);
    await game.folders.get(folder).setFlag(MOD, "campaign.contributors", { userIds: [u.id], groupIds: [] });
  }, { folder, MOD, userName });
}
async function revealTo(page, entryId, sectionId, userName) {
  await page.evaluate(async ({ entryId, sectionId, userName, MOD }) => {
    const u = game.users.getName(userName);
    await game.journal.get(entryId).pages.contents[0].update({
      [`flags.${MOD}.secretReveals.${sectionId}`]: { users: [u.id], groups: [], all: false, revealedAt: Date.now() }
    });
  }, { entryId, sectionId, userName, MOD });
}
```

Add `new: \`${PREFIX}New${RUN}\`` to `N`, and append these tests inside the describe:

```js
  test("Escape on the picker writes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.twin, "<p>First.</p>", folder, "person");
    await createMejPage(page, N.twin, "<p>Second.</p>", folder, "place");
    const html = `<p>Meet ${N.twin} here.</p>`;
    const place = await createMejPage(page, N.place, html, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.twin);
    await item(page, LINK).click();
    await expect(picker(page)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0, { timeout: 10_000 });
    await settle(page, 800);
    expect(await textOf(page, place.id)).toBe(html);
    assertNoConsoleErrors(errors);
  });

  test("a contributor chooses in the picker; the GM links the chosen entity", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.twin, "<p>First.</p>", folder, "person");
    const second = await createMejPage(page, N.twin, "<p>Second.</p>", folder, "place");
    const place = await createMejPage(page, N.place, `<p>Meet ${N.twin} here.</p>`, folder);
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.twin);
      await item(u1.page, LINK).click();
      await expect(picker(u1.page)).toBeVisible({ timeout: 10_000 });
      await picker(u1.page).locator("select[name='entity']").selectOption(second.uuid);
      await picker(u1.page).locator("button[data-action='ok']").click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(`<p>Meet @UUID[${second.uuid}]{${N.twin}} here.</p>`);
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("contributor Create links on a page with a secret revealed to them", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const html = `<p>Ask ${N.new} now.</p><section class="secret" id="secret-lte1"><p>${N.new} is a spy.</p></section>`;
    const place = await createMejPage(page, N.place, html, folder);
    await revealTo(page, place.id, "secret-lte1", "User 1");
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      const shell = await openEntry(u1.page, place.id);
      await expect(shell.locator("section.secret.mej-cc-revealed-to-you")).toBeVisible({ timeout: 15_000 });
      await selectAndOpenMenu(u1.page, N.new, 0);
      await item(u1.page, CREATE).click();
      const dialog = entityDialog(u1.page);
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator("input[name='linkOthers']").setChecked(false);
      await dialog.locator("button[data-action='ok']").click();
      await expect.poll(() => page.evaluate((n) => game.journal.getName(n)?.uuid ?? null, N.new), { timeout: 15_000 }).not.toBeNull();
      const uuid = await page.evaluate((n) => game.journal.getName(n).uuid, N.new);
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(html.replace(`Ask ${N.new} now`, `Ask @UUID[${uuid}]{${N.new}} now`));
      await expect(u1.page.locator("#notifications li.notification.info", { hasText: "Created" })).toHaveCount(1, { timeout: 15_000 });
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("contributor Link inside a secret revealed to everyone", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const html = `<p>Intro.</p><section class="secret revealed" id="secret-lte2"><p>Ask ${N.vex} now.</p></section>`;
    const place = await createMejPage(page, N.place, html, folder);
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.vex);
      await item(u1.page, LINK).click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(html.replace(`Ask ${N.vex} now`, `Ask @UUID[${vex.uuid}]{${N.vex}} now`));
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("contributor Link leaves a secret they cannot see untouched", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const html = `<p>Ask ${N.vex} now.</p><section class="secret" id="secret-lte3"><p>${N.vex} is hidden.</p></section>`;
    const place = await createMejPage(page, N.place, html, folder);
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.vex);
      await item(u1.page, LINK).click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(html.replace(`Ask ${N.vex} now`, `Ask @UUID[${vex.uuid}]{${N.vex}} now`));
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });
```

- [ ] **Step 3: RED check on the parked bug.** Temporarily reverse only Tasks 1–2's production changes (Task 3's edits to the same files do not overlap them), run the two secret-visible tests, then restore:

```bash
T1=$(git log --format=%H --grep="mask only the secret sections" -1); T2=$(git log --format=%H --grep="counts the secrets revealed" -1)
git diff $T1^ $T2 -- scripts/logic/reveal-state.mjs scripts/logic/entity-from-selection.mjs scripts/logic/entity-from-selection-run.mjs scripts/hooks/entity-from-selection-relay.mjs > $WS/fix.patch
git apply -R $WS/fix.patch
npx playwright test tests/e2e/28-link-to-entity.spec.mjs -g "secret revealed" > $WS/t4-red.txt 2>&1; grep -E "✓|✘|passed|failed" $WS/t4-red.txt
git apply $WS/fix.patch && git status --short scripts
```

Expected: both "contributor Create links on a page with a secret revealed to them" and "contributor Link inside a secret revealed to everyone" FAIL (created-not-linked / text unchanged); after re-applying, `git status --short scripts` prints nothing.

- [ ] **Step 4: Run GREEN on both worlds**

Run: `npx playwright test tests/e2e/28-link-to-entity.spec.mjs tests/e2e/24-entity-from-selection.spec.mjs > $WS/t4-a.txt 2>&1; tail -6 $WS/t4-a.txt` — Expected: 28: 10 passed; 24: 7 passed.
Run: `FOUNDRY_TARGET=v13 npx playwright test --trace off tests/e2e/28-link-to-entity.spec.mjs tests/e2e/24-entity-from-selection.spec.mjs > $WS/t4-b.txt 2>&1; tail -6 $WS/t4-b.txt` — Expected: same.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/28-link-to-entity.spec.mjs tests/e2e/24-entity-from-selection.spec.mjs
git commit -m "test(e2e): contributor selections with visible and hidden secrets; picker cases; per-test names in spec 24"
```

---

### Task 5: 03-search Hub-click flake

**Files:**
- Modify: `tests/e2e/03-search.spec.mjs` (`openHubSearch`)

- [ ] **Step 1: Try to reproduce**

Run: `npx playwright test tests/e2e/03-search.spec.mjs -g "playerHidden" --repeat-each=8 > $WS/t5-repro.txt 2>&1; grep -E "passed|failed" $WS/t5-repro.txt`
Expected: either a failure (read its trace/error-context and record the cause in the ledger) or 8/8 (record "not reproduced").

- [ ] **Step 2: Harden `openHubSearch`.** Replace the nav-button click with a wait for the shell to settle first:

```js
  const shell = page.locator("#MonksEnhancedJournal");
  // The shell re-renders once more after openJournalEntry resolves; clicking
  // the Hub button mid-render timed out waiting for it to be stable (flake
  // seen 2026-09-26). Wait for the rendered entry, then for the button.
  await expect(shell.locator(".editor-parent .editor-display[data-key], .journal-entry-page").first())
    .toBeVisible({ timeout: 30_000 });
  const hubButton = shell.locator(".nav-button.campaign-hub");
  await expect(hubButton).toBeVisible({ timeout: 30_000 });
  await hubButton.click({ timeout: 30_000 });
```

If Step 1 found a different cause, rule on the fix that addresses it instead and ledger the ruling.

- [ ] **Step 3: Verify**

Run: `npx playwright test tests/e2e/03-search.spec.mjs --repeat-each=3 > $WS/t5.txt 2>&1; grep -E "passed|failed" $WS/t5.txt`
Expected: all passed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/03-search.spec.mjs
git commit -m "test(e2e): 03-search waits for the shell to settle before opening the Hub"
```

---

### Task 6: Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** Under `## 0.23.0 (2026-09-26)`, after the **Added** bullet, add:

```markdown
- **Fixed:** a campaign contributor's Create Entity from Selection (and Link to Entity) now links the selection on pages with secrets revealed to them or to everyone; it used to report that the selected text could not be linked.
```

- [ ] **Step 2: Verify** — Run: `npm run check:links && npx vitest run 2>&1 | grep "Tests "` — Expected: links OK; all pass.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for contributor selections in visible secrets"
```
