// Every room players can join. A room is a level plus a game mode; several
// rooms could share a level (tag and infection each have their own now). You
// arrive in the hub and walk through its portals to reach the others.

export type RoomMode = "hub" | "free" | "parkour" | "tag" | "infection" | "royale" | "boss";

export type RoomInfo = {
  id: string;
  name: string;
  levelId: string; // key in shared/src/levels
  mode: RoomMode;
};

export const HUB_ROOM = "hub";

export const ROOMS: RoomInfo[] = [
  { id: HUB_ROOM, name: "The Academy", levelId: "academy", mode: "hub" },
  { id: "trial1", name: "Trial I: The Floating Steps", levelId: "trial1", mode: "parkour" },
  { id: "trial2", name: "Trial II: The Spiral Spire", levelId: "trial2", mode: "parkour" },
  { id: "trial3", name: "Trial III: The Shattered Bridge", levelId: "trial3", mode: "parkour" },
  { id: "trial4", name: "Trial IV: The Storm Gate", levelId: "trial4", mode: "parkour" },
  { id: "trial5", name: "Trial V: The Hollow Stair", levelId: "trial5", mode: "parkour" },
  { id: "trial6", name: "Trial VI: The Eye of the Storm", levelId: "trial6", mode: "parkour" },
  { id: "trial7", name: "Trial VII: The Tyrant's Crown", levelId: "trial7", mode: "boss" },
  { id: "tag", name: "Tag: The Clocktower Gardens", levelId: "clocktower", mode: "tag" },
  { id: "infection", name: "Infection: The Moonlit Graveyard", levelId: "graveyard", mode: "infection" },
  { id: "royale", name: "Battle Royale: Last Wizard Standing", levelId: "arena", mode: "royale" },
  { id: "playground", name: "Playground", levelId: "playground", mode: "free" },
];

export function findRoom(id: string): RoomInfo | undefined {
  return ROOMS.find((room) => room.id === id);
}
