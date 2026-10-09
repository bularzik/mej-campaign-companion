// GM dialog for the player-access check (spec 2026-10-08). Foundry-only
// (DialogV2, no MEJ imports). Resolves { enable, dontShowAgain }; closing
// the window counts as "Not now" but still honours a ticked checkbox, which
// is why the checkbox is tracked by a change listener rather than read from
// the button callback alone.
import { I18N } from "../constants.mjs";

export async function promptPlayerAccess() {
  const t = (k) => game.i18n.localize(`${I18N}.playerAccess.${k}`);
  let dontShowAgain = false;
  const content = `
    <p>${t("body1")}</p>
    <p>${foundry.utils.escapeHTML(t("body2"))}</p>
    <p>${foundry.utils.escapeHTML(t("body3"))}</p>
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" name="dontShowAgain"> ${foundry.utils.escapeHTML(t("dontShowAgain"))}</label>
    </div>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("title"), icon: "fa-solid fa-users" },
    classes: ["mej-campaign-companion-player-access"],
    content,
    buttons: [
      { action: "enable", label: t("enable"), icon: "fa-solid fa-check", default: true },
      { action: "notNow", label: t("notNow"), icon: "fa-solid fa-xmark" }
    ],
    render: (event, dialog) => {
      const box = (dialog.element ?? dialog).querySelector('input[name="dontShowAgain"]');
      box?.addEventListener("change", () => { dontShowAgain = box.checked; });
    },
    rejectClose: false
  });
  return { enable: choice === "enable", dontShowAgain };
}
