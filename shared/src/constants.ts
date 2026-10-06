// Numbers that both the client and the server must agree on.
// The client uses the movement values to move the player; the server will use
// the same values (Phase 2) to reject updates that imply impossible speed.

// How often clients send their position and the server sends snapshots (per second).
export const NET_RATE_HZ = 20;
export const NET_INTERVAL_MS = 1000 / NET_RATE_HZ;

// Movement, in meters and seconds.
export const WALK_SPEED = 4.5;
export const RUN_SPEED = 8;
export const JUMP_SPEED = 7;
export const GRAVITY = 20;
export const TERMINAL_FALL_SPEED = 40;

// Player capsule: total height = 2 * (halfHeight + radius) = 1.8 m.
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HALF_HEIGHT = 0.55;
export const EYE_HEIGHT = 0.7; // camera height above the capsule center
// Crouching (hold C) takes this much off the top: 1.2 m tall instead of 1.8,
// at half walking speed. Positions sent over the network stay where the
// standing capsule's center would be (0.9 m above the feet) either way.
export const CROUCH_DROP = 0.6;
export const CROUCH_SPEED = 0.5;

// Falling below this height means you fell off the level; the client asks the
// server to respawn it.
export const FALL_RESPAWN_Y = -30;

// Limits on what clients may send.
export const MAX_NAME_LENGTH = 16;
export const MAX_MESSAGE_BYTES = 512;
export const MAX_PLAYERS_PER_ROOM = 16;

// Tag and infection. Distances are between capsule centers; two players
// touching are 2 * PLAYER_RADIUS = 0.7 m apart.
export const TAG_RANGE = 2.2;
