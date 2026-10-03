// Every room players can join. A room is a level plus a game mode; several
// rooms can share a level (tag and infection both use the courtyard). You
// arrive in the hub and walk through its portals to reach the others.

export type RoomMode = "hub" | "free" | "parkour" | "tag" | "infection";

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
  { id: "tag", name: "Tag", levelId: "courtyard", mode: "tag" },
  { id: "infection", name: "Infection: The Spreading Curse", levelId: "courtyard", mode: "infection" },
  { id: "playground", name: "Playground", levelId: "playground", mode: "free" },
];

export function findRoom(id: string): RoomInfo | undefined {
  return ROOMS.find((room) => room.id === id);
}
