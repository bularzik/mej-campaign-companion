/**
 * Restore ApplicationV2's awaitable render contract for a companion sheet
 * that extends MEJ's EnhancedJournalSheet.
 *
 * A native pdf/video page is NOT demoted to the shell subsheet (that happens
 * only for a page carrying flags.monks-enhanced-journal.type whose type is in
 * getDocumentTypes() - enhanced-journal.js:482-493, :538), so such a sheet
 * mounts one level down, through JournalEntrySheet's page-view path. So does
 * a Session or Hub page opened under a STOCK MEJ, which knows nothing about
 * the companion's types. That path transplants the sheet's rendered element
 * into MEJ's own <article> container (fork JournalEntrySheet.js:618-623;
 * stock 13.06 is the same lines at :607-610, without the guard):
 *
 *     await sheet.render({ force: true });
 *     if (!sheet.element) return;              // fork-only bail-out
 *     sheet.element.removeAttribute("class");
 *     element.append(sheet.element);           // the transplant
 *
 * But EnhancedJournalSheet.render() (EnhancedJournalSheet.js:392-405) is not
 * async and discards the promise from its own super.render(options) call.
 * Awaiting it resolves on the next microtask - long before the render
 * lifecycle has assigned this.element - so the transplant reads an element
 * that is not there yet. No released MEJ build (13.06, 14.01, upstream PR
 * #823) guards `_renderPageView`; only fork commit 08ffca5 does.
 * `renderAwaitable` is therefore required on every stock build - without it
 * _renderPageView throws "Cannot read properties of undefined (reading
 * 'removeAttribute')" and the shell tab shows an empty page body (on the
 * fork it takes the silent early return and transplants nothing). The sheet
 * still renders perfectly a moment later, into an element that is never
 * attached to the document.
 *
 * MEJ's own typed sheets never hit this: they are mounted by renderSubSheet,
 * which does not await render(). Only a sheet reached through the page-view
 * path depends on the contract.
 *
 * A shell-hosted mount (sheet.enhancedjournal set) is delegated to MEJ
 * unchanged; a standalone mount skips to the first real (async) render above
 * EnhancedJournalSheet in the chain. MEJ's tempOwnership side effect is
 * deliberately not reproduced: it silently grants the viewing user OBSERVER,
 * and MEJ has already permission-filtered which pages render here
 * (JournalEntrySheet's _preparePageData / isPageVisible).
 *
 * The MEJ sheet class is passed in rather than imported: the sheets import it
 * from the absolute /modules/monks-enhanced-journal/... path, which vitest
 * cannot resolve, and this helper is unit-tested.
 *
 * This whole helper is a workaround for the upstream defect described above,
 * not a design choice of ours - if MEJ's EnhancedJournalSheet.render() is
 * ever fixed to properly await its own super.render(), delete this file and
 * the three render() overrides that call it, so we don't keep silently
 * skipping whatever MEJ's render() later grows.
 */
export function renderAwaitable(sheet, MejSheet, options = {}, _options = {}) {
  if (sheet.enhancedjournal) return MejSheet.prototype.render.call(sheet, options, _options);
  const base = Object.getPrototypeOf(MejSheet.prototype);
  return base.render.call(sheet, options, _options);
}
