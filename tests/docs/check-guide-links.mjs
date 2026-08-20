// tests/docs/check-guide-links.mjs — verifies guide images exist, no orphans,
// and intra-/cross-doc anchors resolve. Run: node tests/docs/check-guide-links.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { posix } from "node:path";

const DOCS = ["docs/gm-guide.md", "docs/player-guide.md", "README.md"];
const slug = (h) => h.toLowerCase().replace(/[^\w\- ]/g, "").trim().replace(/ /g, "-");
const anchors = {}, errors = [];
for (const f of DOCS) {
  const text = readFileSync(f, "utf8");
  anchors[f] = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
}
const referenced = new Set();
for (const f of DOCS) {
  const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
  for (const [, target] of readFileSync(f, "utf8").matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(target)) continue;
    const [path, anchor] = target.split("#");
    // Normalize so a relative link like "../README.md" from docs/gm-guide.md
    // resolves to the literal "README.md" key in `anchors`/DOCS, not the
    // unresolved string "docs/../README.md" (which would never match and
    // silently skip the anchor check below).
    const resolved = path ? posix.normalize(dir + path) : f;
    if (path && !existsSync(resolved)) { errors.push(`${f}: missing file ${target}`); continue; }
    if (path?.endsWith(".png")) referenced.add(resolved);
    if (anchor && anchors[resolved] && !anchors[resolved].has(anchor))
      errors.push(`${f}: dead anchor ${target}`);
  }
}
for (const img of readdirSync("docs/images"))
  if (img.endsWith(".png") && !referenced.has(`docs/images/${img}`)) errors.push(`orphan image docs/images/${img}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("guide links OK");
