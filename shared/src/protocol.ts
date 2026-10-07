// Every WebSocket message is a small JSON object with a "t" (type) field.
// Client and server import these types so both sides agree on the shape.

import type { ClassId, Hand, WeaponId } from "./classes.ts";
import type { PickupKind, PowerupKind, SpellId } from "./combat.ts";
import type { Box } from "./levels/types.ts";
import type { Hat, Look, PrimarySpell, Robe } from "./unlocks.ts";
import type { Appearance } from "./appearance.ts";
import type { MonsterKind, MonsterState } from "./monsters.ts";
import type { BossKind, BossShot, StrikeKind } from "./bosses.ts";
import type { AbilityId, FieldInfo } from "./abilities.ts";

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
// c = crouching (p stays the standing capsule's center, 0.9 m above the feet).
export type MoveMsg = { t: "move"; p: Vec3; ry: number; tp: number; c?: true };
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

// Change what you use and wear (the Spellbook and Wardrobe in the hub). The
// server checks each choice is unlocked, saves it, and shows others your look.
export type LoadoutMsg = { t: "loadout"; primary: PrimarySpell; hat: Hat; robe: Robe } & Appearance;

// Battle royale classes: use the weapon in your hand (a swing, or a bow
// shot from o along d), switch hands, or pick a class.
export type AttackMsg = { t: "attack"; o: Vec3; d: Vec3; seq: number };
export type HandMsg = { t: "hand"; hand: Hand };
export type ClassMsg = { t: "class"; cls: ClassId };
// Use a class ability: slot 0 is E, 1 is R. o and d: your eyes and aim.
export type AbilityMsg = { t: "ability"; slot: 0 | 1; o: Vec3; d: Vec3 };
// Choose a class's E and R abilities (level 11+ gives more to choose from).
export type AbilitiesMsg = { t: "abilities"; cls: ClassId; e: AbilityId; r: AbilityId };
// The battle royale's mode, set for the next round by anyone (a toggle).
export type RoyaleMode = "ffa" | "teams";
export type ModeMsg = { t: "mode"; mode: RoyaleMode };
// Team rounds: the team you want (0 red, 1 blue; null: either).
export type PickTeamMsg = { t: "pickTeam"; team: 0 | 1 | null };
// A bot's class, and its team in team rounds (anyone can set them).
export type BotSetMsg = { t: "botSet"; id: number; cls?: ClassId; team?: 0 | 1 };
// Vote to start the next round (toggles; battle royale and boss fight).
export type ReadyMsg = { t: "ready" };
// Tag and infection: pick the next round's map; respawn when stuck.
export type ChaseMapMsg = { t: "chaseMap"; map: string };
export type UnstuckMsg = { t: "unstuck" };
// Tag and infection: turn the Knight's grapple on or off for the room, and use it (E).
export type ChaseSettingMsg = { t: "chaseSetting"; grapple?: boolean; powerups?: boolean };
export type GrappleMsg = { t: "grapple"; d: Vec3 };
// Vote for the next arena (a level id from the options offered).
export type VoteMsg = { t: "vote"; arena: string };
// Battle royale: add or remove a monster.
// kind: which monster to let in (the arena's Esc panel), or a mix.
export type MonstersCtlMsg = { t: "monsters"; action: "add" | "remove"; kind?: MonsterKind | "mixed" };

// Battle royale: use the powerup you're carrying (F).
export type UsePowerupMsg = { t: "usePowerup" };

export type ClientMsg = UsePowerupMsg | HelloMsg | MoveMsg | RespawnMsg | RestartMsg | TagMsg | BotsMsg | CastMsg | LoadoutMsg | AttackMsg | HandMsg | ClassMsg | VoteMsg | AbilityMsg | MonstersCtlMsg | AbilitiesMsg | ModeMsg | PickTeamMsg | BotSetMsg | ReadyMsg | ChaseMapMsg | UnstuckMsg | ChaseSettingMsg | GrappleMsg;

// ---- Server -> Client ----

// admin: shown with a gold name tag.
export type PlayerInfo = { id: number; name: string; p: Vec3; ry: number; look: Look; admin: boolean };

// yaw: which way to face, if the room has an opinion (else the level's spawnYaw).
export type WelcomeMsg = { t: "welcome"; id: number; room: string; spawn: Vec3; yaw?: number; time: number; players: PlayerInfo[] };
export type JoinMsg = { t: "join"; player: PlayerInfo; time: number };
export type LeaveMsg = { t: "leave"; id: number };
// Another player's position, relayed by the server. "time" is the server clock
// (ms) when the server received it, which clients use for interpolation.
export type MovedMsg = { t: "moved"; id: number; p: Vec3; ry: number; time: number; c?: true };
// The server moves your player: a respawn, or a snap back after a rejected move.
export type TeleportMsg = { t: "teleport"; p: Vec3; tp: number; yaw?: number };
export type ErrorMsg = { t: "error"; message: string };
// A line of text for everyone in the room ("Alice finished in 41.23 s").
export type AnnounceMsg = { t: "announce"; text: string };

