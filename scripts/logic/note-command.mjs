// `/note <text>` and `/n <text>` (spec item 3). Pure; the chat hook is in hooks/note-command.mjs.
const RE = /^\/(?:note|n)\s+(\S[\s\S]*)$/i;
// Foundry 14's prose-mirror chat box wraps every message in a block element
// (`<p>…</p>`); Foundry 13's textarea never does. That wrapper is the only
// reliable HTML cue - a tag-like word inside plain text is the player's text.
const BLOCK_START = /^\s*<(?:p|div)\b/i;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X";
      const code = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/**
 * The text of a chat message as Foundry's ChatLog.parse reads it. A message
 * that starts with a block wrapper (`<p`, `<div`) is Foundry 14's serialized
 * HTML: `<br>` and paragraph boundaries become newlines, other tags are
 * dropped, entities decoded. Anything else is plain text, returned trimmed
 * with any literal `<…>` kept (spec 2026-10-16 §5).
 */
export function chatMessageText(message) {
  if (typeof message !== "string") return "";
  if (!BLOCK_START.test(message)) return message.trim();
  let previous;
  let text = message;
  do {
    previous = text;
    text = text
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/p>\s*<p\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return decodeEntities(text).trim();
}

export function parseNoteCommand(message) {
  const m = chatMessageText(message).match(RE);
  if (!m) return null;
  const text = m[1].trim();
  return text ? { text } : null;
}
