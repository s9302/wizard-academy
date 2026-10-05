// Capture the flag, played with the battle royale's classes and combat in
// two teams (RoyaleRoom with team rounds always on, no storm, no vote).
//
// Each team has a flag at its keep. Walk over the enemy's flag to take it;
// carry it to your own flag stand while your own flag is home to score. If
// the carrier is knocked out, the flag drops where they fell: an enemy can
// pick it up again, a teammate touching it sends it home, and it goes home
// by itself after a while. Knocked-out players come back at their keep after
// a few seconds. First team to TO_WIN captures, or the higher score when
// time runs out, wins.

import type { Level } from "../../../shared/src/levels/types.ts";
import type { CtfFlag, Vec3 } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { SCALE } from "./RoundRoom.ts";
import { RoyaleRoom } from "./RoyaleRoom.ts";

const TO_WIN = 3;
const ROUND_MS = 10 * 60_000 * SCALE;
const RESPAWN_MS = 5_000;
const FLAG_REACH = 1.7; // meters (flat) to take, return or capture a flag
const DROP_RETURN_MS = 20_000; // a dropped flag goes home by itself
const TEAM = ["Red", "Blue"];

type Flag = CtfFlag & { returnAt: number };

export class CtfRoom extends RoyaleRoom {
  private stands: [Vec3, Vec3];
  private flags: [Flag, Flag];
  private score: [number, number] = [0, 0];
  private comeBackAt = new Map<number, number>(); // knocked-out players: back at their keep then

  constructor(info: RoomInfo, level: Level) {
    super(info, level, null);
    if (!level.ctf) throw new Error(`${level.id} has no flags`);
    this.stands = level.ctf.flags;
    this.flags = [this.homeFlag(0), this.homeFlag(1)];
    this.teamsMode = true;
    this.stormOn = false;
    this.voting = false;
  }

  private homeFlag(team: 0 | 1): Flag {
    return { state: "home", p: [...this.stands[team]], carrier: null, returnAt: 0 };
  }

  private broadcastCtf(): void {
    const flags = this.flags.map(({ state, p, carrier }) => ({ state, p, carrier })) as [CtfFlag, CtfFlag];
    this.broadcast({ t: "ctf", score: this.score, flags, toWin: TO_WIN });
  }

  // ---- The round ----

  protected override roundMs(): number {
    return ROUND_MS;
  }

  protected override playStartText(): string {
    return `Capture the flag! Take the enemy's flag to your own stand. First to ${TO_WIN} wins.`;
  }

  protected override onPlayStart(now: number): void {
    super.onPlayStart(now); // makes the teams
    this.score = [0, 0];
    this.flags = [this.homeFlag(0), this.homeFlag(1)];
    this.comeBackAt.clear();
    for (const p of this.players.values()) this.toKeep(p);
    this.broadcastCtf();
  }

  // Back to your team's keep.
  private toKeep(player: Player): void {
    const team = this.teamOf(player.conn.id);
    const spawns = team === undefined ? null : this.level.ctf!.spawns[team];
    if (spawns?.length) this.teleport(player, spawns[Math.floor(Math.random() * spawns.length)]);
  }

  protected override isRoundOver(): boolean {
    return this.score[0] >= TO_WIN || this.score[1] >= TO_WIN;
  }

  private winner(): 0 | 1 | null {
    return this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1;
  }

  protected override results(): { title: string; lines: string[] } {
    const w = this.winner();
    return {
      title: w === null ? `A draw, ${this.score[0]} to ${this.score[1]}!` : `${TEAM[w]} wins, ${this.score[w]} to ${this.score[1 - w]}!`,
      lines: [`Red ${this.score[0]} — ${this.score[1]} Blue`],
    };
  }

  protected override xpAwards(): { id: number; amount: number; reason: string }[] {
    const w = this.winner();
    const awards: { id: number; amount: number; reason: string }[] = [];
    for (const id of this.players.keys()) {
      awards.push({ id, amount: XP.roundPlayed, reason: "Round played" });
      if (w !== null && this.teamOf(id) === w) awards.push({ id, amount: XP.teamWin, reason: "Your team won" });
    }
    return awards;
  }

  protected override onRoundEnded(): void {
    super.onRoundEnded();
    this.comeBackAt.clear();
  }

  // ---- Knocked out: drop the flag, come back in a moment ----

  protected override onEliminated(target: Player): void {
    this.dropFlagOf(target);
    if (this.state === "playing") {
      this.comeBackAt.set(target.conn.id, Date.now() + RESPAWN_MS);
      if (!target.conn.isBot) target.conn.send({ t: "respawnIn", ms: RESPAWN_MS });
    }
  }

  protected override onLeftRound(player: Player): void {
    this.dropFlagOf(player);
    this.comeBackAt.delete(player.conn.id);
    super.onLeftRound(player);
  }

