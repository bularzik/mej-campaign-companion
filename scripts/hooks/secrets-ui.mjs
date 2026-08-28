// scripts/hooks/secrets-ui.mjs
// Block-level secret reveal (spec §5): GM audience buttons on every native
// secret section; per-user re-enrichment for players with reveals; orphan
// pruning; live update on the replicated flag write. Same injection hooks
// and shell-refresh pattern as knowledge-ui.mjs (see its header comment).
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience, canSee, pruneReveals } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";
import { extractSecretBlocks, setSectionRevealed } from "../logic/secret-blocks.mjs";
import { bodyRegion } from "../logic/field-extractors.mjs";
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

const groupsSetting = () => normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
const revealsOf = (entry) => entry?.getFlag?.(MODULE_ID, REVEALS_FLAG) ?? {};

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
  const reveals = revealsOf(entry);
  // A session page renders its body into data-key="system.recap"; everything
  // else into text.content. Pinning text.content meant recap secrets got no
  // audience button at all, so they could be seen in the tracker and never
  // revealed to anyone.
  const { key } = bodyRegion(page);
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
      const audience = normalizeAudience(reveals[id]);
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
  await pruneOrphans(entry, page);
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

async function editAudience(entry, page, sectionId, section, sheet, shellHosted) {
  if (!game.user.isGM) return;
  const groups = groupsSetting();
  const previous = normalizeAudience(revealsOf(entry)[sectionId]);
  const audience = await promptAudience({
    title: game.i18n.localize(`${I18N}.secrets.revealTitle`), audience: previous, groups
  });
  if (!audience) return;
  const stored = await applyBlockReveal(page, sectionId, audience);
  await entry.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}.${sectionId}`]: stored });
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
 * Drop reveal records whose section no longer exists in the content (spec
 * §5). GM-side only. Reads the SAME body source the live index uses
 * (system.recap for session pages, text.content for everything else -
 * field-extractors.mjs's bodyText()) rather than only text.content: that
 * fallback is empty on session pages, so before this fix opening a Session
 * sheet deleted every secretReveals record for its recap secrets (I1a). Ids
 * are parsed via extractSecretBlocks (the same parser the index/prune paths
 * share) instead of a local double-quote-only regex, which also fixes I2 -
 * creation paths accept single-quoted id attributes too.
 */
async function pruneOrphans(entry, page) {
  const reveals = revealsOf(entry);
  const keys = Object.keys(reveals);
  if (!keys.length) return;
  const liveIds = extractSecretBlocks(page?.system?.recap ?? page?.text?.content ?? "").map((s) => s.id);
  const { map, changed } = pruneReveals(reveals, liveIds);
  // recursive:false replaces the whole secretReveals object outright -
  // Document#update otherwise merges nested objects key-by-key by default
  // (diff:false only trims the payload sent over the wire, it doesn't force
  // replacement), so a plain update here would leave pruned ids' audience
  // records still present in storage, ready to silently reattach if a
  // section id is ever reused.
  if (changed) await entry.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}`]: map }, { recursive: false });
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
  const entry = page.parent;
  const reveals = revealsOf(entry ?? {});
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
  };
  Hooks.on("renderJournalPageSheet", (sheet, html) => inject(sheet, html, true));
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => inject(sheet, html, false));

  // Live update (spec §5): the reveal flag write replicates to every
  // client; MEJ's own updateJournalEntry hook ignores foreign flag
  // namespaces (see knowledge-ui.mjs's refresh comment), so reload the
  // shell ourselves when it is showing the updated entry.
  Hooks.on("updateJournalEntry", (entry, changes) => {
    const flags = changes?.flags?.[MODULE_ID];
    if (flags?.[REVEALS_FLAG] === undefined && flags?.relReveals === undefined) return;
    refreshRevealViews(entry);
  });

  // Checklist audience reveals (spec §5/§7) are written as a page-level flag
  // (flags.mej-campaign-companion.session.secrets on the Session page
  // itself), not an entry-level flag like the reveal above - MEJ's own
  // updateJournalEntryPage handling ignores foreign flag namespaces in its
  // re-render allowlist (same gap as knowledge-ui.mjs's entry-level comment
  // above), so a checklist reveal never live-updates another client's
  // shell-hosted Session sheet without this (I3). Refreshed the same way as
  // the entry-level reveal above.
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    if (changes?.flags?.[MODULE_ID]?.session?.secrets === undefined) return;
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
