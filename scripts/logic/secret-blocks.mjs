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
  const m = openTag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return m ? m[2] : "";
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

/**
 * "Is this secret revealed to everyone?" - the ONE definition, shared by every
 * reader (design §4): the Hub tracker, the sheet overlay's chip, and the
 * audience dialog's seeded state.
 *
 * Two sources, because there are two eras. Foundry's native `revealed` class in
 * the page body is where "everyone" lives now (setSectionRevealed below writes
 * it, core sheets and the player-safe export honour it). A legacy
 * `secretReveals.<id>.all === true` flag is what worlds written before that
 * change carry; it is never written true again, but is read here forever, so a
 * record the migration could not convert (its section deleted, its page
 * locked) keeps working instead of silently un-revealing.
 *
 * Every read site must go through this. When one of them read only the flag,
 * a natively-revealed secret showed as "None" on the sheet while the tracker
 * said "Everyone", and reopening the dialog to add one player seeded "Everyone"
 * unchecked - so applying it stripped the class and un-revealed the secret
 * from the whole table.
 *
 * Pure and Foundry-free: `record` is the raw stored audience object, not a
 * document.
 */
export function sectionRevealedAll(bodyHtml, sectionId, record) {
  return extractSecretBlocks(bodyHtml).some((s) => s.id === sectionId && s.revealedAll)
    || record?.all === true;
}

/** Replace an open tag's class attribute value, preserving its quote style. */
function withClasses(openTag, classes) {
  return openTag.replace(/(\sclass\s*=\s*)(["'])(.*?)\2/i, (match, prefix, quote) => `${prefix}${quote}${classes}${quote}`);
}

/**
 * Add or remove Foundry's native `revealed` class on ONE secret section.
 *
 * Native reveal state lives as a class inside the stored page HTML - it is
 * what `.secret:not(.revealed)` strips, what core sheets honour, and what the
 * player-safe export keys on (stripSecretSections above). This is the single
 * place that edits it, so both reveal surfaces (the per-block sheet button and
 * the Hub tracker, which may act with no sheet open and therefore no
 * <secret-block> element to call core's toggleRevealed on) share one
 * implementation.
 *
 * Total: returns the input unchanged for an empty body, a falsy id, a section
 * that isn't there, a non-secret section, or a state that already matches - so
 * a caller can always write back whatever it gets.
 *
 * Deliberately diverges from core's HTMLSecretBlockElement#toggleRevealed,
 * confirmed live (tests/e2e/09-secrets.spec.mjs): core rebuilds the section's
 * open tag from scratch on toggle, discarding any other classes/attributes it
 * carries - this function preserves them instead. Do not "fix" that to match
 * core; it would start destroying user content. (Core's replacement regex
 * also can't span an attribute containing the letter "i", so it silently
 * fails to toggle a body's second secret section - another divergence this
 * function does not reproduce.)
 */
export function setSectionRevealed(html, sectionId, revealed) {
  const src = String(html ?? "");
  if (!src || typeof sectionId !== "string" || !sectionId) return src;
  const want = revealed === true;
  // Function replacement, never a string: bodies are GM prose and String#replace
  // would expand `$&`/`$'` inside them as replacement patterns.
  return src.replace(SECTION_RE, (block) => {
    if (!isSecret(block)) return block;
    const close = block.indexOf(">") + 1;
    const openTag = block.slice(0, close);
    if (attr(openTag, "id") !== sectionId) return block;
    const classes = classesOf(block);
    if (classes.includes("revealed") === want) return block;
    const next = want ? [...classes, "revealed"] : classes.filter((c) => c !== "revealed");
    return withClasses(openTag, next.join(" ")) + block.slice(close);
  });
}
