// WCAG text-contrast scan for the readability guard (29-readability).
//
// scanContrast(page, rootSelector) walks every visible element under the
// root that renders its own text (a non-blank direct text node, or a form
// control showing a value) and returns those whose contrast against their
// effective background falls below WCAG AA: 4.5:1, or 3:1 for large text
// (>= 24px, or >= 18.66px at weight >= 700). The ratio itself comes from
// scripts/logic/contrast.mjs, imported in the page.
//
// The effective background composites ancestor background-colors upward
// until the stack is opaque. An ancestor with a url() background image
// (MEJ's parchment) is resolved to the average of its pixels, the same rule
// as 13-stock-smoke's textContrast: the image paints over that element's
// colour, so it ends the climb. Results carry bgSource "image" then.
//
// Disabled controls and placeholder text are exempt (WCAG 1.4.3 exempts
// inactive components; placeholders are hints, not content).

const CONTRAST = "/modules/mej-campaign-companion/scripts/logic/contrast.mjs";

/** Runs in the browser. Kept free of closures over Node scope. */
async function scanInPage({ rootSelector, contrastPath }) {
  const { contrastRatio } = await import(contrastPath);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  // Normalise any CSS colour (rgb, oklch, color-mix, named) to [r,g,b,a].
  const parse = (css) => {
    if (cache.has(css)) return cache.get(css);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out = [r, g, b, a / 255];
    cache.set(css, out);
    return out;
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    const ch = (i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
    return [ch(0), ch(1), ch(2), a];
  };
  const rgb = ([r, g, b]) => ({ r, g, b });
  const hex = ([r, g, b]) => "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

  const images = new Map();
  const averageImage = (url) => {
    if (!images.has(url)) images.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = Math.min(img.naturalWidth, 64);
          c.height = Math.min(img.naturalHeight, 64);
          const x = c.getContext("2d");
          x.drawImage(img, 0, 0, c.width, c.height);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1;
          }
          resolve(n ? [r / n, g / n, b / n, 1] : null);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }));
    return images.get(url);
  };

  // Background behind `el`: composite translucent layers bottom-up.
  const background = async (el) => {
    const layers = [];
    let source = "color";
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const url = /^url\("?(.+?)"?\)$/.exec(cs.backgroundImage)?.[1];
      const avg = url ? await averageImage(url) : null;
      if (avg) { layers.push(avg); source = "image"; break; }
      const color = parse(cs.backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 1) break;
    }
    // Nothing opaque below: app windows always paint their own surface, so
    // a stray floating element is measured against white.
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg, source };
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) o *= Number(getComputedStyle(node).opacity);
    return o;
  };
  const ownText = (el) => {
    if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]), select, textarea")) {
      return el.matches("select") ? el.selectedOptions?.[0]?.textContent?.trim() ?? "" : String(el.value ?? "").trim();
    }
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };

  const roots = [...document.querySelectorAll(rootSelector)];
  const failures = [];
  let checked = 0;
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (el.closest("svg") && !(el instanceof SVGTextElement)) continue;
      if (el.matches(":disabled, option, script, style, template")) continue;
      const text = ownText(el);
      if (!text) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const cs = getComputedStyle(el);
      const svg = el instanceof SVGTextElement;
      const fg = parse(svg ? cs.fill : cs.color);
      const { bg, source } = await background(el);
      const fgEff = over([fg[0], fg[1], fg[2], fg[3] * opacityOf(el)], bg);
      const r = contrastRatio(rgb(fgEff), rgb(bg));
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const min = large ? 3 : 4.5;
      checked++;
      if (r + 1e-6 >= min) continue;
      const path = [];
      for (let n = el; n && n !== root.parentElement && path.length < 5; n = n.parentElement) {
        const cls = [...n.classList].slice(0, 3).map((c) => "." + c).join("");
        path.unshift(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + cls);
      }
      failures.push({
        text: text.slice(0, 40), selector: path.join(" > "),
        fg: hex(fgEff), bg: hex(bg), bgSource: source,
        ratio: Math.round(r * 100) / 100, min, fontSize: size
      });
    }
  }
  return { roots: roots.length, checked, failures };
}

export async function scanContrast(page, rootSelector) {
  return page.evaluate(scanInPage, { rootSelector, contrastPath: CONTRAST });
}

/** One line per failure, for test output and assertion messages. */
export function formatFailures(label, failures) {
  return failures.map((f) =>
    `[${label}] ${f.ratio}:1 < ${f.min}  "${f.text}"  ${f.fg} on ${f.bg}${f.bgSource === "image" ? " (image bg)" : ""}  ${f.selector}`
  ).join("\n");
}
