// scripts/logic/selection-capture.mjs
// Turns the live DOM selection in a rendered MEJ editor into the
// serialisable { text, occurrence, total } that linkSelectionInSource
// replays against the stored HTML. DOM only, no Foundry globals.
// INELIGIBLE_SELECTOR mirrors what the source side treats as opaque:
// <a> (content links, @UUID) and inline rolls ([[...]]), code, pre.
import { qualifySelection, countOccurrences } from "./entity-from-selection.mjs";

export const INELIGIBLE_SELECTOR = "a, code, pre, .inline-roll";

function eligibleTextNodes(root) {
  const nodes = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.parentElement?.closest(INELIGIBLE_SELECTOR) || !root.contains(n.parentElement.closest(INELIGIBLE_SELECTOR))) {
      nodes.push(n);
    }
  }
  return nodes;
}

export function captureSelection(displayEl, selection) {
  if (!displayEl || !selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  const node = range.startContainer;
  if (node !== range.endContainer || node.nodeType !== 3 || !displayEl.contains(node)) return null;
  const raw = node.data.slice(range.startOffset, range.endOffset);
  const text = qualifySelection(raw);
  if (!text) return null;
  const nodes = eligibleTextNodes(displayEl);
  const at = nodes.indexOf(node);
  if (at === -1) return null;
  const trimmedStart = range.startOffset + (raw.length - raw.trimStart().length);
  let occurrence = countOccurrences(node.data.slice(0, trimmedStart), text);
  for (let i = 0; i < at; i++) occurrence += countOccurrences(nodes[i].data, text);
  const total = nodes.reduce((sum, n) => sum + countOccurrences(n.data, text), 0);
  return { text, occurrence, total };
}
