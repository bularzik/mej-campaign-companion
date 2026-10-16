// Turn entity names in a note into @UUID links, bounded exactly like the
// typing-path auto-link: campaign scope and audience containment, with the
// notes entry's own readers as the audience. Pure pieces come from
// logic/auto-link*.mjs; this file only gathers Foundry inputs.
//
// Output is HTML-escaped text plus `@UUID[...]{name}` shorthand only (autoLinkAdded
// emits shorthand, never anchors); enrichment happens at render time. Escaping
// and typed-enricher neutralization live in logic/note-text.mjs.
import { linkNoteHtml } from "../logic/note-text.mjs";
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
