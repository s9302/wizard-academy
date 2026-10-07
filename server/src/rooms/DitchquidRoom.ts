// Ditchquid (see shared/src/ditchquid.ts): two teams on brooms, three hoops
// at each end, one ball. The server owns the ball: who has it, where it
// flies when thrown, and whether it went through a hoop. Movement is the
// players' own, on brooms (Room.allowsBrooms).

import { DQ, DQ_TEAMS, throughHoop } from "../../../shared/src/ditchquid.ts";
import { CAST_ORIGIN_SLACK } from "../../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../../shared/src/constants.ts";
import { segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { DitchquidBot } from "../bots/DitchquidBot.ts";
import type { BotPeer } from "../Connection.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { RoundRoom, SCALE } from "./RoundRoom.ts";

type Ball = {
  p: Vec3;
  v: Vec3;
  carrier: number | null;
  hovering: boolean; // waiting at midfield (no gravity) until someone grabs it
  frozenUntil: number; // after a goal: nobody can grab it yet
  thrownBy: number | null;
  thrownAt: number;
  caughtAt: number;
};
type Jinx = { id: number; by: number; team: 0 | 1; o: Vec3; d: Vec3; time: number };

let nextJinxId = 1;
const BALL_SEND_MS = 50;

export class DitchquidRoom extends RoundRoom<DitchquidBot> {
  private teams = new Map<number, 0 | 1>();
  private score: [number, number] = [0, 0];
  private goals = new Map<number, number>();
  private ball: Ball;
  private jinxes = new Map<number, Jinx>();
  private jinxReady = new Map<number, number>();
  private slowedUntil = new Map<number, number>(); // for bots (people slow themselves)
  private velocity = new Map<number, { p: Vec3; time: number; v: Vec3 }>();
  private lastBallSend = 0;
  private lastStep = Date.now();

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
    this.ball = this.freshBall(0);
  }

  private get dq() {
    return this.level.ditchquid!;
  }

  protected override allowsBrooms(): boolean {
    return true;
  }

  protected roundMs(): number {
    return DQ.roundMs * SCALE;
  }

  // ---- Teams ----

  private teamSizes(): [number, number] {
    const n: [number, number] = [0, 0];
    for (const t of this.teams.values()) n[t]++;
    return n;
  }

  private assignTeams(): void {
    // People first, alternating, then bots fill in to even it out.
    this.teams.clear();
    const all = [...this.players.values()].sort((a, b) => Number(a.conn.isBot) - Number(b.conn.isBot) || Math.random() - 0.5);
    for (const p of all) {
      const [a, b] = this.teamSizes();
      this.teams.set(p.conn.id, a <= b ? 0 : 1);
    }
    this.broadcastTeams();
  }

  private broadcastTeams(): void {
    const teams: [number[], number[]] = [[], []];
    for (const [id, t] of this.teams) teams[t].push(id);
    this.broadcast({ t: "dqTeams", teams });
  }

  private toTeamSpawn(player: Player): void {
    const team = this.teams.get(player.conn.id) ?? 0;
    const spots = this.dq.spawns[team];
    const taken = [...this.teams.entries()].filter(([id, t]) => t === team && id < player.conn.id).length;
    this.teleport(player, spots[taken % spots.length], team === 0 ? -Math.PI / 2 : Math.PI / 2);
  }

  // ---- The ball ----

  private freshBall(now: number): Ball {
    return { p: [...this.dq.ball], v: [0, 0, 0], carrier: null, hovering: true, frozenUntil: now + DQ.resetMs * SCALE, thrownBy: null, thrownAt: 0, caughtAt: 0 };
  }

  private sendBall(now: number): void {
    this.lastBallSend = now;
    this.broadcast({ t: "dqBall", p: this.ball.p.map((c) => Math.round(c * 100) / 100) as Vec3, carrier: this.ball.carrier, time: now });
  }

  private grab(player: Player, now: number): void {
    this.ball.carrier = player.conn.id;
    this.ball.caughtAt = now;
    this.ball.hovering = false;
    this.ball.v = [0, 0, 0];
    this.sendBall(now);
  }

  // Let go of it (thrown, or knocked loose by a jinx).
  private release(from: Vec3, v: Vec3, by: number, now: number): void {
    Object.assign(this.ball, { carrier: null, hovering: false, p: from, v, thrownBy: by, thrownAt: now });
    this.sendBall(now);
  }

  private throwBall(player: Player, d: Vec3, now: number): void {
    const id = player.conn.id;
    if (this.state !== "playing" || this.ball.carrier !== id) return;
    const eye: Vec3 = [player.p[0], player.p[1] + EYE_HEIGHT, player.p[2]];
    const mv = this.velocity.get(id)?.v ?? [0, 0, 0];
    const s = DQ.ball.speed;
    this.release([eye[0] + d[0] * 0.8, eye[1] + d[1] * 0.8, eye[2] + d[2] * 0.8], [d[0] * s + mv[0] * 0.4, d[1] * s + mv[1] * 0.4, d[2] * s + mv[2] * 0.4], id, now);
  }

  private stepBall(now: number, dt: number): void {
    const b = this.ball;
    if (b.carrier !== null) {
      const c = this.players.get(b.carrier);
      if (!c) {
        this.release(b.p, [0, 0, 0], b.carrier, now);
        return;
      }
      b.p = [c.p[0], c.p[1] + 0.2, c.p[2]];
      return;
    }
    if (!b.hovering) {
      const prev: Vec3 = [...b.p];
      const drag = Math.max(0, 1 - DQ.ball.drag * dt);
      b.v = [b.v[0] * drag, (b.v[1] - DQ.ball.gravity * dt) * drag, b.v[2] * drag];
      b.p = [b.p[0] + b.v[0] * dt, b.p[1] + b.v[1] * dt, b.p[2] + b.v[2] * dt];
      // Through a hoop? (Only a thrown ball counts, not one carried through.)
      const hoopIndex = this.dq.hoops.findIndex((h) => throughHoop(prev, b.p, h));
      if (hoopIndex >= 0) return this.goal(hoopIndex, now);
      // The ground: bounce, and roll to a stop.
      const r = DQ.ball.radius;
      if (b.p[1] < r) {
        b.p[1] = r;
        b.v = [b.v[0] * 0.8, Math.abs(b.v[1]) > 1 ? -b.v[1] * DQ.ball.bounce : 0, b.v[2] * 0.8];
      }
      // The pitch's edges and ceiling.
      const lim = this.dq.bounds;
      for (const [axis, max] of [[0, lim.x], [2, lim.z]] as const) {
        if (Math.abs(b.p[axis]) > max) {
          b.p[axis] = Math.sign(b.p[axis]) * max;
          b.v[axis] = -b.v[axis] * DQ.ball.bounce;
        }
      }
      if (b.p[1] > lim.top) {
        b.p[1] = lim.top;
        b.v[1] = -Math.abs(b.v[1]) * DQ.ball.bounce;
      }
    }
    // Anyone close enough grabs it (not the thrower, for a moment).
    if (now < b.frozenUntil || this.state !== "playing") return;
    for (const player of this.players.values()) {
      const id = player.conn.id;
      if (id === b.thrownBy && now - b.thrownAt < DQ.ball.rethrowMs) continue;
      const flat = Math.hypot(player.p[0] - b.p[0], player.p[2] - b.p[2]);
      if (flat < DQ.ball.reach && Math.abs(player.p[1] - b.p[1]) < DQ.ball.reach) {
        this.grab(player, now);
        return;
      }
    }
  }

  private goal(hoopIndex: number, now: number): void {
    const hoop = this.dq.hoops[hoopIndex];
    const team = (1 - hoop.team) as 0 | 1;
    const by = this.ball.thrownBy;
    this.score[team] += DQ.goalPoints;
    if (by !== null && this.teams.get(by) === team) this.goals.set(by, (this.goals.get(by) ?? 0) + 1);
    this.broadcast({ t: "dqGoal", team, by, hoop: hoopIndex });
    this.broadcast({ t: "dqScore", score: this.score });
    const who = by !== null && this.players.has(by) ? this.nameOf(by) : "Someone";
    const own = by !== null && this.teams.get(by) !== team;
    this.broadcast({ t: "announce", text: own ? `${who} scored for the other side! ${DQ_TEAMS[team].name} +${DQ.goalPoints}` : `${who} scores for the ${DQ_TEAMS[team].name}! +${DQ.goalPoints}` });
    this.ball = this.freshBall(now);
    this.sendBall(now);
  }

  // ---- Jinxes ----

  private castJinx(player: Player, o: Vec3, d: Vec3, now: number): void {
    const id = player.conn.id;
    if (this.state !== "playing" || this.ball.carrier === id) return;
    if (now < (this.jinxReady.get(id) ?? 0)) return;
    const eye: Vec3 = [player.p[0], player.p[1] + EYE_HEIGHT, player.p[2]];
    if (Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > CAST_ORIGIN_SLACK) o = eye;
    this.jinxReady.set(id, now + DQ.jinx.cooldownMs);
    const jinx: Jinx = { id: nextJinxId++, by: id, team: this.teams.get(id) ?? 0, o, d, time: now };
    this.jinxes.set(jinx.id, jinx);
    this.broadcast({ t: "dqJinxCast", id: jinx.id, by: id, o, d, time: now });
  }

  private stepJinxes(now: number): void {
    for (const j of [...this.jinxes.values()]) {
      const at = (t: number): Vec3 => {
        const m = Math.min(DQ.jinx.range, Math.max(0, t) * DQ.jinx.speed);
        return [j.o[0] + j.d[0] * m, j.o[1] + j.d[1] * m, j.o[2] + j.d[2] * m];
      };
      const t = (now - j.time) / 1000;
      const prev = at(t - 0.06);
      const p = at(t);
      let hit: Player | null = null;
      let best = segmentHitsLevel(prev, p, this.level.boxes, 0.05) ?? 1;
      for (const target of this.players.values()) {
        if (target.conn.id === j.by || this.teams.get(target.conn.id) === j.team) continue;
        const k = segmentHitsPlayer(prev, p, target.p, DQ.jinx.radius);
        if (k !== null && k < best) {
          best = k;
          hit = target;
        }
      }
      const done = hit || best < 1 || t * DQ.jinx.speed >= DQ.jinx.range;
      if (!done) continue;
      this.jinxes.delete(j.id);
      const end: Vec3 = [prev[0] + (p[0] - prev[0]) * best, prev[1] + (p[1] - prev[1]) * best, prev[2] + (p[2] - prev[2]) * best];
      this.broadcast({ t: "dqJinxEnd", id: j.id, p: end, hit: hit?.conn.id ?? null });
      if (hit) this.jinxed(hit, j.by, now);
    }
  }

  // Hit by a jinx: slowed (people's own game slows them), and the ball drops.
  private jinxed(victim: Player, by: number, now: number): void {
    const id = victim.conn.id;
    this.slowedUntil.set(id, now + DQ.jinx.slowMs);
    if (this.ball.carrier === id && now - this.ball.caughtAt >= DQ.ball.holdMs) {
      // It pops up and away, so whoever's right there doesn't just catch it.
      const v = this.velocity.get(id)?.v ?? [0, 0, 0];
      const a = Math.random() * Math.PI * 2;
      this.release([victim.p[0], victim.p[1] + 0.2, victim.p[2]], [v[0] * 0.5 + Math.cos(a) * 5, 6, v[2] * 0.5 + Math.sin(a) * 5], id, now);
      this.broadcast({ t: "announce", text: `${this.nameOf(by)} jinxed ${victim.conn.name}: the ball's loose!` });
    }
  }

  // ---- Round cycle ----

  protected override onCountdown(now: number): void {
    this.assignTeams();
    for (const p of this.players.values()) this.toTeamSpawn(p);
    this.score = [0, 0];
    this.goals.clear();
    this.jinxes.clear();
    this.ball = this.freshBall(now);
    this.broadcast({ t: "dqScore", score: this.score });
    this.sendBall(now);
  }

  protected onPlayStart(now: number): void {
    this.ball = this.freshBall(now);
    this.ball.frozenUntil = now;
    this.sendBall(now);
    this.broadcast({ t: "announce", text: "The ball is up! Grab it and throw it through the other team's hoops." });
  }

  protected override onRoundTick(now: number): void {
    const dt = Math.min(0.2, (now - this.lastStep) / 1000);
    this.lastStep = now;
    this.stepBall(now, dt);
    this.stepJinxes(now);
    if (now - this.lastBallSend >= BALL_SEND_MS && (this.state === "playing" || this.state === "countdown")) this.sendBall(now);
  }

  protected isRoundOver(): boolean {
    return false; // the clock decides
  }

  private winner(): 0 | 1 | null {
    return this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1;
  }

  protected results(): { title: string; lines: string[] } {
    const w = this.winner();
    const title = w === null ? `A draw, ${this.score[0]} all!` : `The ${DQ_TEAMS[w].name} win, ${this.score[w]} to ${this.score[1 - w]}!`;
    const scorers = [...this.goals.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${this.nameOf(id)}: ${n} goal${n === 1 ? "" : "s"}`);
    return { title, lines: [`${DQ_TEAMS[0].name} ${this.score[0]} · ${DQ_TEAMS[1].name} ${this.score[1]}`, ...(scorers.length ? scorers : ["No goals this time."])] };
  }

  protected xpAwards(): { id: number; amount: number; reason: string }[] {
    const w = this.winner();
    const awards = [...this.players.keys()].map((id) => ({ id, amount: XP.roundPlayed, reason: "Match played" }));
    for (const id of this.players.keys()) {
      if (w !== null && this.teams.get(id) === w) awards.push({ id, amount: XP.teamWin, reason: "Your team won" });
      const n = Math.min(this.goals.get(id) ?? 0, XP.maxTagsPaid);
      if (n) awards.push({ id, amount: n * XP.ditchquidGoal, reason: `${n} goal${n === 1 ? "" : "s"}` });
    }
    return awards;
  }

  // ---- Players ----

  protected override onJoinedRound(player: Player): void {
    const id = player.conn.id;
    if (player.conn.isBot) player.broom = true;
    // Mid-match: onto the smaller team.
    if (this.state === "playing" || this.state === "countdown") {
      const [a, b] = this.teamSizes();
      this.teams.set(id, a <= b ? 0 : 1);
      this.broadcastTeams();
      this.toTeamSpawn(player);
    } else {
      const teams: [number[], number[]] = [[], []];
      for (const [pid, t] of this.teams) teams[t].push(pid);
      player.conn.send({ t: "dqTeams", teams });
    }
    player.conn.send({ t: "dqScore", score: this.score });
    player.conn.send({ t: "dqBall", p: this.ball.p, carrier: this.ball.carrier, time: Date.now() });
  }

  protected override onLeftRound(player: Player): void {
    const id = player.conn.id;
    if (this.ball.carrier === id) this.release(player.p, [0, 0, 0], id, Date.now());
    this.teams.delete(id);
    this.velocity.delete(id);
    this.jinxReady.delete(id);
    this.slowedUntil.delete(id);
    this.broadcastTeams();
  }

  protected override onPlayerMoved(player: Player, from: Vec3, to: Vec3, now: number): void {
    const last = this.velocity.get(player.conn.id);
    const dt = last ? Math.max(0.03, (now - last.time) / 1000) : 0.05;
    this.velocity.set(player.conn.id, { p: to, time: now, v: [(to[0] - from[0]) / dt, (to[1] - from[1]) / dt, (to[2] - from[2]) / dt] });
  }

  protected override onRoundMessage(player: Player, msg: ClientMsg): void {
    const now = Date.now();
    if (msg.t === "dqThrow") this.throwBall(player, msg.d, now);
    else if (msg.t === "dqJinx") this.castJinx(player, msg.o, msg.d, now);
  }

  // ---- Bots ----

  protected createBot(peer: BotPeer): DitchquidBot {
    return new DitchquidBot(peer);
  }

  protected runBot(bot: DitchquidBot, me: Player, now: number, dt: number): void {
    const id = me.conn.id;
    const team = this.teams.get(id) ?? 0;
    const mates = [...this.bots.keys()].filter((b) => this.teams.get(b) === team);
    const action = bot.think({
      now,
      dt,
      me: { id, p: me.p },
      team,
      keeper: mates[0] === id && mates.length > 1,
      slowed: now < (this.slowedUntil.get(id) ?? 0),
      playing: this.state === "playing",
      ball: { p: this.ball.p, carrier: this.ball.carrier, free: now >= this.ball.frozenUntil },
      players: [...this.players.values()].filter((p) => p !== me).map((p) => ({ id: p.conn.id, p: p.p, v: this.velocity.get(p.conn.id)?.v ?? [0, 0, 0], team: this.teams.get(p.conn.id) ?? 0 })),
      hoops: this.dq.hoops,
      bounds: this.dq.bounds,
      canJinx: now >= (this.jinxReady.get(id) ?? 0),
    });
    this.moveBot(me, action.p, action.ry, now);
    if (action.throwDir) this.throwBall(me, action.throwDir, now);
    if (action.jinx) this.castJinx(me, action.jinx.o, action.jinx.d, now);
  }
}
