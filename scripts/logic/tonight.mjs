// View model for the Tonight strip (spec 2026-10-15 §5.1). Pure.
import { notesForSession, heldNotes, canEditNote, noteBadges } from "./notes.mjs";

export function tonightContext({ campaign, session, notes, user, formatTime, canWrite }) {
  if (!campaign) return null;
  const open = !!session;
  const own = open ? notesForSession(notes, session.uuid) : [];
  const recent = [...own].sort((a, b) => b.at - a.at).slice(0, 3)
    .map((n) => ({ id: n.id, authorName: n.authorName || n.authorId, timeLabel: formatTime(n.at), text: n.text, retracted: noteBadges(n, user?.isGM).retracted }));
  return {
    campaignName: campaign.name,
    open,
    sessionName: open ? session.name : "",
    sessionUuid: open ? session.uuid : null,
    startedLabel: open ? formatTime(session.startedAt) : "",
    noteCount: own.length,
    heldCount: heldNotes(notes).length,
    recent,
    canCapture: canWrite === true,
    canStart: user.isGM === true && !open,
    canEnd: user.isGM === true && open
  };
}

/** Rows for the Session page's notes stream: oldest first. */
export function streamRows(notes, user, { formatTime }) {
  return [...(notes ?? [])].sort((a, b) => a.at - b.at).map((n) => ({
    id: n.id, authorName: n.authorName || n.authorId, timeLabel: formatTime(n.at), text: n.text,
    edited: n.editedAt !== null, canEdit: canEditNote(n, user), retracted: noteBadges(n, user?.isGM).retracted
  }));
}
