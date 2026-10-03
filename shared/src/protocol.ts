// Every WebSocket message is a small JSON object with a "t" (type) field.
// Client and server import these types so both sides agree on the shape.

export type Vec3 = [number, number, number];

// ---- Client -> Server ----

export type HelloMsg = { t: "hello"; name: string };
// p = capsule center position, ry = yaw (facing direction) in radians
export type MoveMsg = { t: "move"; p: Vec3; ry: number };

export type ClientMsg = HelloMsg | MoveMsg;

// ---- Server -> Client ----

export type PlayerInfo = { id: number; name: string; p: Vec3; ry: number };

export type WelcomeMsg = { t: "welcome"; id: number; room: string; spawn: Vec3; time: number; players: PlayerInfo[] };
export type JoinMsg = { t: "join"; player: PlayerInfo; time: number };
export type LeaveMsg = { t: "leave"; id: number };
// Another player's position, relayed by the server. "time" is the server clock
// (ms) when the server received it, which clients use for interpolation.
export type MovedMsg = { t: "moved"; id: number; p: Vec3; ry: number; time: number };
export type ErrorMsg = { t: "error"; message: string };

export type ServerMsg = WelcomeMsg | JoinMsg | LeaveMsg | MovedMsg | ErrorMsg;
