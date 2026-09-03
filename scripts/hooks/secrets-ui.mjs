// scripts/hooks/secrets-ui.mjs
// Block-level secret reveal (spec §5): GM audience buttons on every native
// secret section; per-user re-enrichment for players with reveals; orphan
// pruning; live update on the replicated flag write. Same injection hooks
// and shell-refresh pattern as knowledge-ui.mjs (see its header comment).
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience, canSee, pruneReveals } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";
import { extractSecretBlocks, setSectionRevealed, sectionRevealedAll } from "../logic/secret-blocks.mjs";
import { bodyRegion } from "../logic/field-extractors.mjs";
import { suppressRevealToggles } from "../logic/secret-reveal-toggles.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

const REVEALS_FLAG = "secretReveals";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null;
}

function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  return mejType(doc) ? doc : null;
}

/**
 * Core's HTMLSecretBlockElement adds a Reveal/Hide toggle to every secret-block
 * on element upgrade, with NO permission check of its own (client/applications/
 * elements/secret-block.mjs - `#revealable = true`, and connectedCallback plants
 * the button with `hidden = !revealable`). The platform's only suppression is
 * DocumentSheetV2._toggleDisabled(true), which MEJ does reach for a subsheet the
 * viewer cannot edit (EnhancedJournalSheet._toggleDisabled, walking trueElement)
 * - but it runs BEFORE this module's render hooks, and injectPlayerSecrets then
 * replaces the whole enriched body. TextEditor.enrichHTML wraps every
 * section.secret in a FRESH <secret-block> (text-editor.mjs #wrapSecrets), which
 * defaults back to revealable, so a player holding any companion reveal on an
 * entry got a Hide control on every secret still on their screen - and clicking
 * it rewrites the GM's stored page. Do core's own operation ourselves for
 * anyone who cannot write the entry.
 */
function suppressCoreRevealToggles(sheet, element) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  if (page.parent?.isOwner) return;                 // GM / genuine owner keeps the control
  suppressRevealToggles(element);                   // v13 + v14 branches: logic/secret-reveal-toggles.mjs
}

const groupsSetting = () => normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
/** Reveal records live on the PAGE that holds the section (spec 2026-08-30). */
const revealsOf = (page) => page?.getFlag?.(MODULE_ID, REVEALS_FLAG) ?? {};

/** Short "who knows this" chip text for the GM button. */
function chipText(audience, groups) {
  const a = normalizeAudience(audience);
  if (a.all) return game.i18n.localize(`${I18N}.secrets.everyone`);
  const names = [
    ...game.users.filter((u) => a.users.includes(u.id)).map((u) => u.name),
    ...groups.filter((g) => a.groups.includes(g.id)).map((g) => g.name)
  ];
  return names.length ? names.join(", ") : game.i18n.localize(`${I18N}.secrets.chipsNone`);
}

