// Turn entity names in a note into @UUID links, bounded exactly like the
// typing-path auto-link: campaign scope and audience containment, with the
// notes entry's own readers as the audience. Pure pieces come from
// logic/auto-link*.mjs; this file only gathers Foundry inputs.
//
// Output is HTML-escaped text plus `@UUID[...]{name}` shorthand only (autoLinkAdded
// emits shorthand, never anchors); enrichment happens at render time. Escaping
// and typed-enricher neutralization live in logic/note-text.mjs.
import { linkNoteHtml } from "../logic/note-text.mjs";
import { noteHtmlSource } from "../logic/notes.mjs";
import { noteMayMention } from "../logic/note-about.mjs";
import { selectCandidates, dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { sameLinkScope } from "../logic/link-targets.mjs";
import { campaignIdOf, isLinkableEntity } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { notesEntryOf } from "../data/notes-store.mjs";

/** True iff everyone who reads the campaign's notes can also see `entry` (so a code-built link to it leaks nothing). */
export function canMentionInNotes(campaign, entry) {
  const notesEntry = notesEntryOf(campaign);
  if (!notesEntry || !entry) return false;
  const users = game.users.contents;
  return noteMayMention(viewerIds(notesEntry, users, isVisibleToUser), viewerIds(entry, users, isVisibleToUser));
}

export function linkNoteText(campaign, text) {
  const notesEntry = notesEntryOf(campaign);
  if (!notesEntry) return linkNoteHtml(text, []);
  const users = game.users.contents;
  const readers = viewerIds(notesEntry, users, isVisibleToUser);
  const campaignId = campaignIdOf(notesEntry);
  const pages = game.journal
    .filter((entry) => isLinkableEntity(entry, mejType) && sameLinkScope(campaignId, campaignIdOf(entry)))
    .map((entry) => ({
      id: entry.id, uuid: entry.uuid, name: entry.name, indexable: true,
      visible: audienceContains(readers, viewerIds(entry, users, isVisibleToUser))
    }));
  const candidates = dropAmbiguousNames(selectCandidates({ pages, selfId: null })).kept;
  return linkNoteHtml(text, candidates);
}

/**
 * Enrichers notes never need, switched off on every note render. `custom: false` keeps other
 * modules' enrichers off note text; `documents` stays on for the code-built @UUID auto-links.
 */
export const NOTE_ENRICH_OPTIONS = { secrets: false, rolls: false, embeds: false, custom: false };

/**
 * The one render path for note text: escape again (idempotent), then enrich with the
 * unused enrichers disabled. Output is safe for triple-stash.
 */
export function enrichNoteText(text, options = {}) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(noteHtmlSource(text), {
    ...options, async: true, ...NOTE_ENRICH_OPTIONS
  });
}
