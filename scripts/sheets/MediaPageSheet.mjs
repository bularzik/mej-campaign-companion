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
   * MEJ's shell calls subsheet._toggleDisabled(true) for any mount whose
   * document isn't owner-editable (enhanced-journal.js's renderSubSheet) -
   * correct for editable content sheets, wrong for a read-only VIEWER: it
   * would disable the video element's own controls and the external-open
   * link for every non-owner. This sheet has no editable inputs at all, so
   * there is nothing for the blanket disable to protect. Same override, same
   * reason, as CampaignHubPage's.
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
      const vars = { playsinline: 1, modestbranding: 1, controls: 1, autoplay: context.autoplay ? 1 : 0, loop: context.loop ? 1 : 0 };
      if (video.timestamp) vars.start = video.timestamp;
      context.youtubeSrc = game.video.getYouTubeEmbedURL(src, vars);
    }

    return context;
  }
}
