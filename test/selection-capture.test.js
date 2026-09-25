// @vitest-environment jsdom
// test/selection-capture.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { captureSelection } from "../scripts/logic/selection-capture.mjs";

let root;
beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  root.className = "editor-display";
  document.body.append(root);
});

/** Select [start,end) of the nth text node (document order) whose data contains `probe`. */
function select(probe, nth, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node, seen = 0;
  while ((node = walker.nextNode())) {
    if (node.data.includes(probe) && seen++ === nth) break;
  }
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return sel;
}

describe("captureSelection", () => {
  it("captures the second occurrence with its total", () => {
    root.innerHTML = "<p>Elara met Elara.</p><p>Then Elara left.</p>";
    const sel = select("Elara met", 0, 10, 15);
    expect(captureSelection(root, sel)).toEqual({ text: "Elara", occurrence: 1, total: 3 });
  });
  it("trims whitespace around the selection and counts from the trimmed start", () => {
    root.innerHTML = "<p>Elara  Elara</p>";
    const sel = select("Elara", 0, 5, 12);
    expect(captureSelection(root, sel)).toEqual({ text: "Elara", occurrence: 1, total: 2 });
  });
  it("ignores text in links, code, pre and inline rolls for counting", () => {
    root.innerHTML = '<p><a class="content-link">Elara</a> <code>Elara</code> <a class="inline-roll">Elara</a> <span class="inline-roll">Elara</span> Elara</p><pre>Elara</pre>';
    const sel = select("Elara", 4, 1, 6);   // the 5th node is " Elara"
    expect(captureSelection(root, sel)).toEqual({ text: "Elara", occurrence: 0, total: 1 });
  });
  it("returns null inside a link, across nodes, outside the root, collapsed, or too long", () => {
    root.innerHTML = '<p><a>Elara</a> Elara <em>Moon</em></p>';
    expect(captureSelection(root, select("Elara", 0, 0, 5))).toBeNull();
    const r = document.createRange();
    const p = root.querySelector("p");
    r.setStart(p.childNodes[1], 1);
    r.setEnd(p.querySelector("em").firstChild, 2);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    expect(captureSelection(root, sel)).toBeNull();
    const outside = document.createElement("p"); outside.textContent = "Elara"; document.body.append(outside);
    const r2 = document.createRange(); r2.setStart(outside.firstChild, 0); r2.setEnd(outside.firstChild, 5);
    sel.removeAllRanges(); sel.addRange(r2);
    expect(captureSelection(root, sel)).toBeNull();
    expect(captureSelection(root, select("Elara", 1, 3, 3))).toBeNull();
    root.innerHTML = `<p>${"a".repeat(90)}</p>`;
    expect(captureSelection(root, select("a", 0, 0, 90))).toBeNull();
  });
  it("returns null for a null selection or no ranges", () => {
    expect(captureSelection(root, null)).toBeNull();
    window.getSelection().removeAllRanges();
    expect(captureSelection(root, window.getSelection())).toBeNull();
  });
});
