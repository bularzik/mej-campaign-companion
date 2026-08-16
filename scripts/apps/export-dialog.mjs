// Adapted from campaign-record's scripts/apps/export-dialog.mjs. Structured
// like this module's own import-wizard.mjs (Task 11): campaign-record
// exports one shared "group" JournalEntry at a time; this companion has no
// such container, so the dialog here instead offers every MEJ-typed +
// session entry as a checkbox list (default: all checked, ordered by
// doc-export-snapshot.mjs's orderEligibleEntries), and folds them into one
// snapshot alongside the world's own campaign timeline.
//
// doc-export.mjs (scripts/logic/doc-export.mjs) is a byte-identical port of
// campaign-record's own module - see doc-export-snapshot.mjs's header
// comment for what that constrains. renderDocx()/fetchImage()/downloadBlob()
// below are ported near-verbatim from campaign-record's export-dialog.mjs
// (same node kinds in, same docx.iife.js vendor bundle) - only the vendor
// path (loadVendorGlobal, this module's own Task 11 asset) and localization
// keys differ.
import { MODULE_ID, I18N } from "../constants.mjs";
import { snapshotToDocModel, replaceUuidTags } from "../logic/doc-export.mjs";
import {
  eligibleEntries, orderEligibleEntries, recordSnapshot, pageRelationships,
  buildGroupSnapshot, SESSION_KIND
} from "../logic/doc-export-snapshot.mjs";
import { loadVendorGlobal } from "../integrations/vendor-loader.mjs";
import { getTimelineJournal } from "../data/timeline-journal.mjs";
import * as Timepoints from "../data/timepoints.mjs";
import { formatCampaignDate } from "../logic/campaign-calendar.mjs";

/**
 * doc-export.mjs is ported byte-for-byte from campaign-record, including
 * two literal, campaign-record-namespaced i18n keys it calls opts.i18n()
 * with ("CAMPAIGNRECORD.Export.Timeline" for the Timeline section heading,
 * "CAMPAIGNRECORD.Export.GmNotes" for a session's GM Notes heading) - see
 * its snapshotToDocModel(). Rather than let those leak into this module's
 * own lang/en.json under a foreign "CAMPAIGNRECORD" namespace, the i18n
 * callback passed to snapshotToDocModel below intercepts exactly these two
 * literal keys and resolves this module's own MEJCampaignCompanion.export.*
 * strings instead; every other key passes through to game.i18n.localize
 * unchanged (FIELD_RENDERERS' other i18n calls - Npc/Place/Quest status
 * enums - are never reached for this module's kinds; see
 * doc-export-snapshot.mjs's recordSnapshot() doc comment).
 */
const CR_I18N_MAP = {
  "CAMPAIGNRECORD.Export.Timeline": `${I18N}.export.timelineHeading`,
  "CAMPAIGNRECORD.Export.GmNotes": `${I18N}.export.gmNotesHeading`
};

function crI18n(key) {
  return game.i18n.localize(CR_I18N_MAP[key] ?? key);
}

function typeIcon(kind) {
  return kind === SESSION_KIND ? "fa-solid fa-dice-d20" : `fas ${game.MonksEnhancedJournal.getIcon(kind)}`;
}

function typeLabel(kind) {
  if (kind === SESSION_KIND) return game.i18n.localize(`${I18N}.sheettype.session`);
  const labels = game.MonksEnhancedJournal.getTypeLabels();
  return game.i18n.localize(labels[kind] ?? kind);
}

