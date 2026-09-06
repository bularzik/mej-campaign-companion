// The New Campaign prompt (spec 2026-09-06 §1), shared by the Hub picker,
// the adopt banner, the sidebar button and folder conversion. Foundry-only
// (DialogV2, no MEJ imports), so init-registered hooks may import it
// dynamically without touching MEJ's import chain.
import { I18N } from "../constants.mjs";

/**
 * Name + Player-access prompt. `name` pre-fills the input; `title`/`intro`
 * override the window title and add a leading paragraph (the adopt banner
 * uses both). Resolves { name, baseline } or null on cancel / blank name.
 */
export async function promptNewCampaign({ name = "", title = null, intro = null } = {}) {
  const esc = foundry.utils.escapeHTML;
  const baselineOptions = ["none", "observer", "owner"].map((k) =>
    `<option value="${k}" ${k === "observer" ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
  const content = `
    ${intro ? `<p>${esc(intro)}</p>` : ""}
    <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignName`))}</label>
      <input type="text" name="name" value="${esc(name)}" autofocus></div>
    <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
      <select name="baseline">${baselineOptions}</select></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: title ?? game.i18n.localize(`${I18N}.hub.newCampaign`) },
    content,
    ok: {
      callback: (event, button) => ({
        name: button.form.elements.name.value.trim(),
        baseline: button.form.elements.baseline.value
      })
    },
    rejectClose: false
  });
  return result?.name ? result : null;
}