  private dropFlagOf(player: Player): void {
    for (const flag of this.flags) {
      if (flag.carrier !== player.conn.id) continue;
      flag.state = "dropped";
      flag.carrier = null;
      flag.p = [player.p[0], player.p[1] - 0.6, player.p[2]];
      flag.returnAt = Date.now() + DROP_RETURN_MS;
      this.broadcast({ t: "announce", text: `${player.conn.name} dropped the ${TEAM[this.flags.indexOf(flag)]} flag!` });
      this.broadcastCtf();
    }
  }

  protected override onRoundTick(now: number): void {
    super.onRoundTick(now);
    if (this.state !== "playing") return;
    for (const [id, at] of this.comeBackAt) {
      if (now < at) continue;
      this.comeBackAt.delete(id);
      const player = this.players.get(id);
      if (!player) continue;
      this.resetFighter(player);
      this.alive.add(id);
      this.broadcast({ t: "alive", ids: [...this.alive] });
      this.toKeep(player);
    }
    this.flags.forEach((flag, team) => {
      if (flag.state === "dropped" && now >= flag.returnAt) {
        this.flags[team] = this.homeFlag(team as 0 | 1);
        this.broadcast({ t: "announce", text: `The ${TEAM[team]} flag went home.` });
        this.broadcastCtf();
      }
    });
  }

  // ---- Taking, returning and capturing ----

  protected override onPlayerMoved(player: Player, from: Vec3, to: Vec3, now: number): void {
    super.onPlayerMoved(player, from, to, now);
    const id = player.conn.id;
    const team = this.teamOf(id);
    if (this.state !== "playing" || team === undefined || !this.alive.has(id)) return;
    const near = (p: Vec3) => Math.hypot(p[0] - to[0], p[2] - to[2]) < FLAG_REACH && Math.abs(p[1] - (to[1] - 0.9)) < 2.5;
    const mine = this.flags[team];
    const theirs = this.flags[1 - team];
    // Your own flag, dropped: touch it to send it home.
    if (mine.state === "dropped" && near(mine.p)) {
      this.flags[team] = this.homeFlag(team);
      this.broadcast({ t: "announce", text: `${player.conn.name} returned the ${TEAM[team]} flag.` });
      this.broadcastCtf();
    }
    // The enemy's flag, at their stand or dropped: take it.
    if (theirs.state !== "carried" && near(theirs.p)) {
      theirs.state = "carried";
      theirs.carrier = id;
      this.broadcast({ t: "announce", text: `${player.conn.name} has the ${TEAM[1 - team]} flag!` });
      this.broadcastCtf();
    }
    // Carrying it home while your own flag is there: a capture.
    if (theirs.carrier === id && mine.state === "home" && near(this.stands[team])) {
      this.score[team] += 1;
      this.flags[1 - team] = this.homeFlag((1 - team) as 0 | 1);
      this.broadcast({ t: "announce", text: `${player.conn.name} captured the ${TEAM[1 - team]} flag! Red ${this.score[0]} — ${this.score[1]} Blue` });
      this.broadcastCtf();
      if (!player.conn.isBot) this.giveXp(player, 25, "Flag captured");
    }
  }

  // ---- Bots: what each one is for ----

  // Carrying the enemy flag: home (urgent). Your own flag dropped: return it
  // (urgent). Your own flag carried off: hunt the carrier. Otherwise half
  // the team attacks (the enemy flag) and half defends (near your stand).
  protected override botObjective(me: Player): { p: Vec3; urgent: boolean } | null {
    const team = this.teamOf(me.conn.id);
    if (team === undefined || this.state !== "playing" || !this.alive.has(me.conn.id)) return null;
    const mine = this.flags[team];
    const theirs = this.flags[1 - team];
    if (theirs.carrier === me.conn.id) return { p: this.stands[team], urgent: true };
    if (mine.state === "dropped") return { p: mine.p, urgent: true };
    if (mine.state === "carried" && mine.carrier !== null) {
      const carrier = this.players.get(mine.carrier);
      if (carrier) return { p: carrier.p, urgent: true };
    }
    const teamBots = [...this.bots.keys()].filter((id) => this.teamOf(id) === team);
    const attacker = teamBots.indexOf(me.conn.id) % 2 === 0;
    if (attacker) {
      // Escort a teammate carrying their flag, or go and take it.
      if (theirs.state === "carried" && theirs.carrier !== null) {
        const carrier = this.players.get(theirs.carrier);
        if (carrier) return { p: carrier.p, urgent: false };
      }
      return { p: theirs.p, urgent: false };
    }
    // Defend: a spot between your stand and the middle, varying a little.
    const stand = this.stands[team];
    const toward = team === 0 ? 1 : -1;
    const wobble = Math.sin(Date.now() / 4000 + me.conn.id) * 5;
    return { p: [stand[0] + wobble, stand[1], stand[2] + toward * 6], urgent: false };
  }

  protected override onJoinedRound(player: Player): void {
    super.onJoinedRound(player);
    const flags = this.flags.map(({ state, p, carrier }) => ({ state, p, carrier })) as [CtfFlag, CtfFlag];
    player.conn.send({ t: "ctf", score: this.score, flags, toWin: TO_WIN });
  }
}
