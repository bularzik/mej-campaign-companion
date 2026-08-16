// Relationship graph (spec §5): standalone ApplicationV2, vendored d3-force
// layout, self-rendered SVG. Read-only visualization - relationships stay
// edited on MEJ sheets. All rows are pre-filtered to what the current user
// can observe (spec §2's gate); relationships are additionally pre-filtered
// per-viewer via visibleRelRows (Phase C, spec §6) so hidden/secret rows
// never reach buildGraph unless this viewer can see them. A hidden row that
// was individually row-revealed to this viewer (visibleRelRows's
// rowRevealedToUser) survives that filter and is passed through as
// revealedToViewer: true, so buildGraph's `rel.hidden && !isGM` gate lets it
// through for its beneficiary - `hidden: true` is kept regardless, so the
// beneficiary still sees the dashed edge style.
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { buildGraph } from "../logic/graph-data.mjs";
import { visibleRelRows } from "../logic/rel-reveals.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { backlinkPairs } from "../search/live-index.mjs";
import * as d3 from "../../vendor/d3-force.esm.js";

const MEJ_FLAGS = "monks-enhanced-journal";
const MAX_NODES = 200;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Edge label text: the free-text relationship label plus the secret label
 * when one is visible to the current viewer. `secretText` is `null` when
 * visibleRelRows withheld it (unrevealed, non-GM viewer) - `combineLabel`
 * naturally drops it in that case, so this same call covers both the GM
 * ("label and secretText joined when both exist") and player ("label, plus
 * secretText only when returned non-null") visibility rules.
 */
function combineLabel(label, secretText) {
  return [label, secretText].filter((s) => typeof s === "string" && s.length).join(" / ");
}

/** One row per visible MEJ-typed entry (single-page convention: first MEJ-typed page). */
function graphRows() {
  const rows = [];
  const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
  for (const entry of game.journal?.contents ?? []) {
    if (!game.user.isGM && entry.testUserPermission(game.user, "OBSERVER") !== true) continue;
    for (const page of entry.pages?.contents ?? []) {
      const type = game.MonksEnhancedJournal.getMEJType(page);
      if (!type) continue;
      const relationships = visibleRelRows(
        page.flags?.[MEJ_FLAGS]?.relationships,
        entry.getFlag(MODULE_ID, "relReveals") ?? {},
        { userId: game.user.id, groups, isGM: game.user.isGM }
      ).map((r) => ({ id: r.id, uuid: r.uuid, hidden: r.hidden, revealedToViewer: r.rowRevealedToUser, label: combineLabel(r.label, r.secretText) }));
      rows.push({ uuid: entry.uuid, name: entry.name, type, relationships });
      break;
    }
  }
  return rows;
}

/** Deterministic per-type hue so nodes of one type share a color. */
function typeHue(type) {
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export class RelationshipGraphApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mej-cc-graph",
    classes: ["mej-cc-graph-app"],
    window: { title: `${I18N}.graph.title`, icon: "fa-solid fa-circle-nodes", resizable: true },
    position: { width: 820, height: 620 },
    actions: { setMode: RelationshipGraphApp.onSetMode }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/graph.hbs` }
  };

  #centerUuid;
  #mode;
  #includeBacklinks = false;
  #sim = null;
  #graph = null;
  #dragged = false;

  constructor({ centerUuid = null } = {}) {
    super();
    this.#centerUuid = centerUuid;
    this.#mode = centerUuid ? "ego" : "all";
  }

  // Computes the graph (and thus the truncation verdict) here rather than in
  // #draw(), and caches it on #graph for #draw() to reuse. _prepareContext
  // always runs before _onRender/#draw within the same render() pass, so
  // this keeps the truncated-notice in the template context and the actual
  // drawn graph perfectly in sync for that pass - computing it only in
  // #draw() (the original shape) meant the template read #lastTruncated from
  // the *previous* draw, one render stale.
  async _prepareContext() {
    this.#graph = buildGraph(graphRows(), this.#includeBacklinks ? backlinkPairs() : [], {
      mode: this.#mode, centerUuid: this.#centerUuid,
      includeBacklinks: this.#includeBacklinks, isGM: game.user.isGM, maxNodes: MAX_NODES
    });
    return {
      isEgo: this.#mode === "ego",
      centerUuid: this.#centerUuid,
      includeBacklinks: this.#includeBacklinks,
      truncated: this.#graph.truncated === true
    };
  }

  static onSetMode(event, target) {
    const mode = target.dataset.mode;
    if (!["ego", "all"].includes(mode)) return;
    this.#mode = mode;
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const checkbox = this.element.querySelector('[data-action-change="toggleBacklinks"]');
    checkbox?.addEventListener("change", () => {
      this.#includeBacklinks = checkbox.checked;
      this.render();
    });
    this.#draw();
  }

  _onClose(options) {
    this.#sim?.stop();
    this.#sim = null;
    super._onClose?.(options);
  }

  #draw() {
    const svg = this.element.querySelector(".mej-cc-graph-svg");
    if (!svg) return;
    svg.replaceChildren();
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 540;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Reuse the graph computed in _prepareContext for this same render pass
    // (see its comment) rather than recomputing it here - keeps the drawn
    // graph and the truncated-notice in the template context in sync.
    const graph = this.#graph;

    const NS = "http://www.w3.org/2000/svg";
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.edges.map((e) => ({ ...e, source: e.source, target: e.target }));

    const edgeEls = links.map((link) => {
      const line = document.createElementNS(NS, "line");
      line.classList.add("mej-cc-graph-edge", link.kind);
      if (link.hidden) line.classList.add("hidden-rel");
      svg.append(line);
      return line;
    });
    const edgeLabelEls = links.map((link) => {
      if (!link.label) return null;
      const text = document.createElementNS(NS, "text");
      text.classList.add("mej-cc-graph-edge-label");
      text.textContent = link.label;
      svg.append(text);
      return text;
    });
    const nodeEls = nodes.map((node) => {
      const g = document.createElementNS(NS, "g");
      g.classList.add("mej-cc-graph-node");
      if (node.uuid === this.#centerUuid) g.classList.add("center");
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("r", "10");
      circle.style.fill = `hsl(${typeHue(node.type)} 55% 45%)`;
      const label = document.createElementNS(NS, "text");
      label.setAttribute("dy", "22");
      label.textContent = node.name;
      g.append(circle, label);
      g.addEventListener("click", async () => {
        if (this.#dragged) return;
        const entry = await fromUuid(node.uuid);
        if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
      });
      this.#bindDrag(g, node);
      svg.append(g);
      return g;
    });

    this.#sim?.stop();
    this.#sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.uuid).distance(90))
      .force("charge", d3.forceManyBody().strength(-220))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(26))
      .on("tick", () => {
        links.forEach((link, i) => {
          edgeEls[i].setAttribute("x1", link.source.x);
          edgeEls[i].setAttribute("y1", link.source.y);
          edgeEls[i].setAttribute("x2", link.target.x);
          edgeEls[i].setAttribute("y2", link.target.y);
          const labelEl = edgeLabelEls[i];
          if (labelEl) {
            labelEl.setAttribute("x", (link.source.x + link.target.x) / 2);
            labelEl.setAttribute("y", (link.source.y + link.target.y) / 2 - 4);
          }
        });
        nodes.forEach((node, i) => {
          nodeEls[i].setAttribute("transform", `translate(${node.x},${node.y})`);
        });
      });

    // Wheel zoom: scale the viewBox around its center.
    if (!svg.dataset.ccZoomBound) {
      svg.dataset.ccZoomBound = "1";
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
        const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
        const nw = Math.min(Math.max(w * factor, 200), 8000);
        const nh = nw * (h / w);
        svg.setAttribute("viewBox", `${x + (w - nw) / 2} ${y + (h - nh) / 2} ${nw} ${nh}`);
      }, { passive: false });
    }
  }

  /** Drag to pin (sets fx/fy, per the d3-force convention). */
  #bindDrag(g, node) {
    g.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      this.#dragged = false;
      const svg = g.ownerSVGElement;
      const toSvg = (event) => {
        const point = new DOMPoint(event.clientX, event.clientY);
        return point.matrixTransform(svg.getScreenCTM().inverse());
      };
      const move = (event) => {
        if (!this.#sim) return;
        this.#dragged = true;
        const p = toSvg(event);
        node.fx = p.x;
        node.fy = p.y;
        this.#sim.alphaTarget(0.3).restart();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.#sim.alphaTarget(0);
        setTimeout(() => { this.#dragged = false; }, 0); // let click see the flag
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }
}

export async function openGraph({ centerUuid = null } = {}) {
  new RelationshipGraphApp({ centerUuid }).render(true);
}
