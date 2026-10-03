// Every WebSocket message is a small JSON object with a "t" (type) field.
// Client and server import these types so both sides agree on the shape.

import type { PickupKind, SpellId } from "./combat.ts";

export type Vec3 = [number, number, number];

// ---- Client -> Server ----

// room = a room id from shared/src/rooms.ts (e.g. "trial1", "tag"). Your
// name comes from your account (the login cookie), not from this message.
// from = the room you just left, if any: the hub puts you in front of that
// room's portal.
export type HelloMsg = { t: "hello"; room: string; from?: string };
// p = capsule center position, ry = yaw (facing direction) in radians.
// tp = the number of the last server teleport the client has applied. The
// server ignores moves sent before the client saw its latest teleport.
export type MoveMsg = { t: "move"; p: Vec3; ry: number; tp: number };
// "I fell off the level, put me somewhere safe."
export type RespawnMsg = { t: "respawn" };

// Parkour: go back to the start and reset the run.
export type RestartMsg = { t: "restart" };

// Tag / infection: "I'm touching this player." The server checks it.
export type TagMsg = { t: "tag"; target: number };

// Tag / infection: add or remove a server-side bot.
export type BotsMsg = { t: "bots"; action: "add" | "remove" };

// Battle royale: cast a spell from o (your eyes) in direction d (unit
// vector). seq numbers your casts, so you can match the server's reply to the
// spell you're already drawing.
export type CastMsg = { t: "cast"; spell: SpellId; o: Vec3; d: Vec3; seq: number };

export type ClientMsg = HelloMsg | MoveMsg | RespawnMsg | RestartMsg | TagMsg | BotsMsg | CastMsg;

// ---- Server -> Client ----

export type PlayerInfo = { id: number; name: string; p: Vec3; ry: number };

// yaw: which way to face, if the room has an opinion (else the level's spawnYaw).
export type WelcomeMsg = { t: "welcome"; id: number; room: string; spawn: Vec3; yaw?: number; time: number; players: PlayerInfo[] };
export type JoinMsg = { t: "join"; player: PlayerInfo; time: number };
export type LeaveMsg = { t: "leave"; id: number };
// Another player's position, relayed by the server. "time" is the server clock
// (ms) when the server received it, which clients use for interpolation.
export type MovedMsg = { t: "moved"; id: number; p: Vec3; ry: number; time: number };
// The server moves your player: a respawn, or a snap back after a rejected move.
export type TeleportMsg = { t: "teleport"; p: Vec3; tp: number };
export type ErrorMsg = { t: "error"; message: string };
// A line of text for everyone in the room ("Alice finished in 41.23 s").
export type AnnounceMsg = { t: "announce"; text: string };

// ---- Parkour (server -> one player). Times are milliseconds. ----
// The server decides all of these; the client only displays them.
export type RunStartMsg = { t: "runStart"; time: number }; // server clock at start
export type CheckpointMsg = { t: "checkpoint"; reached: number; count: number; split: number };
export type FinishMsg = { t: "finish"; time: number; best: number; newBest: boolean };
export type RunResetMsg = { t: "runReset" };
// Best times in this room (to everyone).
export type LeaderboardMsg = { t: "leaderboard"; entries: { name: string; time: number }[] };

// ---- Tag and infection (server -> everyone in the room) ----
export type RoundState = "waiting" | "countdown" | "playing" | "ended";
// endsAt: server clock when this state ends (null while waiting for players).
export type RoundMsg = { t: "round"; state: RoundState; endsAt: number | null };
// Who is currently chasing: "It" in tag, the cursed in infection. Sent in full
// whenever it changes (it's a short list).
export type ChasersMsg = { t: "chasers"; ids: number[] };
export type TaggedMsg = { t: "tagged"; by: number; victim: number };
export type RoundResultMsg = { t: "roundResult"; title: string; lines: string[] };
export type BotCountMsg = { t: "botCount"; count: number; max: number };

// ---- Hub (server -> everyone in the hub) ----
// How many people (not bots) are in each room, for the portal signs.
export type RoomCountsMsg = { t: "roomCounts"; counts: Record<string, number> };

// ---- Battle royale (server -> everyone in the room) ----
// A spell is flying. Clients draw it moving from o along d at its speed,
// starting at server time `time`.
export type SpellMsg = { t: "spell"; id: number; caster: number; seq: number; spell: SpellId; o: Vec3; d: Vec3; time: number };
// It hit something at p (hit = the player it struck directly, if any).
export type SpellEndMsg = { t: "spellEnd"; id: number; p: Vec3; hit: number | null };
export type HealthMsg = { t: "health"; id: number; hp: number; shield: number };
// Who is still in the round (everyone else is spectating). Sent in full on change.
export type AliveMsg = { t: "alive"; ids: number[] };
// The storm's current stage: the safe circle is `from` until shrinkAt, then
// moves to `to` by endsAt. Circles are [x, z, radius]. null = no storm.
export type ZoneState = { from: [number, number, number]; to: [number, number, number]; shrinkAt: number; endsAt: number; dps: number };
export type ZoneMsg = { t: "zone"; zone: ZoneState | null };
export type PickupInfo = { id: number; kind: PickupKind; p: Vec3 };
export type PickupsMsg = { t: "pickups"; items: PickupInfo[] };
// To one player: your fireball charges.
export type ChargesMsg = { t: "charges"; fireball: number };

// ---- Progression (server -> one player) ----
// total = your XP after this award. The client works out the level from it.
export type XpMsg = { t: "xp"; amount: number; reason: string; total: number };

export type ServerMsg =
  | WelcomeMsg
  | JoinMsg
  | LeaveMsg
  | MovedMsg
  | TeleportMsg
  | ErrorMsg
  | AnnounceMsg
  | RunStartMsg
  | CheckpointMsg
  | FinishMsg
  | RunResetMsg
  | LeaderboardMsg
  | RoundMsg
  | ChasersMsg
  | TaggedMsg
  | RoundResultMsg
  | BotCountMsg
  | RoomCountsMsg
  | SpellMsg
  | SpellEndMsg
  | HealthMsg
  | AliveMsg
  | ZoneMsg
  | PickupsMsg
  | ChargesMsg
  | XpMsg;
