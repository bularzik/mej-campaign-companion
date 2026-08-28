// Graph pane for the Hub's Graph tab (spec B §2). Relocated from the
// retired standalone RelationshipGraphApp (apps/graph-app.mjs): same
// d3-force simulation, SVG rendering, drag-to-pin, wheel zoom, node-click-
// opens-entry, 200-node cap. What changed: rows come from the CALLER's
// (scoped) entry list via logic/graph-rows.mjs instead of walking all of
// game.journal, and pane state lives in the Hub's HUB_STATE.
import { MODULE_ID, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { buildGraph } from "../logic/graph-data.mjs";
import { graphRowsFor, nodeImage } from "../logic/graph-rows.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { backlinkPairs } from "../search/live-index.mjs";
import * as d3 from "../../vendor/d3-force.esm.js";
import { mejType } from "../integrations/mej-adapter.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";
const MAX_NODES = 200;
const NODE_R = 14;
const MEJ_ASSET_PATH = "modules/monks-enhanced-journal/assets";
// MEJ ships a placeholder PNG only for its built-in types (assets/<type>.png).
// Other types mejType() can return — "session" (ours), "picture", externally
// registered types — have none, so synthesizing the path would 404 on every
// node on every redraw; those nodes keep the plain ring instead.
const MEJ_ASSET_TYPES = new Set([
  "person", "place", "poi", "quest", "encounter", "event",
  "organization", "shop", "loot", "list", "slideshow", "journalentry"
]);

let activeSim = null;
// Cleanup for a drag still in flight, if any (C9). A pointerdown installs
// window-level listeners that outlive the node they started on, so a redraw
// arriving mid-drag has to release them - see drawGraphPane's first line.
let releaseDrag = null;

/** Compute the scoped graph + the template context for the pane. */
export function prepareGraphContext(entries, state) {
  const rows = graphRowsFor(entries, {
    isGM: game.user.isGM,
    userId: game.user.id,
    groups: normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
    getType: (page) => mejType(page),
    canObserve: (entry) => entry.testUserPermission(game.user, "OBSERVER") === true,
    relRevealsOf: (entry) => entry.getFlag(MODULE_ID, "relReveals"),
    relationshipsOf: (page) => page.flags?.[MEJ_FLAGS]?.relationships,
    // Entity picture is the typed page's src (MEJ's own convention, see
    // EnhancedJournalSheet relationship rendering); MEJ's generic per-type
    // placeholder otherwise, but only for the built-in types MEJ_ASSET_TYPES
    // ships an asset for — other typed nodes keep the plain ring.
    imageOf: (page, type) => nodeImage(page.src, type, MEJ_ASSET_TYPES, MEJ_ASSET_PATH)
  });
  const graph = buildGraph(rows, state.graphBacklinks ? backlinkPairs() : [], {
    mode: state.graphMode, centerUuid: state.graphCenterUuid,
    includeBacklinks: state.graphBacklinks, isGM: game.user.isGM, maxNodes: MAX_NODES
  });
  return {
    graph,
    context: {
      isEgo: state.graphMode === "ego",
      centerUuid: state.graphCenterUuid,
      includeBacklinks: state.graphBacklinks,
      truncated: graph.truncated === true
    }
  };
}

/** Deterministic per-type hue so nodes of one type share a color. */
function typeHue(type) {
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Draw the graph into `svg` (replacing its contents), wiring drag/zoom/click. */
export function drawGraphPane(svg, graph, { centerUuid, onOpen }) {
  if (!svg) return;
  // A drag in flight belongs to the graph we are about to discard: end it
  // before its node elements are detached (C9).
  releaseDrag?.();
  svg.replaceChildren();
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 540;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Reuse the popup's single dragged flag: only one node can be dragged at
  // a time, so this is shared across every node's click handler and drag
  // binding (see the click handler and bindDrag below).
  let dragged = false;

  // THIS draw's simulation, not the module-global one (C9). The handlers below
  // are installed before the simulation exists (bindDrag runs while building
  // nodes, forceSimulation is created after), so they cannot capture it by
  // value - but reading the module global instead meant a drag that outlived a
  // redraw drove the NEW graph's simulation using the OLD graph's node
  // objects. A per-draw holder keeps each drag bound to the graph it started
  // on; once that graph is replaced, the drag can only perturb the simulation
  // that is already stopped and detached.
  const sim = { current: null };

  /** Drag to pin (sets fx/fy, per the d3-force convention). */
  function bindDrag(g, node) {
    g.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      dragged = false;
      const svg = g.ownerSVGElement;
      const toSvg = (event) => {
        const point = new DOMPoint(event.clientX, event.clientY);
        return point.matrixTransform(svg.getScreenCTM().inverse());
      };
      const move = (event) => {
        if (!sim.current) return;
        dragged = true;
        const p = toSvg(event);
        node.fx = p.x;
        node.fy = p.y;
        sim.current.alphaTarget(0.3).restart();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (releaseDrag === up) releaseDrag = null;
        // Optional-chained to match `move`'s own guard above. The asymmetry
        // between the two - move guarded, up not - was the original defect:
        // whatever can leave the simulation absent for one can leave it
        // absent for the other.
        sim.current?.alphaTarget(0);
        setTimeout(() => { dragged = false; }, 0); // let click see the flag
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      releaseDrag = up;
    });
  }

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
  const clipNonce = Math.random().toString(36).slice(2, 8);
  const nodeEls = nodes.map((node, i) => {
    const g = document.createElementNS(NS, "g");
    g.classList.add("mej-cc-graph-node");
    if (node.uuid === centerUuid) g.classList.add("center");
    // Ring: type-hued fill (visible only when there is no image or it fails
    // to load), border stroke and ego-center stroke come from CSS.
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("r", String(NODE_R));
    circle.style.fill = `hsl(${typeHue(node.type)} 55% 45%)`;
    const label = document.createElementNS(NS, "text");
    label.setAttribute("dy", String(NODE_R + 12));
    label.textContent = node.name;
    g.append(circle);
    if (node.img) {
      // Cover-fit the picture into the ring: clip to the circle, "slice"
      // fills and crops rather than squashing. Ids carry a per-draw nonce
      // because url(#id) resolves document-wide and two Hub windows may be
      // open at once. A failed load removes the image, leaving the ring.
      const clipId = `mej-cc-clip-${clipNonce}-${i}`;
      const clip = document.createElementNS(NS, "clipPath");
      clip.setAttribute("id", clipId);
      const clipCircle = document.createElementNS(NS, "circle");
      clipCircle.setAttribute("r", String(NODE_R));
      clip.append(clipCircle);
      const image = document.createElementNS(NS, "image");
      image.setAttribute("href", node.img);
      image.setAttribute("x", String(-NODE_R));
      image.setAttribute("y", String(-NODE_R));
      image.setAttribute("width", String(NODE_R * 2));
      image.setAttribute("height", String(NODE_R * 2));
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      image.setAttribute("clip-path", `url(#${clipId})`);
      image.addEventListener("error", () => image.remove());
      g.append(clip, image);
    }
    g.append(label);
    g.addEventListener("click", () => {
      if (dragged) return;
      onOpen(node.uuid);
    });
    bindDrag(g, node);
    svg.append(g);
    return g;
  });

  activeSim?.stop();
  activeSim = sim.current = d3.forceSimulation(nodes)
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
