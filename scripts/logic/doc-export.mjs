/**
 * Pure export logic: record snapshots -> intermediate doc model.
 * Node kinds: heading, paragraph, list, table, image (see tests).
 * No Foundry globals; DOM nodes and i18n are supplied by the caller.
 */

/** Foundry @UUID enrichers are meaningless outside the VTT: keep the label. */
export function replaceUuidTags(html) {
  return (html ?? "")
    .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "<strong>$1</strong>")
    .replace(/@UUID\[([^\]]+)\]/g, (_, uuid) => `<strong>${uuid.split(".").pop()}</strong>`);
}

const INLINE_FLAGS = { STRONG: "bold", B: "bold", EM: "italics", I: "italics",
  U: "underline", S: "strike", STRIKE: "strike", DEL: "strike" };

/** Flatten an element's inline content into styled runs. */
function collectRuns(el, flags = {}) {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { // text
      const text = node.textContent.replace(/\s+/g, " ");
      if (text) runs.push({ text, ...flags });
    } else if (node.nodeType === 1) {
      if (node.tagName === "BR") { runs.push({ text: "\n", ...flags }); continue; }
      const next = { ...flags };
      const flag = INLINE_FLAGS[node.tagName];
      if (flag) next[flag] = true;
      if (node.tagName === "A" && node.getAttribute("href")) next.link = node.getAttribute("href");
      runs.push(...collectRuns(node, next));
    }
  }
  return runs;
}

function trimRuns(runs) {
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  }
  return runs.filter((r) => r.text);
}

function listItems(listEl, level, out) {
  for (const li of listEl.children) {
    if (li.tagName !== "LI") continue;
    const clone = li.cloneNode(true);
    for (const nested of clone.querySelectorAll("ul, ol")) nested.remove();
    out.push({ runs: trimRuns(collectRuns(clone)), level });
    for (const nested of li.children) {
      if (nested.tagName === "UL" || nested.tagName === "OL") listItems(nested, level + 1, out);
    }
  }
}

/** Convert a parsed HTML body into doc-model nodes. */
export function htmlToNodes(root, flags = {}) {
  const nodes = [];
  for (const el of root.children) {
    const heading = el.tagName.match(/^H([1-6])$/);
    if (heading) {
      const text = el.textContent.trim();
      if (text) nodes.push({ kind: "heading", level: Number(heading[1]), text });
    } else if (el.tagName === "P" || el.tagName === "PRE") {
      const runs = trimRuns(collectRuns(el, flags));
      // Intra-paragraph image position is not preserved: the paragraph's text
      // runs are emitted first, then one image node per <img> in document order.
      if (runs.length) nodes.push({ kind: "paragraph", runs });
      for (const img of el.querySelectorAll("img[src]")) {
        nodes.push({ kind: "image", src: img.getAttribute("src"), caption: img.getAttribute("alt") ?? "" });
      }
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      // Known limitation: nested lists flatten under the OUTER list's ordered
      // flag — a nested <ol> inside a <ul> loses its orderedness (and vice versa).
      const items = [];
      listItems(el, 0, items);
      if (items.length) nodes.push({ kind: "list", ordered: el.tagName === "OL", items });
    } else if (el.tagName === "TABLE") {
      const rows = [...el.querySelectorAll("tr")].map((tr) =>
        [...tr.children].filter((c) => /^T[HD]$/.test(c.tagName))
          .map((cell) => trimRuns(collectRuns(cell))));
      if (rows.length) nodes.push({ kind: "table", rows });
    } else if (el.tagName === "IMG" && el.getAttribute("src")) {
      nodes.push({ kind: "image", src: el.getAttribute("src"), caption: el.getAttribute("alt") ?? "" });
    } else if (el.tagName === "BLOCKQUOTE") {
      nodes.push(...htmlToNodes(el, { ...flags, italics: true }));
    } else if (el.children.length) { // div and other wrappers: recurse
      nodes.push(...htmlToNodes(el, flags));
    } else {
      const runs = trimRuns(collectRuns(el, flags));
      if (runs.length) nodes.push({ kind: "paragraph", runs });
    }
  }
  return nodes;
}

const label = (name, value, extraRuns = []) => ({
  kind: "paragraph", style: "label",
  runs: [{ text: `${name}: `, bold: true }, { text: String(value) }, ...extraRuns]
});

const labelIf = (name, value) => (value ? [label(name, value)] : []);

const checkItem = (text, done, prefixRuns = []) =>
  ({ runs: [...prefixRuns, { text: `[${done ? "x" : " "}] ${text}` }], level: 0 });

