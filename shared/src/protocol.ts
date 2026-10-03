// Every WebSocket message is a small JSON object with a "t" (type) field.
// Client and server import these types so both sides agree on the shape.

export type Vec3 = [number, number, number];

// ---- Client -> Server ----

// room = a level id from shared/src/levels (e.g. "trial1").
export type HelloMsg = { t: "hello"; name: string; room: string };
// p = capsule center position, ry = yaw (facing direction) in radians.
// tp = the number of the last server teleport the client has applied. The
// server ignores moves sent before the client saw its latest teleport.
export type MoveMsg = { t: "move"; p: Vec3; ry: number; tp: number };
// "I fell off the level, put me somewhere safe."
export type RespawnMsg = { t: "respawn" };

// Parkour: go back to the start and reset the run.
export type RestartMsg = { t: "restart" };

export type ClientMsg = HelloMsg | MoveMsg | RespawnMsg | RestartMsg;

// ---- Server -> Client ----

export type PlayerInfo = { id: number; name: string; p: Vec3; ry: number };

export type WelcomeMsg = { t: "welcome"; id: number; room: string; spawn: Vec3; time: number; players: PlayerInfo[] };
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
  | LeaderboardMsg;
