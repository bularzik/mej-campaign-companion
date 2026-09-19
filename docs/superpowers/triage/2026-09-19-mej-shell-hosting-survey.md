# MEJ shell-hosting survey: extension API vs. stock 13.06 / 14.01

(Read-only survey, 2026-09-19. Paths: FORK = ~/Claude/Projects/monks-enhanced-journal @ feat/extension-api-upstream; 14.01 = same repo @ tag 14.01; 13.06 = ~/FoundryVTT/Data/Data/modules/monks-enhanced-journal; COMP = ~/Claude/Projects/mej-campaign-companion.)

Baseline finding: 13.06 and 14.01 are the same shell. Every hook point below is textually identical or trivially different (async-ification, one added header-controls filter, one changed sheet-config class). The full 13.06<->14.01 diff of apps/enhanced-journal.js touches none of the type-dispatch logic.

## 1. Extension API surface and the stock equivalent of every internal it touches

### 1a. Hooks.callAll("setupMonksEnhancedJournal", MonksEnhancedJournal.getApi())
- FORK monks-enhanced-journal.js:332, inside static init(), right after `game.MonksEnhancedJournal = this;` (FORK:330).
- Stock: 13.06 :262 / 14.01 :272 assign game.MonksEnhancedJournal; the Hooks.callAll line is absent from both.
- init() runs from Hooks.once("init") at 13.06 :4323-4325 (same in 14.01). Handshake is init-time.
- Shim consequence: no handshake to hook; the companion self-drives once game.MonksEnhancedJournal exists.

### 1b. registerSheetType({key, moduleId, sheetClass, label, icon, relationships}) — FORK :110-123
Stores MonksEnhancedJournal.externalTypes[key] = {moduleId, sheetClass, label, icon, relationships} (FORK :105, :116).

| What it writes/reads | FORK | 13.06 | 14.01 | verdict |
|---|---|---|---|---|
| Collision check against getDocumentTypes()[key] | :113-114 | getDocumentTypes() :108-124 returns a hardcoded 13-entry literal (list, encounter, event, organization, person, picture, place, poi, quest, shop, loot, slideshow, journalentry) | :108-124 byte-identical | identical |
| getDocumentTypes() extended with externalTypes | :160,176-178 | absent | absent | absent both |
| getTypeLabels() extended | :197-199 | :126-142 literal | :126-142 identical | absent both |
| DocumentSheetConfig.registerSheet(JournalEntryPage, moduleId, sheetClass, {types:[key, `${moduleId}.${key}`], makeDefault:true, label}) | :117-121 | core API; MEJ does the same for its own types in registerSheetClasses() :2168-2210 | :2215-2257 | core API, companion already does this (mej-adapter.mjs wireApiMode/wireNativeMode) |
| CONFIG.JournalEntryPage.typeLabels merge | :122-123 | :2208 | :2255 | identical mechanism |

### 1c. registerShellPage({id,label,icon,appClass}) — FORK :124-128
Stores MonksEnhancedJournal.shellPages[id] = {label, icon, appClass} (FORK :106). No stock registry exists.

### 1d. MonksEnhancedJournal.openShellPage(id, options) — FORK :136-149
```js
if (!MonksEnhancedJournal.journal) MonksEnhancedJournal.journal = await (new EnhancedJournal(options)).render(true, options);
let entity = await MonksEnhancedJournal.journal.findEntity(`shellpage:${id}`, i18n(page.label));
MonksEnhancedJournal.journal.open(entity, options.newtab, options);
```
Stock equivalent: openJournalEntry 13.06 :2310-2400 (tail :2390-2400 ensures the shell then .open()); 14.01 :2357-…, same body except the first guard (13.06 :2311 `!game.user.isGM && !setting('allow-player')` vs 14.01 :2358 `!MonksEnhancedJournal.canShowEnhancedJournal`). MonksEnhancedJournal.journal and EnhancedJournal#open are reusable by a shim with a hand-built entity.

