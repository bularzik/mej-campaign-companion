// MediaPageSheet - mounts Foundry's own pdf/video viewing surface inside the
// MEJ shell (spec E §1). Registered over the NATIVE page types (see
// integrations/mej-adapter.mjs); no MEJ flag type is minted and no existing
// page is converted, so disabling this module restores stock Foundry
// behavior for these pages exactly.
//
// MEJ's tabbed shell renders subsheets by calling _replaceHTML directly and
// then manually invoking activateListeners()/subRender() - it never calls
// _onRender() for a shell-hosted subsheet. Any listener beyond the native
// data-action bindings must attach from activateListeners(), never from an
// _onRender() override (the same note SessionSheet.mjs carries).
import { EnhancedJournalSheet } from "/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js";
import { MODULE_ID, I18N, MEDIA_PAGE_TYPES } from "../constants.mjs";

export class MediaPageSheet extends EnhancedJournalSheet {
  /** The native types this sheet serves. */
  static MEDIA_TYPES = MEDIA_PAGE_TYPES;

  static DEFAULT_OPTIONS = {
    classes: ["mej-campaign-companion", "mej-cc-media-sheet"],
    window: { icon: "fa-solid fa-file-pdf" }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/media-page.hbs` }
  };

  static get type() {
    return "mediapage";
  }

  /**
   * Restore ApplicationV2's awaitable render contract.
   *
   * A native pdf/video page is NOT demoted to the shell subsheet (that happens
   * only for a page carrying flags.monks-enhanced-journal.type whose type is in
   * getDocumentTypes() - enhanced-journal.js:482-493, :538), so this sheet
   * mounts one level down, through JournalEntrySheet's page-view path. That
   * path transplants the sheet's rendered element into MEJ's own <article>
   * container (JournalEntrySheet.js:618-623):
   *
   *     await sheet.render({ force: true });
   *     if (!sheet.element) return;              // silent bail-out
   *     sheet.element.removeAttribute("class");
   *     element.append(sheet.element);           // the transplant
   *
   * But EnhancedJournalSheet.render() (EnhancedJournalSheet.js:392-405) is not
   * async and discards the promise from its own super.render(options) call.
   * Awaiting it resolves on the next microtask - long before the render
   * lifecycle has assigned this.element - so _renderPageView takes the silent
   * early return and never transplants anything. The sheet still renders
   * perfectly a moment later, into an element that is never attached to the
   * document: the viewer simply never appears, and nothing throws. Confirmed
   * live - the finished element held both the template and the knowledge panel
   * and still carried its `class` attribute, which the transplant would have
   * stripped had it ever run.
   *
   * MEJ's own typed sheets never hit this: they are mounted by renderSubSheet,
   * which does not await render(). Only a sheet reached through the page-view
   * path depends on the contract.
   *
   * A shell-hosted mount is delegated to MEJ unchanged; a standalone mount
   * skips to the first real (async) render above EnhancedJournalSheet in the
   * chain. MEJ's tempOwnership side effect is deliberately not reproduced: it
   * silently grants the viewing user OBSERVER, and MEJ has already
   * permission-filtered which pages render here (JournalEntrySheet's
   * _preparePageData / isPageVisible).
   *
   * This whole override is a workaround for the upstream defect described
   * above, not a design choice of ours - if MEJ's EnhancedJournalSheet.render()
   * is ever fixed to properly await its own super.render(), this bypass
   * should be removed rather than left in place, so we don't keep silently
   * skipping whatever MEJ's render() later grows.
   */
  async render(options = {}, _options = {}) {
    if (this.enhancedjournal) return super.render(options, _options);
    const base = Object.getPrototypeOf(EnhancedJournalSheet.prototype);
    return base.render.call(this, options, _options);
  }

  /**
   * MEJ's shell calls subsheet._toggleDisabled(true) on the SHELL subsheet
   * for a document that isn't owner-editable (enhanced-journal.js:646,
   * renderSubSheet) - correct for editable content sheets, wrong for a
   * read-only VIEWER: it would disable the video element's own controls and
   * the external-open link for every non-owner. NOT load-bearing on the
   * current mount path: a native pdf/video page's shell subsheet is MEJ's
   * own JournalEntrySheet, not this sheet, so _toggleDisabled is never
   * actually invoked on us there. Kept as a no-op guard in case MEJ ever
   * mounts this sheet directly as a shell subsheet - correct then, harmless
   * now. Same override, same reason, as CampaignHubPage's.
   */
  _toggleDisabled(_disabled) {}

  /**
   * The page's native type, tolerant of MEJ's fixType() normalization: a
   * mounted page's in-memory `.type` may be the bare key while `_source.type`
   * keeps the stored value. Checking both is the lesson from the campaign
   * portal round.
   */
  get mediaType() {
    const t = this.document?.type ?? "";
    const source = this.document?._source?.type ?? "";
    const bare = (v) => String(v).split(".").pop();
    return MediaPageSheet.MEDIA_TYPES.find((m) => bare(t) === m || bare(source) === m) ?? null;
  }

  async _prepareBodyContext(context, options) {
    context = await super._prepareBodyContext(context, options);
    const page = this.document;
    const src = page?.src ?? "";
    const kind = this.mediaType;
    context.name = page?.name ?? "";
    context.src = src;
    context.hasSrc = !!src;
    context.isPdf = kind === "pdf";

    // Foundry ships PDF.js and serves its viewer from a fixed path; pointing
    // the iframe at it (rather than at the raw file) is what core's own PDF
    // page sheet does, and gives paging/zoom/search for free. Replicated
    // exactly from JournalEntryPagePDFSheet#_getViewerParams (core
    // client/applications/sheets/journal/journal-entry-page-pdf-sheet.mjs
    // :90, :101-107): an absolute URL passes through untouched, a relative
    // path is routed through foundry.utils.getRoute() so a Foundry served
    // under a URL subpath still resolves, and the query string is built with
    // URLSearchParams rather than hand-encoded.
    context.viewerSrc = "";
    if (kind === "pdf" && src) {
      const params = new URLSearchParams();
      const resolved = URL.parse(src) ? src : foundry.utils.getRoute(src);
      params.append("file", resolved);
      context.viewerSrc = `scripts/pdfjs/web/viewer.html?${params}`;
    }

    // Core's video sheet branches on whether the source is a YouTube URL
    // (JournalEntryPageVideoSheet#_prepareContentContext, core
    // journal-entry-page-video-sheet.mjs:47,66) and mounts a YouTube embed
    // iframe instead of a <video> element - a bare <video src="youtube-url">
    // renders broken. Mirror that branch here.
    const video = page?.video ?? {};
    context.loop = video.loop === true;
    context.autoplay = video.autoplay === true;
    context.isYouTube = kind === "video" && !!src && !!game.video?.isYouTubeURL(src);
    context.youtubeSrc = "";
    if (context.isYouTube) {
      const vars = { playsinline: 1, modestbranding: 1, controls: video.controls !== false ? 1 : 0, autoplay: context.autoplay ? 1 : 0, loop: context.loop ? 1 : 0 };
      if (video.timestamp) vars.start = video.timestamp;
      context.youtubeSrc = game.video.getYouTubeEmbedURL(src, vars);
    }

    return context;
  }
}
