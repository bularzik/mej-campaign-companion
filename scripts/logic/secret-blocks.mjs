/**
 * Regex-based parsing of Foundry's native secret blocks
 * (<section class="secret" id="secret-…">…</section>) out of raw journal
 * HTML — pure and Foundry-free for vitest. Assumes well-formed ProseMirror
 * editor output; a <section> nested INSIDE a secret section is not
 * supported (the non-greedy close-tag match would truncate it). The
 * render-time paths use real DOM instead (hooks/secrets-ui.mjs); this
 * module serves the scan pipeline (spec §9) and docx export (spec §11).
 */

const SECTION_RE = /<section\b[^>]*>[\s\S]*?<\/section>/gi;

function attr(openTag, name) {
  const m = openTag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : "";
}

function classesOf(block) {
  const openTag = block.slice(0, block.indexOf(">") + 1);
  return attr(openTag, "class").split(/\s+/).filter(Boolean);
}

function isSecret(block) {
  return classesOf(block).includes("secret");
}

function textPreview(html, max = 140) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(?=[.,;:!?\)])/g, "").slice(0, max);
}

export function extractSecretBlocks(html) {
  const out = [];
  for (const block of String(html ?? "").match(SECTION_RE) ?? []) {
    if (!isSecret(block)) continue;
    const openTag = block.slice(0, block.indexOf(">") + 1);
    out.push({
      id: attr(openTag, "id"),
      preview: textPreview(block),
      revealedAll: classesOf(block).includes("revealed")
    });
  }
  return out;
}

/**
 * Export stripping (spec §11): remove every unrevealed secret section
 * unless includeAll (the export dialog's GM-content opt-in). Audience-only
 * reveals are removed too — they are not revealed to "everyone", and a
 * player-safe export must not carry them.
 */
export function stripSecretSections(html, { includeAll = false } = {}) {
  const src = String(html ?? "");
  if (includeAll) return src;
  return src.replace(SECTION_RE, (block) =>
    isSecret(block) && !classesOf(block).includes("revealed") ? "" : block
  );
}
