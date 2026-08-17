// Pure resolution of which Monk's Enhanced Journal this client is talking to.
// No Foundry globals - the caller supplies the three facts.
//
//  - api:    MEJ fired setupMonksEnhancedJournal, so the extension API exists
//            and the Session sheet / Hub integrate into MEJ's shell.
//  - native: MEJ is installed but has no extension API (stock upstream), or
//            the user forced native mode. Core features run; the Session
//            sheet and Hub become standalone windows.
//  - absent: MEJ is not active at all. The companion stays inert - MEJ is a
//            hard dependency, "without the API" is not "without MEJ".
export const MODE_API = "api";
export const MODE_NATIVE = "native";
export const MODE_ABSENT = "absent";

/**
 * @param {object} facts
 * @param {boolean} facts.handshakeFired  did setupMonksEnhancedJournal fire?
 * @param {boolean} facts.mejActive       is the MEJ module active?
 * @param {boolean} [facts.forceNative]   forceNativeMode client setting
 * @returns {"api"|"native"|"absent"}
 */
export function resolveMode({ handshakeFired, mejActive, forceNative = false }) {
  if (!mejActive) return MODE_ABSENT;
  if (forceNative) return MODE_NATIVE;
  return handshakeFired ? MODE_API : MODE_NATIVE;
}