async function injectGmOverlay(sheet, element, shellHosted) {
  const page = mejPageOf(sheet);
  if (!page || !element || !game.user.isGM) return;
  const entry = page.parent;
  if (!entry) return;
  const groups = groupsSetting();
  const reveals = revealsOf(page);
  // A session page renders its body into data-key="system.recap"; everything
  // else into text.content. Pinning text.content meant recap secrets got no
  // audience button at all, so they could be seen in the tracker and never
  // revealed to anyone.
  const { key, content } = bodyRegion(page);
  const sections = element.querySelectorAll(`.editor-display[data-key="${key}"] section.secret`);
  for (const section of sections) {
    if (section.querySelector(":scope > .mej-cc-secret-audience")) continue;
    const id = section.id ?? "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mej-cc-secret-audience";
    if (!id) {
      button.disabled = true;
      button.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.noId`);
      button.innerHTML = '<i class="fa-solid fa-user-secret"></i>';
    } else {
      // The chip must read the SAME two sources the tracker and the dialog do
      // (sectionRevealedAll): "Everyone" now lives as Foundry's class in the
      // body, so a flag-only read here showed "None" on a secret the Hub was
      // simultaneously reporting as revealed to everyone.
      const audience = { ...normalizeAudience(reveals[id]), all: sectionRevealedAll(content, id, reveals[id]) };
      button.innerHTML = `<i class="fa-solid fa-user-secret"></i> <span class="mej-cc-secret-chips">${foundry.utils.escapeHTML(chipText(audience, groups))}</span>`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        editAudience(entry, page, id, section, sheet, shellHosted)
          .catch((err) => console.error(`${MODULE_ID} | secret reveal failed`, err));
      });
    }
    section.prepend(button);
  }
  // Deferred, not awaited in this render's own hook chain: pruneOrphans
  // writes back to the page via page.update(), and Document#update()
  // re-renders any open sheet for that document to reflect the change. Doing
  // that write from INSIDE renderJournalPageSheet's own hook chain re-enters
  // MEJ's PlaceSheet render mid-flight (this render hasn't settled yet) and
  // crashed there intermittently - confirmed live: "Failed to render
  // Application ...PlaceSheet...: Cannot read properties of undefined
  // (reading 'attributes')" inside PlaceSheet.fieldlist(), reproduced with
  // and without other test-side mitigations, only when this write happened
  // synchronously inside this same render pass. A reveal write from
  // editAudience (this file), which always happens well after a render has
  // settled - never from inside the render hook itself - never hit this.
  // setTimeout(0) gets the write off this task without an artificial delay:
  // it runs after the current render has finished settling, same timing the
  // reveal path already proves safe.
  setTimeout(() => pruneOrphans(page).catch((err) => console.error(`${MODULE_ID} | secret prune failed`, err)), 0);
}

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
 * fails, so the caller can skip the flag write - leaving the two halves in
 * agreement rather than storing an audience the body never got.
 *
 * `all` is forced false ONLY when the class can actually carry the reveal. If
 * there is no page, or the section id isn't in this body, we cannot express
 * "everyone" natively - and what to store then depends on whether the record
 * ALREADY meant everyone:
 *
 * - It did (`legacyAll`): keep `all: true`. Clearing it would downgrade a
 *   legacy record - which readers honour forever - to "revealed to nobody",
 *   silently un-revealing a secret we simply had no native place to express.
 * - It did not: store `all: false`, even though the GM asked for everyone.
 *   Minting a fresh `all: true` here would claim a reveal that nothing backs:
 *   the chip and tracker would read "Everyone" while core sheets and the
 *   player-safe export - which key on the class - still strip the block. That
 *   is exactly the companion-private "Everyone" this round exists to abolish,
 *   so we refuse to create a new one. The reveal simply does not take, which
 *   is visible in the chip rather than hidden behind a false claim.
 *
 * Reachable when the live DOM shows a section our regex parser cannot see -
 * a `<section class="secret">` nested inside another `<section>`, which
 * SECTION_RE is documented not to support (secret-blocks.mjs) but pasted
 * HTML can still produce.
 */
export async function applyBlockReveal(page, sectionId, audience, { legacyAll = false } = {}) {
  const requested = normalizeAudience(audience);
  const { key, content } = bodyRegion(page ?? {});
  const present = extractSecretBlocks(content).some((s) => s.id === sectionId);
  if (!page || !present) return { ...requested, all: requested.all && legacyAll === true };
  const next = setSectionRevealed(content, sectionId, requested.all);
  if (next !== content) await page.update({ [key]: next });
  return { ...requested, all: false };
}

async function editAudience(entry, page, sectionId, section, sheet, shellHosted) {
  if (!game.user.isGM) return;
  const groups = groupsSetting();
  const record = revealsOf(page)[sectionId];
  // Seed the dialog from BOTH sources (sectionRevealedAll), not the flag
  // alone: with "Everyone" now stored as the native class, a flag-only seed
  // opened the dialog with Everyone unchecked on an already-everyone secret,
  // so simply adding one player to it stripped the class back off and
  // un-revealed the secret from the table. It also kept sendRevealWhisper's
  // "already everyone -> whisper nobody" branch permanently dead, re-whispering
  // every player on every re-confirmation.
  const previous = { ...normalizeAudience(record), all: sectionRevealedAll(bodyRegion(page).content, sectionId, record) };
  const audience = await promptAudience({
    title: game.i18n.localize(`${I18N}.secrets.revealTitle`), audience: previous, groups
  });
  if (!audience) return;
  const stored = await applyBlockReveal(page, sectionId, audience, { legacyAll: record?.all === true });
  await page.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}.${sectionId}`]: stored });
  // Whisper the section's content (already enriched in the GM's DOM) minus our own button.
  const clone = section.cloneNode(true);
  clone.querySelector(":scope > .mej-cc-secret-audience")?.remove();
  await sendRevealWhisper({
    audience, previousAudience: previous, groups,
    html: clone.innerHTML, entryUuid: entry.uuid, entryName: entry.name
  });
  // The updateJournalEntry hook below reloads the shell for the acting GM
  // too - it fires locally on every client that receives the update,
  // including this one, not just other clients - so an explicit shell
  // refresh here would double-reload it. Popped-out sheets are not shell-
  // hosted, so the hook's shell-only check never covers them; refresh those
  // directly.
  if (!shellHosted) sheet.render?.({ parts: ["main"] });
}

