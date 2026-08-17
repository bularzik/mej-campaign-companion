// scripts/apps/prep-board-app.mjs
// Session prep board (spec §8): GM-only floating window bound to one
// Session page. Four zones — attendees, secrets/clues with one-click
// reveal, linked entries (outbound refs + mention badges), scratch notes
// (prepNotes flag, 300ms trailing-debounced like the Phase B attributes).
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience, isRevealed } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { outboundRefsForEntry, mentionBadgeCounts } from "../search/live-index.mjs";
import { promptAudience, sendRevealWhisper } from "./audience-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const FLAG_SESSION = `flags.${MODULE_ID}.session`;

export class PrepBoardApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["mej-cc-prep-board"],
    window: { title: `${I18N}.prep.title`, icon: "fa-solid fa-clipboard-list", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      revealSecret: PrepBoardApp.onRevealSecret,
      toggleSecret: PrepBoardApp.onToggleSecret,
      openLinked: PrepBoardApp.onOpenLinked
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
      notes: page.getFlag(MODULE_ID, "prepNotes") ?? ""
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const notes = this.element.querySelector(".mej-cc-prep-notes textarea");
    const commit = foundry.utils.debounce(async () => {
      try {
        await this.#page.update({ [`flags.${MODULE_ID}.prepNotes`]: notes.value });
      } catch (err) {
        console.error(`${MODULE_ID} | prep board notes save failed`, err);
      }
    }, 300);
    notes?.addEventListener("input", commit);
    // Live refresh on session-page updates (secrets toggled elsewhere, etc.).
    if (this.#hookId === null) {
      this.#hookId = Hooks.on("updateJournalEntryPage", (page, changes) => {
        if (page.uuid !== this.#page.uuid || !this.rendered) return;
        if (changes?.flags?.[MODULE_ID]?.prepNotes !== undefined) return; // our own debounced write
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
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: item.audience, groups });
      if (!audience) return;
      // Re-read fresh data after the dialog closes rather than reusing the
      // pre-dialog `session` snapshot: a co-GM or another window (e.g. the
      // Hub's secrets tracker, or this session's own sheet) may have
      // mutated secrets while this dialog was open, and writing back the
      // stale array would silently revert that concurrent edit. The item
      // may even have been deleted in the meantime - bail with no write if
      // so. The whisper still uses the pre-dialog item.audience as
      // previousAudience: that's the audience the GM actually saw and
      // compared against in the dialog.
      const current = sessionData(this.page).secrets;
      if (!current.find((s) => s.id === id)) return;
      const secrets = current.map((s) => (s.id === id ? { ...s, audience } : s));
      await this.page.update({ [`${FLAG_SESSION}.secrets`]: secrets });
      await sendRevealWhisper({
        audience, previousAudience: item.audience, groups,
        html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`,
        entryUuid: this.page.parent.uuid, entryName: this.page.parent.name
      });
      await this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | prep board reveal secret failed`, err);
    }
  }

  static async onToggleSecret(event, target) {
    if (!game.user.isGM) return;
    try {
      const id = target.closest("[data-id]")?.dataset.id;
      const session = sessionData(this.page);
      const secrets = session.secrets.map((s) => {
        if (s.id !== id) return s;
        const revealed = !s.revealed;
        return { ...s, revealed, revealedAt: revealed ? Date.now() : null };
      });
      await this.page.update({ [`${FLAG_SESSION}.secrets`]: secrets });
      await this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | prep board toggle secret failed`, err);
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
