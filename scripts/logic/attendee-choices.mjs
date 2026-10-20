// Rows for the "Who's playing tonight?" checklist. Pure.

/**
 * @param {{ contributorUserIds: string[], users: {id:string,name:string,isGM:boolean,characterUuid:string|null}[],
 *   current: string[], actorOf: (uuid:string)=>({name:string,img:string}|null) }} args
 * @returns {{ rows: {uuid:string,name:string,img:string,player:string,checked:boolean}[], source: "contributors"|"allPlayers"|"none" }}
 */
export function attendeeChoices({ contributorUserIds, users, current, actorOf }) {
  const withCharacter = users.filter((u) => !u.isGM && u.characterUuid);
  const contributors = withCharacter.filter((u) => contributorUserIds.includes(u.id));
  let source = "contributors";
  let chosen = contributors;
  if (!chosen.length) { chosen = withCharacter; source = "allPlayers"; }
  if (!chosen.length) source = "none";

  const entries = chosen.map((u) => ({ uuid: u.characterUuid, player: u.name }));
  for (const uuid of current) entries.push({ uuid, player: "" });

  const seen = new Set();
  const rows = [];
  for (const { uuid, player } of entries) {
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    const actor = actorOf(uuid);
    rows.push({
      uuid,
      name: actor?.name ?? uuid,
      img: actor?.img ?? "",
      player,
      checked: current.length === 0 || current.includes(uuid)
    });
  }
  return { rows, source };
}