### 1e. BlankJournal extensions — FORK apps/enhanced-journal.js:9-81
Stock BlankJournal 13.06 :9-40 / 14.01 :9-40 byte-identical: constructor + mergeObject(this, options), defineSchema() (name, type initial "blank", content, options{hidebuttons,position,window}, flags), id "blank-journal-entry", uuid same, documentName "JournalEntryPage". Module-private, not exported.

FORK adds (absent from both stock versions):
- get isOwner() :53-55 — true only for a registered shell page; feeds `new cls({…, editable: this.document.isOwner, …})` at 13.06 :494 / 14.01 :507.
- _getSheetClass() :60-62 — returns shellPages[this.type].appClass. Load-bearing: the stock subsheet selector calls `this.document._getSheetClass?.()`; stock BlankJournal lacks it so cls === null → BlankSheet fallback (13.06 :490 / 14.01 :503).
- get compendium() :68-70 — Document#compendium is abstract and throws; read by EnhancedJournalSheet._canUserView (13.06 sheets/EnhancedJournalSheet.js:164-167).
- testUserPermission(user, permission, options) :78-81 — bypass for shell pages; needed because of the OBSERVER check at 13.06 :466-473 / 14.01 :479-486.

COMP already reimplements this shape as HubShellDocument in scripts/apps/hub-window.mjs:22-76, including `get permission()` returning OWNER (hub-window.mjs:62-67), which the fork's BlankJournal lacks (EnhancedJournalSheet.isEditable reads document.permission == OWNER, 13.06 sheets/EnhancedJournalSheet.js:341-347). It needs only _getSheetClass() added.

### 1f. isSyntheticType(type) — FORK apps/enhanced-journal.js:11-13
Replaces a literal `["blank","folder"].includes(…)` at nine sites, all present verbatim in both stock versions:

| site | 13.06 | 14.01 |
|---|---|---|
| renderSubSheet tab-entity resolve | :420 | :433 |
| renderSubSheet pre-fixType guard | :443 | :456 |
| renderSubSheet OBSERVER guard | :466 | :479 |
| renderSubSheet updateStyle guard | :635 | :638 |
| renderSubSheet render-hooks guard | :643 | :646 |
| renderSubSheet sound guard | :663 | :666 |
| _replaceHTML part-state guard | :327 | :340 |
| tab context-menu visible | :1611 | :1649 |
| navigate-prev/next toggle | :1807-1808 | :1836-1837 |

Only the first three matter functionally for hosting.

### 1g. Shell-instance getter `get getDocumentTypes()` — FORK :865-871, 13.06 :808-812, 14.01 :815-819
Dead code in all three (zero callers). A shim does not need it.

### 1h. fixType — FORK :4216, 13.06 :4115-4150, 14.01 :4131-…
Stock body (identical in both):
```js
type = type || object.type;
if (types[type]) object.type = type;
else if (game.user.isGM) object.unsetFlag("monks-enhanced-journal", "type");
```
FORK :4243-4248 skips the unset when object._source.type contains a "." and does not start with "monks-enhanced-journal.". Absent from both stock versions; both destructive.

### 1i. getMEJType — 13.06 :191-200, 14.01 :191-200, byte-identical, unmodified by the fork
Requires types[type]; returns false otherwise. Gates FORK's header-control filter (:329) and, in stock 14.01 only, _getHeaderControls :280.

### 1j. getIcon — FORK :2908 adds externalTypes icon; 13.06 :2760-2782 / 14.01 :2825 identical. Cosmetic: the tab template (templates/main.html:7-12) renders no icon.

### 1k. Sidebar click wrapper clickDocumentName — 13.06 :355-388 (registered :391 via patchFunc on JournalDirectory.prototype._onClickEntry, "MIXED"); 14.01 same, registered :401. Identical, untouched by the fork. Reads event.target.parentElement.dataset.entryId (fragile; COMP investigation spec :224-232).