// ---- Parkour (server -> one player). Times are milliseconds. ----
// The server decides all of these; the client only displays them.
export type RunStartMsg = { t: "runStart"; time: number }; // server clock at start
export type CheckpointMsg = { t: "checkpoint"; reached: number; count: number; split: number };
// firstClear: the first time you finished this course (it completes a chapter).
export type FinishMsg = { t: "finish"; time: number; best: number; newBest: boolean; firstClear: boolean };
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
// k numbers the projectiles of one cast (Spark Volley makes 3).
export type SpellMsg = { t: "spell"; id: number; caster: number; seq: number; k: number; spell: SpellId; o: Vec3; d: Vec3; time: number };
// It hit something at p (hit = the player it struck directly, if any).
export type SpellEndMsg = { t: "spellEnd"; id: number; p: Vec3; hit: number | null };
// max: that player's class health. shield: the Ward pickup's extra.
export type HealthMsg = { t: "health"; id: number; hp: number; max: number; shield: number };
// What someone is fighting as and holding (sent to everyone when it changes).
export type EquipMsg = { t: "equip"; id: number; cls: ClassId; hand: Hand };
// A melee swing: who swung what, who got hit, and whose shield blocked it.
export type MeleeMsg = { t: "melee"; id: number; weapon: WeaponId; hits: number[]; blocked: number[]; backstabs: number[] };
// Who is still in the round (everyone else is spectating). Sent in full on change.
export type AliveMsg = { t: "alive"; ids: number[] };
// The storm's current stage: the safe circle is `from` until shrinkAt, then
// moves to `to` by endsAt. Circles are [x, z, radius]. null = no storm.
export type ZoneState = { from: [number, number, number]; to: [number, number, number]; shrinkAt: number; endsAt: number; dps: number };
export type ZoneMsg = { t: "zone"; zone: ZoneState | null };
export type PickupInfo = { id: number; kind: PickupKind; p: Vec3 };
export type PickupsMsg = { t: "pickups"; items: PickupInfo[] };
// Someone was hit by Frost Shard: slowed for ms (the player slows themselves).
export type SlowedMsg = { t: "slowed"; id: number; ms: number };
// To one player: the powerup you're carrying (null: none).
export type HeldMsg = { t: "held"; kind: PowerupKind | null };
// To one player: your fireball charges.
export type ChargesMsg = { t: "charges"; fireball: number };

// The arena changed (rebuild the world from this level).
export type ArenaMsg = { t: "arena"; levelId: string };
// The arenas you can vote for next, and the votes so far. Empty: no vote open.
// modes: the mode vote's tally (next to the arena vote).
export type ArenaVoteMsg = { t: "arenaVote"; options: string[]; votes: Record<string, number>; modes?: Record<RoyaleMode, number> };
// A wizard conjured a wall or pillar (ms: how long it has left), and when
// it's gone.
export type ConjureMsg = { t: "conjure"; id: number; box: Box; ms: number };
export type UnconjureMsg = { t: "unconjure"; id: number };
// Someone vanished, fortified, charged or shadow-stepped (ms 0: it ended).
export type EffectKind = "stealth" | "fortify" | "charge" | "blink" | "invert" | "giant" | "glide" | "shockwave" | "chain" | "heal" | "aegis" | "judgment" | "spin" | "windstep" | "burn" | "freeze" | "whirlwind" | "frostnova" | "holynova" | "cyclone" | "fists" | "dragon" | "ascend" | "rally" | "rock" | "haste" | "quadjump" | "fury";
// id: who it's on (for chain: who was pulled; from = the Knight's position).
export type EffectMsg = { t: "effect"; id: number; kind: EffectKind; ms: number; from?: Vec3; to?: Vec3 };
// Level 11+ abilities: areas on the ground, being thrown, and Rogue copies.
export type FieldMsg = { t: "field"; field: FieldInfo };
export type FieldEndMsg = { t: "fieldEnd"; id: number };
// To one player: you're thrown (horizontal velocity for `s` seconds, and up).
export type KnockMsg = { t: "knock"; v: Vec3; s: number };
export type DecoyState = { id: number; owner: number; p: Vec3; ry: number };
export type DecoysMsg = { t: "decoys"; list: DecoyState[] };
// To one player: the abilities you have on E and R (after picking, or joining).
export type AbilitySetMsg = { t: "abilitySet"; e: AbilityId; r: AbilityId };
// A team round: who's on which team (0 red, 1 blue); null when it isn't one.
export type TeamsMsg = { t: "teams"; teams: [number[], number[]] | null };
// Everyone in the arena with their class and team choice, and the mode
// (now, and for the next round). Sent whenever any of it changes.
// team: the team they're on in this round (or, between rounds, the one they
// picked); pick: the team they picked for the next round.
export type LineupEntry = { id: number; name: string; bot: boolean; cls: ClassId; team: 0 | 1 | null; pick: 0 | 1 | null };
export type LineupMsg = { t: "lineup"; players: LineupEntry[]; mode: RoyaleMode; next: RoyaleMode };
// Tag and infection: the maps on offer, this round's and the next one's.
export type ChaseMapsMsg = { t: "chaseMaps"; maps: string[]; current: string; next: string };
export type ChaseSettingsMsg = { t: "chaseSettings"; grapple: boolean; powerups: boolean };
// Capture the flag: the score, and each team's flag (red, blue): at its
// stand, carried by someone, or dropped somewhere.
export type CtfFlag = { state: "home" | "carried" | "dropped"; p: Vec3; carrier: number | null };
export type CtfMsg = { t: "ctf"; score: [number, number]; flags: [CtfFlag, CtfFlag]; toWin: number };
// To one player: you're knocked out, and back in this many ms (capture the flag).
export type RespawnInMsg = { t: "respawnIn"; ms: number };
// Horde mode: the wave you're on, monsters still to beat (alive and on the
// way), when the next wave comes (between waves; server time), and the
// room's best wave so far.
export type HordeMsg = { t: "horde"; wave: number; left: number; nextAt: number | null; best: number };
// Who has voted to start the next round, and how many votes it needs.
// on: false when the vote is switched off (tests).
export type ReadyStateMsg = { t: "readyState"; ids: number[]; needed: number; on: boolean };
// To one player: an ability you tried didn't work (cooldown refunded).
export type AbilityFailedMsg = { t: "abilityFailed"; slot: 0 | 1; reason: string };
// You landed on someone: bounce off.
export type BounceMsg = { t: "bounce" };

