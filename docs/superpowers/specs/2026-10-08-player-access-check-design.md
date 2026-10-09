# Player access check — design

Date: 2026-10-08
Status: approved in chat, pending written-spec review
Release: next minor (feature)

## Problem

Reported on a hosted Foundry 13.351 server (stock MEJ 13.06, companion
0.23.0): a **player** who creates an entity in a campaign folder sees it
open in Foundry's default journal editor instead of inside Monk's Enhanced
Journal.

Cause: MEJ's world setting **"Allow players to use Enhanced Journal"**
(`monks-enhanced-journal.allow-player`) was off on that server. MEJ's
`openJournalEntry` starts with
`if (!game.user.isGM && !setting('allow-player')) return false;`
(13.06 `monks-enhanced-journal.js` ~2311; same on 14.x), and on `false`
MEJ's `JournalEntry._onCreate` wrapper falls through to core's sheet render.
Reproduced locally on Foundry 13 World B as User 1: with the setting off a
new Person opens as `JournalEntrySheet5e` + `PersonSheet`, in a campaign
folder and in a plain folder alike. Every journal a player opens behaves the
same way — the setting is not campaign-specific, and as GM the problem is
invisible. The setting's registered default is **off** (both 13.06 and
14.x), so every new world that installs the companion starts in this state.

The companion depends on MEJ's window for players (Campaign Hub, Session
sheets, knowledge panel, campaign entries), so with the setting off the
companion does not work properly for players.

## Decision

Companion-side only; MEJ is not patched. When a GM logs in and the setting
is off, the companion explains that Campaign Companion won't work properly
for players and offers to turn the setting on. Connected players are asked
(not forced) to reload when it is turned on.

Approach chosen for the reload prompt (approach 1 of 3): each player's
client watches `updateSetting` for the off→on change. World-setting updates
already broadcast to every client, so no socket action is needed, and the
prompt also fires when a GM enables the setting from MEJ's own settings
page. Rejected: a dedicated companion socket action (more code, misses the
settings-page path); relying on Foundry's `requiresReload` (14.x only, and
only from the settings page).

## Behaviour

### When the check runs

Once per client load, at the end of the companion's existing `ready` hook,
after `onReady()` resolves. The dialog is offered only when all hold:

- `game.user.isGM`
- MEJ is active (the ready hook already returns early when MEJ is absent)
- `monks-enhanced-journal.allow-player` is registered and `false`
- the companion's `warnPlayerAccess` world setting is `true`

With several GMs online, each sees it on their own login. If MEJ has no
`allow-player` setting registered (e.g. a future rename), the check is
skipped with a console warning.

### Dialog (DialogV2, all strings localized)

- **Title:** Campaign Companion: players need Enhanced Journal access
- **Body:**
  > Campaign Companion won't work properly for your players while Monk's
  > Enhanced Journal's **"Allow players to use Enhanced Journal"** setting
  > is off.
  >
  > With it off, players can't use the Campaign Hub, Session sheets, the
  > knowledge panel or campaign entries the way the companion expects.
  > Anything they open or create opens in Foundry's default journal editor
  > instead.
  >
  > Turn it on now to make Campaign Companion work for players?
- **Checkbox:** Don't show this again
- **Buttons:** **Enable for players** (default) · **Not now**

Closing the dialog (✕ / Escape) counts as **Not now**. The checkbox is
honoured with either button.

### Results

| Button | Checkbox | Writes |
|---|---|---|
| Enable for players | any | `allow-player = true`; `warnPlayerAccess = false` only if ticked |
| Not now / close | unticked | nothing |
| Not now / close | ticked | `warnPlayerAccess = false` |

After a successful enable the GM gets an info toast: *Players can now use
Campaign Companion. Connected players have been asked to reload.* A failed
write shows an error toast and logs the error; nothing throws out of the
ready hook.

### Player reload prompt

On every non-GM client, an `updateSetting` for key
`monks-enhanced-journal.allow-player` whose value goes from off to on shows
a confirm: *Your GM has enabled Campaign Companion for players. Reload now
to use it?* — **Reload** (`foundry.utils.debouncedReload()` /
`location.reload()`) · **Later**. Nobody is reloaded without saying yes. GM
clients never get the prompt. A change from on to off does nothing.