### 1l. openJournalEntry — 13.06 :2310, 14.01 :2357. Untouched by the fork. Calls fixType(doc) (13.06 :2329) then MonksEnhancedJournal.journal.open(doc, options.newtab, options).

### 1m. Header / sheet-config — the one real 13.06<->14.01 divergence
- static onConfigureSheet — 13.06 :264-275 uses MEJ's own ApplicationSheetConfig({type:"enhancedjournal"}) (import :5), never touching CONFIG.JournalEntry.sheetClasses[subtype]. 14.01 :265-277 uses core DocumentSheetConfig({document}), which throws "Cannot convert undefined or null to object" on a synthetic type (FORK comment :310-315; FORK :316 guards with isSyntheticType). 14.01-only bug.
- _getHeaderControls — 13.06 :277-279 returns subsheet controls only; 14.01 :278-292 calls super, filters configureSheet when getMEJType(document) is truthy, rebinds sub-control onClick via _handleContextClick (:294-300). FORK :328-337 extends the filter with isSyntheticType.

## 2. How the stock shell picks the subsheet class

Selector, identical in all three (13.06 :486, 14.01 :499, FORK :549):
```js
const cls = this.document instanceof JournalEntry ? JournalEntrySheet : (this.document._getSheetClass ? this.document._getSheetClass() : null);
```
Guarded by `if (this.subsheet?.document?.id != this.document?.id || this.subsheet?.type != this.document?.type)` (13.06 :485 / 14.01 :498) — instance `type` read, which is why CampaignHubPage defines both static and instance `type` getters (COMP scripts/apps/CampaignHubPage.mjs:184-202). Fallback: `if (!cls || document instanceof Actor) → new BlankSheet(…)` (13.06 :487-490).

Demotion gate (13.06 :430-441, 14.01 :443-454, identical):
```js
if (this.document instanceof JournalEntry && this.document.pages.size == 1 && (!!getProperty(pages.contents[0], "flags.monks-enhanced-journal.type") || !!getProperty(this.document, "flags…type"))) {
    let type = …; if (type=="base"||type=="oldentry") type="journalentry";
    let types = MonksEnhancedJournal.getDocumentTypes();
    if (types[type]) { this.document = this.document.pages.contents[0]; tab.entityId = this.document.uuid; tab.entity = this.document; this.saveTabs(); }
}
```
Both the MEJ type flag AND membership in the hardcoded 13-type map are required.

Page sheet-class resolution: JournalEntrySheet.getPageSheet(page) 13.06 sheets/JournalEntrySheet.js:893-914 uses page._getSheetClass() and constructs the V2 sheet with {id:"{id}-view", tag:"div", mode:"view", window:{frame:false, positioned:false}}; isPageVisible :930-933; _renderPageViews :578-605; _renderPageView 13.06 :607-611 / 14.01 :618-622 / FORK identical:
```js
async _renderPageView(element, sheet) {
    await sheet.render({ force: true });
    sheet.element.removeAttribute("class");
    element.append(sheet.element);
}
```
Correction: no `if (!sheet.element) return;` guard exists in 13.06, 14.01 or the fork; awaitable-render.mjs's header comment about later builds is wrong. renderAwaitable is required on both stock versions.

