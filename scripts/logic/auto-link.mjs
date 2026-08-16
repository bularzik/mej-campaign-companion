// scripts/logic/auto-link.mjs

/**
 * Split HTML into ordered, lossless segments. Only "text" segments are scanned
 * for name mentions; "tag", "link" (existing @UUID shorthand or <a> anchor), and
 * "code" segments are opaque passthrough so we never nest or double-link.
 */
export function tokenizeHtml(html) {
  const specials = [
    { type: "link", re: /@UUID\[[^\]]*\]\{[^}]*\}/y },
    { type: "link", re: /<a\b[^>]*>[\s\S]*?<\/a>/iy },
    { type: "code", re: /<code\b[^>]*>[\s\S]*?<\/code>/iy },
    { type: "code", re: /<pre\b[^>]*>[\s\S]*?<\/pre>/iy },
    { type: "tag", re: /<[^>]+>/y }
  ];
  const segs = [];
  let i = 0;
  let textStart = 0;
  while (i < html.length) {
    let hit = null;
    for (const s of specials) {
      s.re.lastIndex = i;
      const m = s.re.exec(html);
      if (m && m.index === i) {
        hit = { type: s.type, raw: m[0] };
        break;
      }
    }
    if (hit) {
      if (i > textStart) segs.push({ type: "text", raw: html.slice(textStart, i) });
      segs.push(hit);
      i += hit.raw.length;
      textStart = i;
    } else {
      i++;
    }
  }
  if (i > textStart) segs.push({ type: "text", raw: html.slice(textStart) });
  return segs;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Ordered visible words from "text" segments, with their in-segment offsets. */
export function extractWords(segs) {
  const words = [];
  segs.forEach((seg, segIndex) => {
    if (seg.type !== "text") return;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(seg.raw))) {
      words.push({ text: m[0], segIndex, start: m.index, end: m.index + m[0].length });
    }
  });
  return words;
}

/**
 * LCS alignment of lowercased words. Returns a boolean per newWord: true when it
 * is not part of the longest common subsequence with baseWords (i.e. inserted).
 */
export function diffAddedWordFlags(baseWords, newWords) {
  const a = baseWords.map((w) => w.toLowerCase());
  const b = newWords.map((w) => w.toLowerCase());
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = new Array(m).fill(true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      added[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return added;
}

/**
 * Wrap newly-added mentions of candidate names as @UUID content links.
 * `candidates` must be pre-sorted longest-name-first; each match claims its
 * words so shorter/overlapping names can't double-link the same text.
 */
export function autoLinkAdded(baselineHtml, newHtml, candidates) {
  if (!candidates?.length) return newHtml;
  const segs = tokenizeHtml(newHtml);
  const newWords = extractWords(segs);
  if (!newWords.length) return newHtml;
  const added = diffAddedWordFlags(
    extractWords(tokenizeHtml(baselineHtml)).map((w) => w.text),
    newWords.map((w) => w.text)
  );

  const claimed = new Array(newWords.length).fill(false);
  const edits = [];
  for (const c of candidates) {
    const parts = c.name.trim().split(/\s+/).map((p) => p.toLowerCase()).filter(Boolean);
    if (!parts.length) continue;
    for (let k = 0; k + parts.length <= newWords.length; k++) {
      let ok = true;
      for (let p = 0; p < parts.length; p++) {
        const w = newWords[k + p];
        if (
          claimed[k + p] ||
          !added[k + p] ||
          w.segIndex !== newWords[k].segIndex ||
          w.text.toLowerCase() !== parts[p]
        ) {
          ok = false;
          break;
        }
        // For multi-word names, the characters strictly between the previous
        // matched word and this one must be whitespace-only — otherwise a name
        // whose words straddle a sentence/clause break would be falsely matched.
        if (p > 0) {
          const gap = segs[w.segIndex].raw.slice(newWords[k + p - 1].end, w.start);
          if (!/^\s*$/.test(gap)) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      const first = newWords[k];
      const last = newWords[k + parts.length - 1];
      edits.push({
        segIndex: first.segIndex,
        start: first.start,
        end: last.end,
        uuid: c.uuid,
        label: segs[first.segIndex].raw.slice(first.start, last.end)
      });
      for (let p = 0; p < parts.length; p++) claimed[k + p] = true;
    }
  }
  if (!edits.length) return newHtml;

  const bySeg = new Map();
  for (const e of edits) {
    if (!bySeg.has(e.segIndex)) bySeg.set(e.segIndex, []);
    bySeg.get(e.segIndex).push(e);
  }
  for (const [segIndex, list] of bySeg) {
    list.sort((x, y) => y.start - x.start); // right-to-left keeps offsets valid
    let raw = segs[segIndex].raw;
    for (const e of list) {
      raw = raw.slice(0, e.start) + `@UUID[${e.uuid}]{${e.label}}` + raw.slice(e.end);
    }
    segs[segIndex].raw = raw;
  }
  return segs.map((s) => s.raw).join("");
}
