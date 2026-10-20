// scripts/apps/prep-board-app.mjs
// Session prep board (spec §8): GM-only floating window bound to one
// Session page. Four zones — attendees, secrets/clues with one-click
// reveal, linked entries (outbound refs + mention badges), and the session's
// GM Notes (read-only here; edited on the Session sheet).
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience, isRevealed } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { applyChecklistAudience, checklistSeed } from "../logic/checklist-reveal.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { outboundRefsForEntry, mentionBadgeCounts } from "../search/live-index.mjs";
import { promptAudience, sendRevealWhisper } from "./audience-dialog.mjs";
import { fileRevealChange, revealLabel } from "../hooks/reveal-filing.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const FLAG_SESSION = `flags.${MODULE_ID}.session`;

export class PrepBoardApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["mej-cc-prep-board"],
    window: { title: `${I18N}.prep.title`, icon: "fa-solid fa-clipboard-list", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      revealSecret: PrepBoardApp.onRevealSecret,
      openLinked: PrepBoardApp.onOpenLinked,
      editGmNotes: PrepBoardApp.onEditGmNotes
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/prep-board.hbs`, scrollable: [".mej-cc-prep-linked", ".mej-cc-prep-secrets"] } };

  #page;
  #hookId = null;

  // Per-page unique id: DEFAULT_OPTIONS carries no `id`, so it falls back to
  // ApplicationV2's own default id template ("app-{id}") until this
  // constructor's options are merged in last (see application.mjs's
  // _initializeApplicationOptions/#mergeApplicationOptions - constructor
  // options always merge after every class's DEFAULT_OPTIONS in the chain)
  // and fully replace it with this plain string. Our string has no "{id}"
  // token, so the constructor's trailing
  // `this.#id = this.options.id.replace("{id}", uniqueId)` is a harmless
  // no-op and #id ends up exactly `mej-cc-prep-<page id>` - already unique
  // per Session page, distinct from RelationshipGraphApp's single
  // world-wide `mej-cc-graph` id (DEFAULT_OPTIONS-only, no constructor
  // options) since that app is a singleton, not per-document. Verified
  // against this repo's vendored FoundryVTT 14.365 core - no conflict.
  constructor({ page }) {
    super({ id: `mej-cc-prep-${page.id}` });
    this.#page = page;
  }

  get page() { return this.#page; }

  async _prepareContext() {
    const page = this.#page;
    const entry = page.parent;
    const session = sessionData(page);
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const attendees = await Promise.all((session.attendees ?? []).map(async (uuid) => {
      const actor = await fromUuid(uuid).catch(() => null);
      return { uuid, name: actor?.name ?? uuid, img: actor?.img ?? "icons/svg/mystery-man.svg" };
    }));
    const mentions = mentionBadgeCounts();
    const linked = outboundRefsForEntry(entry.uuid).map((r) => ({
      ...r, icon: `fas ${game.MonksEnhancedJournal.getIcon(r.type)}`, mentions: mentions.get(r.uuid) ?? 0
    }));
    return {
      name: entry.name,
      attendees,
      secrets: (session.secrets ?? []).map((s) => ({
        ...s,
        revealedAny: s.revealed === true || isRevealed(s.audience),
        audienceCount: normalizeAudience(s.audience).users.length + normalizeAudience(s.audience).groups.length
      })),
      linked,
      // GM-only app (openPrepBoard returns for non-GMs), so the GM Notes HTML
      // is safe to render; enrichHTML sanitizes it.
      gmNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        page.system?.gmNotes ?? "", { relativeTo: page, secrets: true, async: true })
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Live refresh on session-page updates (secrets toggled elsewhere, GM
    // Notes edited on the session, etc.).
    if (this.#hookId === null) {
      this.#hookId = Hooks.on("updateJournalEntryPage", (page) => {
        if (page.uuid !== this.#page.uuid || !this.rendered) return;
        this.render().catch((err) => console.error(`${MODULE_ID} | prep board refresh failed`, err));
      });
    }
  }

  _onClose(options) {
    if (this.#hookId !== null) { Hooks.off("updateJournalEntryPage", this.#hookId); this.#hookId = null; }
    super._onClose?.(options);
  }

  static async onRevealSecret(event, target) {
    if (!game.user.isGM) return;
    try {
      const id = target.closest("[data-id]")?.dataset.id;
      const session = sessionData(this.page);
      const item = session.secrets.find((s) => s.id === id);
      if (!item) return;
      const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: checklistSeed(item), groups });
      if (!audience) return;
      // Re-read fresh data after the dialog closes rather than reusing the
      // pre-dialog `session` snapshot: a co-GM or another window (e.g. the
      // Hub's secrets tracker, or this session's own sheet) may have
      // mutated secrets while this dialog was open, and writing back the
      // stale array would silently revert that concurrent edit. The item
      // may even have been deleted in the meantime - bail with no write if
      // so. The whisper still uses the pre-dialog seed as previousAudience:
      // that's the audience the GM actually saw and compared against in the
      // dialog.
      const current = sessionData(this.page).secrets;
      if (!current.find((s) => s.id === id)) return;
      const secrets = current.map((s) => (s.id === id ? applyChecklistAudience(s, audience) : s));
      await this.page.update({ [`${FLAG_SESSION}.secrets`]: secrets });
      const entryName = this.page.parent?.name ?? this.page.name;
      await fileRevealChange({ entry: this.page.parent, target: this.page, kind: "checklist", id, previous: checklistSeed(item), audience, label: revealLabel("checklist", entryName) });
      await sendRevealWhisper({
        audience, previousAudience: checklistSeed(item), groups,
        html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`,
        entryUuid: this.page.parent.uuid, entryName: this.page.parent.name
      });
      await this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | prep board reveal secret failed`, err);
    }
  }

  static async onEditGmNotes() {
    if (!game.user.isGM) return;
    try {
      const page = this.page;
      await game.MonksEnhancedJournal.openJournalEntry(page.parent);
      // GM Prep is always editable (spec 2026-10-19 §4.4): once the shell has
      // mounted the page, switch to its tab and put the caret in it.
      setTimeout(() => {
        const sheet = game.MonksEnhancedJournal?.journal?.subsheet;
        if (sheet?.document?.uuid === page.uuid) sheet.focusEditor?.("gmNotes");
      }, 400);
    } catch (err) {
      console.error(`${MODULE_ID} | prep board edit GM notes failed`, err);
    }
  }

  static async onOpenLinked(event, target) {
    try {
      const entry = await fromUuid(target.closest("[data-uuid]")?.dataset.uuid);
      if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
    } catch (err) {
      console.error(`${MODULE_ID} | prep board open linked entry failed`, err);
    }
  }
}

export async function openPrepBoard({ pageUuid }) {
  if (!game.user.isGM) return;
  const page = await fromUuid(pageUuid);
  if (page) new PrepBoardApp({ page }).render(true);
}