// ---- Phase 16: arena features, monsters, bosses, trial tasks ----
// Someone stepped on a teleporter (everyone sees the flash at both ends).
export type WarpMsg = { t: "warp"; id: number; from: Vec3; to: Vec3 };
// Every monster, ~10 times a second while there are any.
export type MonstersMsg = { t: "monsters"; list: MonsterState[] };
// One went down (by: who finished it off, if anyone).
export type MonsterDiedMsg = { t: "monsterDied"; id: number; kind: MonsterKind; by: number | null };
export type MonsterCountMsg = { t: "monsterCount"; count: number; max: number };
// A trial's boss: where it is, its health, and what it's doing.
export type BossMsg = { t: "boss"; kind: BossKind; p: Vec3; ry: number; hp: number; max: number; state: "sleep" | "fight" | "dead"; windup: boolean };
export type BossShotMsg = { t: "bossShot"; shot: BossShot };
export type BossShotEndMsg = { t: "bossShotEnd"; id: number; p: Vec3 };
export type BossWaveMsg = { t: "bossWave"; o: Vec3; time: number };
// r and kind: the Tyrant's bigger circles (default STRIKE_RADIUS, lightning).
export type BossStrikeMsg = { t: "bossStrike"; p: Vec3; at: number; r?: number; kind?: StrikeKind };
// To one player: hearts left in a boss fight.
export type HeartsMsg = { t: "hearts"; hearts: number; max: number };
// To one player: progress on a trial task (orbs collected, runes in order,
// a boss beaten). got: which orbs/runes so far; done: all of it.
export type TaskMsg = { t: "task"; id: string; got: number[]; done: boolean; wrong?: boolean };

// ---- Looks and loadout ----
// Someone changed their hat or robe.
export type LookMsg = { t: "look"; id: number; look: Look };
// To one player: your saved loadout (after a "loadout" request).
export type LoadoutSavedMsg = { t: "loadoutSaved"; primary: PrimarySpell; hat: Hat; robe: Robe; cls: ClassId } & Appearance;

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
  | HeldMsg
  | SlowedMsg
  | LookMsg
  | LoadoutSavedMsg
  | EquipMsg
  | MeleeMsg
  | ArenaMsg
  | ArenaVoteMsg
  | BounceMsg
  | ConjureMsg
  | UnconjureMsg
  | EffectMsg
  | FieldMsg
  | FieldEndMsg
  | KnockMsg
  | DecoysMsg
  | AbilitySetMsg
  | TeamsMsg
  | ReadyStateMsg
  | LineupMsg
  | ChaseMapsMsg
  | ChaseSettingsMsg
  | CtfMsg
  | HordeMsg
  | RespawnInMsg
  | AbilityFailedMsg
  | WarpMsg
  | MonstersMsg
  | MonsterDiedMsg
  | MonsterCountMsg
  | BossMsg
  | BossShotMsg
  | BossShotEndMsg
  | BossWaveMsg
  | BossStrikeMsg
  | HeartsMsg
  | TaskMsg
  | XpMsg;