### Re-enabling the warning

`warnPlayerAccess` is a world setting, `config: true`, shown in the
companion's settings as **Warn when Campaign Companion can't work for
players** with a hint explaining the check. Default `true`. "Don't show this
again" sets it to `false`; ticking it again in settings restores the check.

## Code layout

Follows the companion's split: pure logic in `scripts/logic/` (vitest-loadable,
no Foundry globals), Foundry glue in `scripts/hooks/`, UI in `scripts/apps/`.

- **`scripts/logic/player-access.mjs`** (new, pure)
  - `shouldOfferPlayerAccess({ isGM, allowPlayer, warnEnabled })` → boolean.
    `allowPlayer` is `undefined` when MEJ's setting is unregistered → false.
  - `shouldPromptReload({ isGM, key, oldValue, newValue })` → boolean; true
    only for a non-GM, key `monks-enhanced-journal.allow-player`,
    `oldValue !== true && newValue === true`.
  - `playerAccessWrites({ enable, dontShowAgain })` → the list of setting
    writes from the results table above.
- **`scripts/apps/player-access-dialog.mjs`** (new): `promptPlayerAccess()`
  renders the DialogV2 and resolves `{ enable, dontShowAgain }`; a dismissed
  dialog resolves `{ enable: false, dontShowAgain: <checkbox state> }`.
- **`scripts/hooks/player-access.mjs`** (new)
  - `checkPlayerAccessOnLogin()`: reads settings (guarded — MEJ's key may be
    unregistered), applies `shouldOfferPlayerAccess`, prompts, applies
    `playerAccessWrites`, toasts. Fire-and-forget from the ready hook so it
    never delays anything else.
  - `registerPlayerAccessReloadPrompt()`: `Hooks.on("updateSetting", …)`
    applying `shouldPromptReload`. The previous value is cached at ready and
    refreshed on each update, because `updateSetting` does not carry the old
    value.
- **`scripts/campaign-companion.mjs`**: register `warnPlayerAccess` at init
  with the other settings; call `registerPlayerAccessReloadPrompt()` and
  `checkPlayerAccessOnLogin()` from the ready hook after `onReady()` (MEJ
  present only).
- **`scripts/constants.mjs`**: `WARN_PLAYER_ACCESS_SETTING`.
- **`lang/en.json`**: every string above, under
  `MEJCampaignCompanion.playerAccess.*` and
  `MEJCampaignCompanion.settings.warnPlayerAccess.{name,hint}`.
- **`CHANGELOG.md`**: Unreleased → Added entry.
- **Docs:** one paragraph in the GM guide's setup section that players need
  MEJ's "Allow players to use Enhanced Journal", and that the companion now
  offers to turn it on.

Works unchanged on Foundry 13 + MEJ 13.06 and Foundry 14 + MEJ 14.x: the
setting key and `game.settings` API are identical.

## Testing

### Unit (vitest)

`test/player-access.test.js`: every branch of `shouldOfferPlayerAccess`
(GM/player, setting on/off/unregistered, warn on/off),
`shouldPromptReload` (GM vs player, other keys, off→on, on→on, on→off,
undefined→on), and `playerAccessWrites` for all four button × checkbox
combinations.

### e2e — new spec `29-player-access-check.spec.mjs`

Run on v14 World A and v13 World B (`npm run e2e` / `npm run e2e:v13`).
Each test saves and restores both `allow-player` and `warnPlayerAccess`.

1. `allow-player` off, warn on → GM login shows the dialog; **Enable for
   players** sets `allow-player` true; a connected User 1 sees the reload
   prompt; after Reload, User 1 creates a Person in a campaign folder and it
   opens in MEJ's window (the original report).
2. Tick **Don't show this again** + **Not now** → `warnPlayerAccess` is
   false, `allow-player` still off; next GM login shows no dialog.
3. A player login with `allow-player` off never shows the dialog.
4. `allow-player` already on → GM login shows no dialog.

Other specs are unaffected: the harness's global setup already turns
`allow-player` on (`ensureMejPlayerAccess()`), so the dialog never appears
during them.

## Out of scope

- Forcing campaign entries into MEJ for players while the setting stays off
  (would override a GM-owned MEJ setting; rejected in chat).
- Any change to MEJ.
