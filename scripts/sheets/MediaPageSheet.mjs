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
import { renderAwaitable } from "./awaitable-render.mjs";
import { MODULE_ID, I18N, MEDIA_PAGE_TYPES } from "../constants.mjs";

export class MediaPageSheet extends EnhancedJournalSheet {
  /** The native types this sheet serves. */
  static MEDIA_TYPES = MEDIA_PAGE_TYPES;

  /** Per-type window icon; DEFAULT_OPTIONS.window.icon below is only the pre-mediaType fallback. */
  static WINDOW_ICONS = { pdf: "fa-solid fa-file-pdf", video: "fa-solid fa-film" };

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
   * DEFAULT_OPTIONS.window.icon above is a static pdf-shaped fallback for
   * before this instance's document is known; swap it for the real media
   * type's icon here so a popped-out video page doesn't carry a pdf icon.
   * Called by ApplicationV2's own render flow on first render, and again
   * explicitly by MEJ's renderSubSheet for a shell-hosted mount
   * (enhanced-journal.js:589) - covers both hosting paths.
   */
  _configureRenderOptions(options) {
    const icon = MediaPageSheet.WINDOW_ICONS[this.mediaType];
    if (icon) this.options.window.icon = icon;
    super._configureRenderOptions(options);
  }

  /** See awaitable-render.mjs — restores the awaitable render contract MEJ's render() breaks. */
  async render(options = {}, _options = {}) {
    return renderAwaitable(this, EnhancedJournalSheet, options, _options);
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
    context.controls = video.controls !== false;
    context.loop = video.loop === true;
    context.autoplay = video.autoplay === true;
    // width/height are the page's own explicit sizing override; when neither
    // is set, core (and we) fall back to an aspect-ratio box instead - see
    // flexRatio below and media-page.hbs's figure wrapper.
    context.width = video.width || null;
    context.height = video.height || null;
    context.flexRatio = !video.width && !video.height;
    context.isYouTube = kind === "video" && !!src && !!game.video?.isYouTubeURL(src);
    context.youtubeSrc = "";
    if (context.isYouTube) {
      const vars = { playsinline: 1, modestbranding: 1, controls: video.controls !== false ? 1 : 0, autoplay: context.autoplay ? 1 : 0, loop: context.loop ? 1 : 0 };
      if (video.timestamp) vars.start = video.timestamp;
      context.youtubeSrc = game.video.getYouTubeEmbedURL(src, vars);
    }

    return context;
  }

  /**
   * volume and currentTime are DOM properties, not HTML attributes - Foundry
   * core sets them the same way, on the native <video> element's
   * "loadedmetadata" event (JournalEntryPageVideoSheet#_onRender, core
   * journal-entry-page-video-sheet.mjs:88-92). Mirrored here, but from
   * activateListeners() per this file's header note: MEJ's shell never calls
   * _onRender() for a hosted subsheet, so an _onRender()-based listener would
   * silently never bind in shell mode. Does not apply to the YouTube branch -
   * that one is driven entirely by embed URL vars (see _prepareBodyContext).
   */
  async activateListeners(html) {
    await super.activateListeners(html);
    const video = this.document?.video ?? {};
    const el = $(".mej-cc-media-video", html)[0];
    el?.addEventListener("loadedmetadata", () => {
      el.volume = video.volume;
      if (video.timestamp) el.currentTime = video.timestamp;
    });
  }
}
