// scripts/apps/audience-dialog.mjs
// The shared per-player/group reveal dialog (spec §5) and the reveal
// whisper (spec §10). GM-only affordances: every caller re-checks
// game.user.isGM before opening the dialog or writing the audience.
import { I18N, MODULE_ID } from "../constants.mjs";
import { normalizeAudience, resolveRecipients } from "../logic/reveal-state.mjs";

/**
 * Checkbox dialog over players / groups / everyone. Returns the new
 * audience (normalized) or null on cancel. revealedAt is stamped when the
 * result has any target and the prior audience had none.
 */
export async function promptAudience({ title, audience, groups }) {
  const prior = normalizeAudience(audience);
  const esc = foundry.utils.escapeHTML;
  const players = game.users.filter((u) => !u.isGM);
  const playerRows = players.map((u) =>
    `<label class="mej-cc-audience-row"><input type="checkbox" name="user-${u.id}"${prior.users.includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`
  ).join("");
  const groupRows = (groups ?? []).map((g) =>
    `<label class="mej-cc-audience-row"><input type="checkbox" name="group-${g.id}"${prior.groups.includes(g.id) ? " checked" : ""}> <i class="fa-solid fa-users"></i> ${esc(g.name)}</label>`
  ).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `
      <label class="mej-cc-audience-row mej-cc-audience-all"><input type="checkbox" name="all"${prior.all ? " checked" : ""}>
        <strong>${game.i18n.localize(`${I18N}.secrets.everyone`)}</strong></label>
      <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.players`)}</legend>${playerRows || `<p class="notes">${game.i18n.localize(`${I18N}.secrets.noPlayers`)}</p>`}</fieldset>
      <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.groups`)}</legend>${groupRows || `<p class="notes">${game.i18n.localize(`${I18N}.secrets.noGroups`)}</p>`}</fieldset>`,
    ok: {
      label: `${I18N}.secrets.apply`,
      callback: (event, button) => {
        const form = button.form.elements;
        return {
          users: players.filter((u) => form[`user-${u.id}`]?.checked).map((u) => u.id),
          groups: (groups ?? []).filter((g) => form[`group-${g.id}`]?.checked).map((g) => g.id),
          all: form.all?.checked === true
        };
      }
    },
    rejectClose: false
  });
  if (!result) return null;
  const had = prior.all || prior.users.length || prior.groups.length;
  const has = result.all || result.users.length || result.groups.length;
  return normalizeAudience({ ...result, revealedAt: has && !had ? Date.now() : prior.revealedAt });
}

/**
 * Whisper the revealed content to recipients NEWLY added by this audience
 * change (spec §10). Un-reveal (targets removed) whispers nothing.
 */
export async function sendRevealWhisper({ audience, previousAudience, groups, html, entryUuid, entryName }) {
  try {
    const next = normalizeAudience(audience);
    const prev = normalizeAudience(previousAudience);
    let recipients;
    if (next.all && !prev.all) {
      recipients = game.users.filter((u) => !u.isGM).map((u) => u.id);
    } else if (next.all && prev.all) {
      recipients = [];
    } else {
      const before = prev.all
        ? new Set(game.users.filter((u) => !u.isGM).map((u) => u.id))
        : new Set(resolveRecipients(prev, groups));
      recipients = resolveRecipients(next, groups).filter((id) => !before.has(id));
    }
    if (!recipients.length) return;
    const content = `<div class="mej-cc-reveal-whisper">
      <p><strong>${game.i18n.format(`${I18N}.secrets.whisperHeader`, { name: foundry.utils.escapeHTML(entryName) })}</strong></p>
      ${html}
      <p>@UUID[${entryUuid}]{${foundry.utils.escapeHTML(entryName)}}</p></div>`;
    await ChatMessage.implementation.create({ content, whisper: recipients });
  } catch (err) {
    console.error(`${MODULE_ID} | reveal whisper failed`, err);
  }
}
