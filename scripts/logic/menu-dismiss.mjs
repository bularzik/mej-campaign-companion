// Which Hub pop-up menus a click or Escape should close (spec 2026-09-25
// hub-ux-fixes §1). Pure: the DOM wiring lives in CampaignHubPage.mjs.
export const MENU_FLAGS = { tools: "toolsMenuOpen", type: "typeMenuOpen", sort: "sortMenuOpen" };

export function openMenuKeys(state) {
  return Object.keys(MENU_FLAGS).filter((key) => state?.[MENU_FLAGS[key]] === true);
}

/** State patch closing every open menu except `insideMenuKey`; null if none. */
export function dismissPatch(state, { insideMenuKey = null } = {}) {
  const patch = {};
  for (const key of openMenuKeys(state)) {
    if (key !== insideMenuKey) patch[MENU_FLAGS[key]] = false;
  }
  return Object.keys(patch).length ? patch : null;
}