/** Checkbox-list + GM-content-toggle prompt. Returns null on cancel. */
async function promptExport(rows) {
  const esc = foundry.utils.escapeHTML;
  const items = rows.map((row, i) => `
    <label class="mej-cc-export-row">
      <input type="checkbox" name="entry-${i}" checked>
      <i class="mej-cc-export-icon ${typeIcon(row.kind)}"></i>
      <span class="mej-cc-export-name">${esc(row.name)}</span>
      <span class="mej-cc-export-type">${esc(typeLabel(row.kind))}</span>
    </label>`).join("");
  const content = `
    <div class="mej-cc-export-list scrollable">${items}</div>
    <div class="form-group">
      <label>
        <input type="checkbox" name="includeGM">
        ${game.i18n.localize(`${I18N}.export.includeGM`)}
      </label>
      <p class="hint">${game.i18n.localize(`${I18N}.export.includeGMHint`)}</p>
    </div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: `${I18N}.export.title` },
    content,
    ok: {
      label: `${I18N}.export.download`,
      callback: (event, button) => {
        const form = button.form.elements;
        return {
          selected: rows.filter((_row, i) => form[`entry-${i}`]?.checked === true),
          includeGM: form.includeGM?.checked === true
        };
      }
    },
    rejectClose: false
  }).then((result) => result ?? null);
}

/** GM-only entry point (see CampaignHubPage.mjs / templates/hub.hbs). */
export async function openExportDialog() {
  if (!game.user.isGM) return;
  const rows = eligibleEntries(game.journal.contents, (entry) => game.MonksEnhancedJournal.getMEJType(entry));
  if (!rows.length) {
    return void ui.notifications.warn(game.i18n.localize(`${I18N}.export.nothingToExport`));
  }
  const journal = getTimelineJournal();
  const timepoints = journal ? Timepoints.getTimepoints(journal) : [];
  const ordered = orderEligibleEntries(rows, timepoints);

  const result = await promptExport(ordered);
  if (!result || !result.selected.length) return;

  await runExport(result.selected, result.includeGM, timepoints);
}

/** Relationship targets for a page, name-resolved via fromUuidSync. */
function resolvedRelationships(page) {
  return pageRelationships(page, (uuid) => fromUuidSync(uuid)?.name ?? null);
}

async function runExport(selectedRows, includeGM, timepoints) {
  try {
    const labels = {
      relationships: game.i18n.localize(`${I18N}.export.relationships`),
      sessionNumber: game.i18n.localize(`${I18N}.export.sessionNumber`),
      campaignDate: game.i18n.localize(`${I18N}.export.campaignDate`)
    };
    const buildRecord = (row) => recordSnapshot(row, {
      includeGM,
      relationships: row.kind === SESSION_KIND ? undefined : resolvedRelationships(row.page),
      labels,
      formatCampaignDate
    });
    const title = game.world.title || game.i18n.localize(`${I18N}.export.defaultTitle`);
    const snapshot = buildGroupSnapshot(title, timepoints, selectedRows, buildRecord);

    const nodes = snapshotToDocModel(snapshot, {
      includeGM,
      parse: (html) => new DOMParser().parseFromString(replaceUuidTags(html), "text/html").body,
      i18n: crI18n
    });
    const blob = await renderDocx(nodes);
    downloadBlob(blob, `${title.slugify({ strict: true }) || "campaign-export"}.docx`);
    ui.notifications.info(game.i18n.format(`${I18N}.export.done`, { count: selectedRows.length }));
  } catch (error) {
    console.error(`${MODULE_ID} | export failed`, error);
    ui.notifications.error(game.i18n.localize(`${I18N}.export.failed`));
  }
}

/** Fetch an image and measure it; null on any failure (caption fallback). */
async function fetchImage(src) {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer]));
    const scale = Math.min(1, 480 / bitmap.width);
    const size = {
      width: Math.round(bitmap.width * scale),
      height: Math.round(bitmap.height * scale)
    };
    const ext = src.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "bmp"].includes(ext)) {
      return { data: buffer, type: ext === "jpeg" ? "jpg" : ext, ...size };
    }
    // webp/etc.: docx can't embed them natively - transcode to PNG. SVG blobs
    // are rejected by createImageBitmap above, so SVGs never reach this path
    // and intentionally degrade to the caption fallback (null).
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { data: await png.arrayBuffer(), type: "png", ...size };
  } catch {
    return null;
  }
}

async function renderDocx(nodes) {
  const docx = await loadVendorGlobal("docx.iife.js", "docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink,
    Table, TableRow, TableCell, ImageRun, WidthType } = docx;

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  // The doc model represents a <br> as a run whose text contains "\n". Split
  // each run's text on "\n" into one TextRun per segment, with `break: 1`
  // (a line break before the text) on every segment after the first. An empty
  // FIRST segment is dropped, so a run whose text is exactly "\n" becomes a
  // single empty-text TextRun with `break: 1`. Formatting flags apply to
  // every segment; hyperlink wrapping applies to the whole set of segments
  // for that run.
  const toRuns = (runs) => runs.map((r) => {
    const make = (text, extra = {}) => new TextRun({
      text, bold: r.bold, italics: r.italics,
      underline: r.underline ? {} : undefined, strike: r.strike, ...extra
    });
    const segments = r.text.split("\n")
      .map((seg, i) => (i === 0 ? (seg ? make(seg) : null) : make(seg, { break: 1 })))
      .filter(Boolean);
    return r.link ? new ExternalHyperlink({ children: segments, link: r.link }) : segments;
  }).flat();

  const children = [];
  for (const node of nodes) {
    if (node.kind === "heading") {
      children.push(new Paragraph({ text: node.text, heading: HEADINGS[node.level - 1] }));
    } else if (node.kind === "paragraph") {
      // "IntenseQuote" is absent from the vendored docx build (would silently
      // render as Normal); render subtitle paragraphs as italics instead.
      const runs = node.style === "subtitle"
        ? node.runs.map((r) => ({ ...r, italics: true }))
        : node.runs;
      children.push(new Paragraph({ children: toRuns(runs) }));
    } else if (node.kind === "list") {
      for (const item of node.items) {
        children.push(new Paragraph({
          children: toRuns(item.runs),
          bullet: node.ordered ? undefined : { level: item.level },
          numbering: node.ordered ? { reference: "cc-numbered", level: item.level } : undefined
        }));
      }
    } else if (node.kind === "table") {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: node.rows.map((cells) => new TableRow({
          children: cells.map((runs) => new TableCell({
            children: [new Paragraph({ children: toRuns(runs) })]
          }))
        }))
      }));
    } else if (node.kind === "image") {
      const image = await fetchImage(node.src);
      if (image) {
        children.push(new Paragraph({
          children: [new ImageRun({
            type: image.type, data: image.data,
            transformation: { width: image.width, height: image.height }
          })]
        }));
        if (node.caption) children.push(new Paragraph({
          children: [new TextRun({ text: node.caption, italics: true })]
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({
            text: node.caption || node.src.split("/").pop(), italics: true
          })]
        }));
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: "cc-numbered",
        levels: [0, 1, 2].map((level) => ({
          level, format: "decimal", text: `%${level + 1}.`, alignment: "left"
        }))
      }]
    },
    sections: [{ children }]
  });
  return Packer.toBlob(doc);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
