// Where a note's label should link to. Pure.

/**
 * Media notes (ref.kind "media") link to their image; reveal notes link to the
 * revealed page, or the mentioned entry when no page is recorded. Media is
 * checked first because media notes are also kind "reveal" (with no mentions).
 * @returns {{ kind: "image", src: string } | { kind: "entry", uuid: string } | null}
 */
export function noteLinkTarget(note) {
  const ref = note?.ref;
  if (ref?.kind === "media") return ref.src ? { kind: "image", src: ref.src } : null;
  if (note?.kind === "reveal" && note.mentions?.length) {
    return { kind: "entry", uuid: ref?.pageUuid || note.mentions[0] };
  }
  return null;
}