/** Per-kind structured-field renderers: (system, ctx) -> Node[]. */
const FIELD_RENDERERS = {
  npc: (s, { i18n }) => [
    ...labelIf("Role", s.role), ...labelIf("Location", s.location),
    ...labelIf("Race", s.race), ...labelIf("Gender", s.gender),
    ...labelIf("Profession", s.profession), ...labelIf("Voice", s.voice),
    ...labelIf("Faction", s.faction),
    ...labelIf("Status", s.status && i18n(`CAMPAIGNRECORD.Npc.Status.${s.status}`))
  ],
  place: (s, { i18n }) => [
    ...labelIf("Location", s.location), ...labelIf("Government", s.government),
    ...labelIf("Size", s.size),
    ...labelIf("Type", s.placeType && i18n(`CAMPAIGNRECORD.Place.Type.${s.placeType}`))
  ],
  quest: (s, ctx) => {
    const objectives = (s.objectives ?? []).filter((o) => ctx.includeGM || !o.gmOnly);
    return [
      ...labelIf("Source", s.source),
      ...labelIf("Status", s.status && ctx.i18n(`CAMPAIGNRECORD.Quest.Status.${s.status}`)),
      ...(objectives.length ? [{
        kind: "list", ordered: false,
        items: objectives.map((o) =>
          checkItem(o.text, o.done, o.gmOnly ? [{ text: "(GM) ", bold: true }] : []))
      }] : []),
      ...(s.rewards ? [label("Rewards", ""), ...htmlBody(s.rewards, ctx)] : [])
    ];
  },
  pc: (s) => [
    ...labelIf("Player", s.playerName), ...labelIf("Class & Level", s.classLevel),
    ...labelIf("Faction", s.faction)
  ],
  item: (s) => [
    ...labelIf("Type", s.itemType), ...labelIf("Rarity", s.rarity),
    ...labelIf("Attunement", s.attunement)
  ],
  encounter: (s) => [
    ...labelIf("Location", s.location), ...labelIf("Difficulty", s.difficulty),
    ...labelIf("Outcome", s.outcome),
    ...((s.combatants ?? []).length ? [{
      kind: "list", ordered: false,
      items: s.combatants.map((c) => ({ runs: [{ text: `${c.count}× ${c.name}` }], level: 0 }))
    }] : [])
  ],
  checklist: (s) => ((s.items ?? []).length ? [{
    kind: "list", ordered: false,
    items: s.items.map((it) =>
      checkItem(it.assignee ? `${it.text} — ${it.assignee}` : it.text, it.done))
  }] : []),
  shop: (s) => [
    ...labelIf("Type", s.shopType), ...labelIf("Location", s.location),
    ...labelIf("Owner", s.owner),
    ...((s.inventory ?? []).length ? [{
      kind: "table",
      rows: [
        [[{ text: "Name", bold: true }], [{ text: "Price", bold: true }], [{ text: "Qty", bold: true }]],
        ...s.inventory.map((r) => [[{ text: r.name }], [{ text: r.price }], [{ text: String(r.quantity) }]])
      ]
    }] : [])
  ],
  loot: (s, ctx) => {
    const coins = ["pp", "gp", "ep", "sp", "cp"]
      .filter((c) => s.currency?.[c]).map((c) => `${s.currency[c]} ${c}`).join(", ");
    return [
      ...labelIf("Currency", coins),
      ...((s.items ?? []).length ? [{
        kind: "table",
        rows: [
          [[{ text: "Name", bold: true }], [{ text: "Qty", bold: true }]],
          ...s.items.map((r) => [[{ text: r.name }], [{ text: String(r.quantity) }]])
        ]
      }] : []),
      ...(s.distribution ? htmlBody(s.distribution, ctx) : [])
    ];
  },
  media: (s) => (s.images ?? []).map((img) => ({ kind: "image", src: img.src, caption: img.caption ?? "" }))
};

function htmlBody(html, { parse }) {
  if (!html) return [];
  return htmlToNodes(parse(replaceUuidTags(html)));
}

/**
 * Build the full doc model for an export snapshot. GM-only content (hidden
 * records, gmNotes, gmOnly objectives) is included only with opts.includeGM.
 */
export function snapshotToDocModel(snapshot, opts) {
  const nodes = [{ kind: "heading", level: 1, text: snapshot.name }];

  if (snapshot.timeline?.length) {
    nodes.push({ kind: "heading", level: 2, text: opts.i18n("CAMPAIGNRECORD.Export.Timeline") });
    for (const tp of snapshot.timeline) {
      nodes.push({ kind: "heading", level: 3, text: tp.label });
      if (tp.items.length) {
        nodes.push({ kind: "list", ordered: false,
          items: tp.items.map((name) => ({ runs: [{ text: name }], level: 0 })) });
      }
    }
  }

  for (const record of snapshot.records) {
    if (record.hidden && !opts.includeGM) continue;
    nodes.push({ kind: "heading", level: 1, text: record.name });
    if (record.kind !== "text") {
      nodes.push({ kind: "paragraph", style: "subtitle",
        runs: [{ text: `Campaign Record type: ${record.kind}` }] });
      const tags = [...(record.system?.tags ?? [])];
      nodes.push(...(FIELD_RENDERERS[record.kind]?.(record.system, opts) ?? []));
      if (tags.length) nodes.push(label("Tags", tags.join(", ")));
    }
    nodes.push(...htmlBody(record.html, opts));
    if (opts.includeGM && record.system?.gmNotes) {
      nodes.push({ kind: "heading", level: 3, text: opts.i18n("CAMPAIGNRECORD.Export.GmNotes") });
      nodes.push(...htmlBody(record.system.gmNotes, opts));
    }
  }
  return nodes;
}