/**
 * Drop reveal records whose section no longer exists in THIS page's body.
 * Page-scoped read and page-scoped write: the entry-level version deleted
 * page 2's records whenever page 1 was opened (spec 2026-08-30 defect 2).
 *
 * Reads the SAME body source the live index uses (system.recap for session
 * pages, text.content for everything else - field-extractors.mjs's
 * bodyText()) rather than only text.content: that fallback is empty on
 * session pages, so before this fix opening a Session sheet deleted every
 * secretReveals record for its recap secrets (I1a). Ids are parsed via
 * extractSecretBlocks (the same parser the index/prune paths share) instead
 * of a local double-quote-only regex, which also fixes I2 - creation paths
 * accept single-quoted id attributes too.
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

/**
 * Player path (spec §5): only when this user has ≥1 reveal on the entry —
 * re-enrich raw content with secrets:true, strip sections not visible to
 * this user, and swap into the rendered container. DOM-based (robust to
 * nested markup); the pure regex parser is only for index/export.
 */
async function injectPlayerSecrets(sheet, element) {
  if (game.user.isGM) return;
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  const reveals = revealsOf(page);
  const groups = groupsSetting();
  const mine = Object.entries(reveals).filter(([, aud]) => canSee(aud, game.user.id, groups)).map(([id]) => id);
  if (!mine.length) return;
  const { key, content } = bodyRegion(page);
  const container = element.querySelector(`.editor-display[data-key="${key}"]`);
  if (!container) return;
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    content, { relativeTo: page, secrets: true, async: true }
  );
  // DOMParser, never createContextualFragment (S1). Two reasons here. The
  // enriched body is authored markup and createContextualFragment parses it in
  // the LIVE document's context, where it can act rather than just be read.
  // And this parse deliberately contains EVERY secret section (enrichHTML ran
  // with secrets:true) including the ones this viewer is not cleared for,
  // which the loop below then removes - so parsing it live would let a secret
  // this player must not see start fetching its own images first. DOMParser's
  // document is inert; only what survives the filter reaches the live DOM
  // (replaceChildren adopts the nodes across documents).
  const root = new DOMParser().parseFromString(enriched, "text/html").body;
  const allowed = new Set(mine);
  for (const section of root.querySelectorAll("section.secret")) {
    if (section.classList.contains("revealed")) continue;
    if (allowed.has(section.id)) {
      section.classList.add("mej-cc-revealed-to-you");
      section.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.revealedToYou`);
    } else {
      section.remove();
    }
  }
  container.replaceChildren(...root.childNodes);
  // Last: the sections above arrive AFTER MEJ's own _toggleDisabled sweep
  // (and after this hook's synchronous pass) already walked the element.
  suppressCoreRevealToggles(sheet, element);
}

/**
 * Sheets showing a JournalEntryPage that are NOT the shell's mounted
 * subsheet - i.e. popped-out windows. Feature-detected against Foundry's
 * ApplicationV2 instance registry; an empty list is a safe degradation (the
 * shell still refreshes), never an error.
 */
function poppedOutPageSheets() {
  const registry = foundry.applications?.instances;
  if (!registry?.values) return [];
  const shellSubsheet = game.MonksEnhancedJournal?.journal?.subsheet ?? null;
  return [...registry.values()].filter((app) =>
    app && app !== shellSubsheet && app.rendered && app.document instanceof JournalEntryPage);
}

/**
 * Re-render everything that could be displaying a reveal for `entry`.
 *
 * The shell reload alone was not enough: a popped-out sheet is its own
 * Application and MEJ's shell knows nothing about it, so a player watching a
 * secret in a popped-out window saw nothing change when the GM revealed it -
 * they had to close and reopen. `entry` may be null (a settings change, where
 * no single entry is implicated), in which case every popped-out page sheet
 * is refreshed rather than trying to guess which ones carry reveals.
 */
function refreshRevealViews(entry) {
  const shell = game.MonksEnhancedJournal?.journal;
  if (shell?.rendered) {
    const shown = shell.document?.parent ?? shell.document;
    if (!entry || shown?.uuid === entry.uuid || shell.document?.uuid === entry.uuid) {
      shell.render({ tempOwnership: shell.tempOwnership, reload: true });
    }
  }
  for (const app of poppedOutPageSheets()) {
    if (entry && app.document?.parent?.uuid !== entry.uuid) continue;
    app.render?.();
  }
}

export function registerSecretsUi() {
  const inject = (sheet, html, shellHosted) => {
    const element = asElement(html);
    injectGmOverlay(sheet, element, shellHosted).catch((err) => console.error(`${MODULE_ID} | secret overlay failed`, err));
    injectPlayerSecrets(sheet, element).catch((err) => console.error(`${MODULE_ID} | player secret render failed`, err));
    suppressCoreRevealToggles(sheet, element);
  };
  Hooks.on("renderJournalPageSheet", (sheet, html) => inject(sheet, html, true));
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => inject(sheet, html, false));

  // Live update (spec §5): relationship reveals (relReveals) are still an
  // entry-level flag; block reveals (secretReveals) moved to the page in
  // this round (spec 2026-08-30) and are watched by the
  // updateJournalEntryPage hook below instead. MEJ's own updateJournalEntry
  // hook ignores foreign flag namespaces (see knowledge-ui.mjs's refresh
  // comment), so reload the shell ourselves when it is showing the updated
  // entry.
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (changes?.flags?.[MODULE_ID]?.relReveals === undefined) return;
    refreshRevealViews(entry);
  });

  // Block reveals (secretReveals, spec 2026-08-30) and checklist audience
  // reveals (session.secrets, spec §5/§7) are both page-level flags on the
  // JournalEntryPage - MEJ's own updateJournalEntryPage handling ignores
  // foreign flag namespaces in its re-render allowlist (same gap as
  // knowledge-ui.mjs's entry-level comment above), so neither kind of
  // reveal live-updates another client's shell-hosted sheet without this
  // (I3). Refreshed the same way as the entry-level reveal above.
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    const flags = changes?.flags?.[MODULE_ID];
    if (flags?.[REVEALS_FLAG] === undefined && flags?.session?.secrets === undefined) return;
    const entry = page.parent;
    if (!entry) return;
    // No `shell.rendered` precondition here any more: it used to sit in front
    // of this and return early, which meant a popped-out sheet got no refresh
    // whenever the shell happened to be closed - exactly the case the
    // popped-out path exists to serve. refreshRevealViews checks the shell
    // itself.
    refreshRevealViews(entry);
  });

  // Group membership is resolved LIVE at render time (logic/reveal-state.mjs's
  // canSee), so moving a player into or out of a group changes what they may
  // see - but nothing re-rendered on that write, so the change only took
  // effect the next time something else happened to trigger a render. No
  // single entry is implicated, so every open view is refreshed.
  Hooks.on("updateSetting", (setting) => {
    if (setting?.key !== `${MODULE_ID}.${PLAYER_GROUPS_SETTING}`) return;
    refreshRevealViews(null);
  });
}
