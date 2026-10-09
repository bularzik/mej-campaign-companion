// Player name shown under an attendee token on the Session sheet: the non-GM
// user whose assigned character is the actor, else the first non-GM owner.
// Empty string when no player is tied to the actor (an NPC, say).
export function attendeePlayerName(actor, users) {
  if (!actor) return "";
  const players = [...users].filter((u) => !u.isGM);
  const assigned = players.find((u) => u.character?.id === actor.id);
  if (assigned) return assigned.name;
  const owner = players.find((u) => actor.testUserPermission(u, "OWNER"));
  return owner?.name ?? "";
}
