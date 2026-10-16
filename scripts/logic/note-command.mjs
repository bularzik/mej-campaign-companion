// `/note <text>` and `/n <text>` (spec item 3). Pure; the chat hook is in hooks/note-command.mjs.
const RE = /^\/(?:note|n)\s+(\S[\s\S]*)$/i;

export function parseNoteCommand(message) {
  const m = typeof message === "string" ? message.match(RE) : null;
  if (!m) return null;
  const text = m[1].trim();
  return text ? { text } : null;
}