What a companion-registered subtype hits on stock (sidebar click → _onClickEntry):
1. fixType(entry) no-op for a JournalEntry (13.06 :4116).
2. openJournalEntry(entry) → journal.open(entry) → renderSubSheet.
3. Demotion gate: no MEJ flag / unknown type → no demotion; document stays the JournalEntry.
4. Selector: cls = JournalEntrySheet (MEJ's own).
5. JournalEntrySheet.subRender → _renderPageViews → getPageSheet → page._getSheetClass() = SessionSheet → _renderPageView transplant.
Net: the Session renders one level down inside MEJ's JournalEntrySheet page-view container (subsheetCtor "JournalEntrySheet", confirmed in COMP investigation spec :234-262).

Via openJournalEntry(page): fixType(page) runs first (scrub, §4), renderSubSheet sets document = page, cls = page._getSheetClass() = SessionSheet directly as the shell subsheet. Reachable without wraps, but addTab (13.06 :907-912) hoists entity.parent and stashes pageId, undoing it.

## 3. Blank/synthetic tabs, addTab, activateTab, tab shape, user flags
- findEntity(entityId, text) — 13.06 :866-887, 14.01 :873-894 (identical): undefined id → new BlankJournal({flags:{'monks-enhanced-journal':{type:'blank'}}, content:""}); ids containing "." → fromUuid; else game.journal.get / game.actors.get; failure → BlankJournal with "cannot find entity" (:882). FORK :926-940 prepends the shellpage: branch.
- addTab(entity, options={activate:true, refresh:true}) — 13.06 :907-941 (sync), 14.01 :914-947 (async). Tab shape (13.06 :920-928): {id: makeid(), text: entity?.name || NewTab, active:false, entityId: entity?.uuid, entity: entity || new BlankJournal({…}), pageId: options.pageId, anchor: options.anchor, history: []}. `if (entity?.parent) { options.pageId = entity.id; entity = entity.parent; }` at :910-913 swaps a page for its parent entry.
- activateTab(tab, event, options) — 13.06 :943-1023, 14.01 :950-…: saveScrollPos → await subsheet?.close() → resolve forms → altKey opens outside via findEntity + fixType + document.sheet.render(true) (:968-971) → shiftKey closes → re-resolves tab.entity via findEntity when changed or subsheet empty (:996-999) → flips active → saveTabs() (:1009). Identical logic; 14.01 async.
- open(entity, newtab, options) — 13.06 :1266-1290, 14.01 :1295-1319: no tabs → addTab; newtab === true → `this.tabs.find(t => t.entityId?.includes(entity.id))` else addTab; otherwise close subsheet then reuse-or-updateTab. FORK :1374-1385 rewrites the two find predicates for shellPageId. Hazard: includes(entity.id) with a fixed marker id matches any tab containing that string; a unique per-page id is required (HubShellDocument.id/uuid already are, hub-window.mjs:47-53).
- saveTabs() — 13.06 :1098-1114, 14.01 :1127: strips entity/element/userdata, keeps history/historyIdx, writes game.user.update({flags:{'monks-enhanced-journal':{tabs}}}, {render:false}). Loaded in _preFirstRender 13.06 :135 / 14.01 :136 (14.01 adds removeDuplicateTabs :137), then entity deleted from each tab. A persisted synthetic tab must be re-resolvable from its entityId string via findEntity on next boot — the findEntity wrap provides that.
- updateTab — 13.06 :1025-1071 (sync) / 14.01 async: compares tab.entityId != entity.uuid, pushes history (cap 10), saveTabs, updateRecent(tab.entity), render(true, {focus:true}). updateRecent skips entity.type == "blank" only (13.06 :1292; 14.01 :1325 adds entity?.id &&) — a synthetic non-"blank" type is written into _recentlyViewed and getFlag is called on it (Document provides it).
- Tab chrome: templates/main.html:7-12 — .journal-tab[data-tabid] with .tab-content text + close button. No icon/type class. Click binding 14.01 :408.

## 4. Where stock rejects or scrubs a synthetic / unregistered type
(a) fixType's GM flag-unset — 13.06 :4139-4141, 14.01 :4155-4157, identical, destructive. Any JournalEntryPage whose MEJ type flag is not a built-in key gets the flag persistently removed by every GM who opens it. Call sites reaching a page: openJournalEntry 13.06 :2329; renderSubSheet :443-444; activateTab alt-click :968; clickDocumentName :362 + :372; enhanced-journal.js :1552, :1572, :1589, :1621 (context menus). 14.01: :2376, :456-457, :981, :372/:382, :1590, :1610, :1627, :1659. The else branch leaves an unknown page's in-memory type as the prefixed subtype, which is why registering the sheet for the prefixed form resolves.
(b) getMEJType validation — non-destructive; only 14.01 _getHeaderControls :280 consumes it.
(c) Demotion gate — soft rejection; falls through to _renderPageView path.
(d) 14.01-only throw: onConfigureSheet :265-277 with core DocumentSheetConfig on a synthetic doc. 13.06 :264-275 immune.
(e) _replaceHTML part-state block 13.06 :327-347 / 14.01 :340-360: runs for any non-blank/folder type with subsheet.document?.id truthy; calls subsheet._preSyncPartState per PARTS key. Survivable (Hub declares one part).
(f) OBSERVER gate 13.06 :466-473 / 14.01 :479-486 when options.force || tempOwnership writes document.ownership[user.id] = OBSERVER (throws on a stub without ownership); :450-463 replaces the doc with a "no permission" BlankJournal for non-GM when testUserPermission(user,"OBSERVER") is falsy.

## 5. Candidate wrap points, ranked least → most fragile
libWrapper: MEJ's patchFunc (13.06/14.01 monks-enhanced-journal.js:76-91) uses libWrapper when active, eval fallback otherwise, ~50 uses, plus libWrapper.ignore_conflicts at :440-443 / :450-453. The companion already has a libWrapper-or-manual helper at scripts/logic/auto-capture.mjs:145-152 (installShareImageWrap), used by scripts/hooks/auto-capture.mjs:240-303 and scripts/hooks/create-dialog-default.mjs:36-53.

1. EnhancedJournal.prototype.findEntity (WRAPPER) — 13.06 :866 / 14.01 :873. Intercept shellpage: ids. Identical both. Lowest risk. Reproduces FORK :926-940.
2. MonksEnhancedJournal.fixType (MIXED) — 13.06 :4115 / 14.01 :4131. Early return for foreign dotted subtypes. Identical both. Removes the need for healSessionFlags.
3. MonksEnhancedJournal.getDocumentTypes (WRAPPER) — :108 both. Merge companion types. Opens the demotion gate, makes getMEJType return the type, stops fixType scrubbing (makes #2 redundant). Broad blast radius: feeds registerSheetClasses (:2168/:2215), compendium thumbnails (13.06 ~:5119), the create-page dialog, and MEJ's assets/<type>.png 404 (FORK guards at :1011-1040, :4486-4498, :5213-5221).
4. EnhancedJournal.prototype.addTab / open (WRAPPER) — 13.06 :907/:1266, 14.01 :914/:1295. 14.01 async, 13.06 sync: wrapper must return the wrapped value. Needed to stop the parent swap and to match a synthetic tab by unique entityId. Medium.
5. JournalEntrySheet.prototype._renderPageView (WRAPPER) — 13.06 :607 / 14.01 :618, identical. Optional resilience; awaitable-render.mjs already handles it. Medium.
6. EnhancedJournal.prototype.renderSubSheet — 13.06 :409 / 14.01 :422. ~250 lines, shifted 13 lines between versions, modified in seven places by the fork. High. Prefer wrapping the inputs.
7. EnhancedJournal.onConfigureSheet (MIXED, 14.01 only) — 14.01 :265. Version-conditional. High because of the fork.
8. EnhancedJournal.prototype._getHeaderControls — different implementations; cosmetic; skip unless a stray Configure Sheet button matters.
9. Not needed: shell get getDocumentTypes (dead), tab template, getIcon, getTypeLabels.

Shape recommendation: minimum viable shim = #1 + #3 (or #1 + #2 to avoid #3's blast radius), plus HubShellDocument with _getSheetClass(), plus #4 for tab identity. #3 alone makes the Session sheet a first-class shell subsheet on both stock versions without touching renderSubSheet; the Hub additionally needs #1 + #4.

Timing: no stock handshake. game.MonksEnhancedJournal is assigned in static init() (Hooks.once("init") at :4323). resolveMode (scripts/logic/mej-mode.mjs:23-27) maps "no handshake" → native; the shim wires from native mode at setup/ready, with ensureSheetRegistrations (mej-adapter.mjs) as the post-ready safety net.
