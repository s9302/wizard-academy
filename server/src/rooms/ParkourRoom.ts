// Parkour trials. The server judges every run from the positions it accepted:
// when it started, which checkpoints were reached (in order), and the finish
// time. Clients only display what the server tells them, so a modified client
// can't fake a time.
//
// A run goes: ready (on the start platform) -> running (stepped off) ->
// finished (reached the finish after every checkpoint). Walking back onto the
// start platform, or pressing R, resets it.
//
// Phase 16: some trials also have tasks that must be done before the finish
// counts: star orbs to collect, rune plates to step on in the right order,
// or a boss to beat (see bosses/Boss.ts). Task progress belongs to the run:
// a fall keeps it, a reset clears it.

import { BOSS_HEARTS } from "../../../shared/src/bosses.ts";
import type { Course, Level, Task } from "../../../shared/src/levels/types.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { inZone, segmentTouchesZone } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, Vec3 } from "../../../shared/src/protocol.ts";
import { leaderboard, recordFinish } from "../accounts.ts";
import { Boss } from "../bosses/Boss.ts";
import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { Room } from "./Room.ts";

const LEADERBOARD_SIZE = 10;
const ORB_REACH = 1.7; // meters from an orb's center
const RUNE_REACH = 0.95; // meters from a rune plate's center (flat)
const SEALED_HINT_MS = 4000;

// standing: the rune plate you're on (-1: none); only stepping onto one counts.
type TaskState = { got: Set<number>; seq: number; done: boolean; standing: number };

type Run = {
  state: "ready" | "running" | "finished";
  startedAt: number; // server clock, ms
  reached: number; // checkpoints reached so far
  respawn: Vec3 | null; // last checkpoint's respawn point, or null for the start
  tasks: Map<string, TaskState>;
  hearts: number; // in a boss fight
  sealedHintAt: number;
};

export function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export class ParkourRoom extends Room {
  private course: Course;
  private runs = new Map<number, Run>();
  // Top times from the database, cached and refreshed after each new best.
  private board: { name: string; time: number }[] = [];
  private boss: Boss | null = null;
  private bossTask: Extract<Task, { kind: "boss" }> | null = null;
  private lastTick = Date.now();

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
    if (!level.course) throw new Error(`${level.id} has no course`);
    this.course = level.course;
    this.refreshLeaderboard().catch((err) => console.error(`[${this.name}] leaderboard load failed:`, err));
    const bossTask = this.course.tasks?.find((t) => t.kind === "boss");
    if (bossTask && bossTask.kind === "boss") {
      this.bossTask = bossTask;
      this.boss = new Boss(bossTask.boss, bossTask.arena, bossTask.home, {
        fighters: () =>
          [...this.players.values()]
            .filter((p) => {
              const run = this.runs.get(p.conn.id);
              return run?.state === "running" && run.hearts > 0 && this.boss!.inArena(p.p);
            })
            .map((p) => ({ id: p.conn.id, p: p.p })),
        hurt: (id, by) => this.loseHeart(id, by),
        defeated: (ids) => {
          for (const id of ids) {
            const player = this.players.get(id);
            if (player) this.completeTask(player, bossTask.id);
          }
        },
        broadcast: (msg) => this.broadcast(msg),
        boxes: () => this.level.boxes,
      });
    }
  }

  private async refreshLeaderboard(): Promise<void> {
    this.board = await leaderboard(this.name);
  }

  private newRun(): Run {
    const tasks = new Map<string, TaskState>();
    for (const t of this.course.tasks ?? []) tasks.set(t.id, { got: new Set(), seq: 0, done: false, standing: -1 });
    return { state: "ready", startedAt: 0, reached: 0, respawn: null, tasks, hearts: BOSS_HEARTS, sealedHintAt: 0 };
  }

  protected onPlayerJoined(player: Player): void {
    this.runs.set(player.conn.id, this.newRun());
    player.conn.send({ t: "leaderboard", entries: this.board });
    if (this.boss) {
      player.conn.send(this.boss.stateMsg());
      player.conn.send({ t: "hearts", hearts: BOSS_HEARTS, max: BOSS_HEARTS });
    }
  }

  protected onPlayerLeft(player: Player): void {
    this.runs.delete(player.conn.id);
  }

  // After a fall: back to the last checkpoint, or the start (which resets the run).
  protected respawnPoint(player: Player): Vec3 {
    const run = this.runs.get(player.conn.id);
    if (run?.state === "running" && run.respawn) return run.respawn;
    return this.spawnPoint();
  }

  protected onMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "restart") {
      this.resetRun(player);
      this.teleport(player, this.spawnPoint());
    } else if (msg.t === "cast" && this.boss) {
      // Bolts at the boss, only from inside its arena during a run.
      const run = this.runs.get(player.conn.id);
      if (run?.state === "running" && this.boss.inArena(player.p)) this.boss.cast(player.conn.id, player.p, msg.o, msg.d, msg.seq, Date.now());
    }
  }

  protected onTick(now: number): void {
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.boss?.step(now, dt);
  }

  private resetRun(player: Player): void {
    const run = this.runs.get(player.conn.id);
    if (!run || run.state === "ready") return;
    this.runs.set(player.conn.id, this.newRun());
    player.conn.send({ t: "runReset" });
    for (const t of this.course.tasks ?? []) player.conn.send({ t: "task", id: t.id, got: [], done: false });
    if (this.boss) player.conn.send({ t: "hearts", hearts: BOSS_HEARTS, max: BOSS_HEARTS });
  }

  protected onPlayerMoved(player: Player, from: Vec3, to: Vec3, now: number): void {
    const run = this.runs.get(player.conn.id);
    if (!run) return;
    const onStart = inZone(to, this.course.start);

    if (run.state === "ready") {
      if (!onStart) {
        run.state = "running";
        run.startedAt = now;
        player.conn.send({ t: "runStart", time: now });
      }
      return;
    }

    // Back on the start platform: the run is over, get ready for a new one.
    if (onStart) {
      this.resetRun(player);
      return;
    }

    if (run.state !== "running") return;

    this.checkTasks(player, run, from, to);

    const checkpoints = this.course.checkpoints;
    const next = checkpoints[run.reached];
    if (next && segmentTouchesZone(from, to, next.zone)) {
      run.reached += 1;
      run.respawn = next.respawn;
      player.conn.send({ t: "checkpoint", reached: run.reached, count: checkpoints.length, split: now - run.startedAt });
      return;
    }

    if (run.reached === checkpoints.length && segmentTouchesZone(from, to, this.course.finish)) {
      const missing = this.missingTask(run);
      if (!missing) this.finishRun(player, run, now);
      else if (now - run.sealedHintAt > SEALED_HINT_MS) {
        run.sealedHintAt = now;
        player.conn.send({ t: "announce", text: `The way is sealed: ${missing.label}` });
      }
    }
  }

  private missingTask(run: Run): Task | null {
    return (this.course.tasks ?? []).find((t) => !run.tasks.get(t.id)?.done) ?? null;
  }

  // Orbs touched, rune plates stepped on.
  private checkTasks(player: Player, run: Run, from: Vec3, to: Vec3): void {
    for (const task of this.course.tasks ?? []) {
      const st = run.tasks.get(task.id);
      if (!st || st.done) continue;
      if (task.kind === "orbs") {
        task.points.forEach((p, i) => {
          if (st.got.has(i)) return;
          if (closestOnSegment(from, to, p) > ORB_REACH) return;
          st.got.add(i);
          if (st.got.size === task.points.length) st.done = true;
          player.conn.send({ t: "task", id: task.id, got: [...st.got], done: st.done });
        });
      } else if (task.kind === "runes") {
        const feet = to[1] - 0.9;
        const on = task.points.findIndex((p) => Math.hypot(to[0] - p[0], to[2] - p[2]) < RUNE_REACH && Math.abs(feet - p[1]) < 0.6);
        if (on === st.standing) continue;
        st.standing = on;
        if (on < 0 || st.got.has(on)) continue;
        if (on === task.order[st.seq]) {
          st.seq += 1;
          st.got.add(on);
          if (st.seq === task.order.length) st.done = true;
          player.conn.send({ t: "task", id: task.id, got: [...st.got], done: st.done });
        } else {
          // Wrong rune: they all go dark.
          st.seq = 0;
          st.got.clear();
          player.conn.send({ t: "task", id: task.id, got: [], done: false, wrong: true });
        }
      }
      if (st.done) this.taskDone(player, run, task);
    }
  }

  private completeTask(player: Player, id: string): void {
    const run = this.runs.get(player.conn.id);
    const st = run?.tasks.get(id);
    const task = this.course.tasks?.find((t) => t.id === id);
    if (!run || !st || !task || st.done || run.state !== "running") return;
    st.done = true;
    player.conn.send({ t: "task", id, got: [], done: true });
    this.taskDone(player, run, task);
  }

  // Done: tell them, and if they're already standing at the finish, finish.
  private taskDone(player: Player, run: Run, task: Task): void {
    player.conn.send({ t: "announce", text: this.missingTask(run) ? `Done: ${task.label}` : "The way is open!" });
    if (!this.missingTask(run) && run.reached === this.course.checkpoints.length && inZone(player.p, this.course.finish)) {
      this.finishRun(player, run, Date.now());
    }
  }

  // Boss fights: a hit costs a heart; the last one sends you back to the
  // arena's entrance with a full set.
  private loseHeart(id: number, by: string): void {
    const player = this.players.get(id);
    const run = this.runs.get(id);
    if (!player || !run || run.state !== "running" || player.conn.isAdmin) return;
    run.hearts -= 1;
    if (run.hearts > 0) {
      player.conn.send({ t: "hearts", hearts: run.hearts, max: BOSS_HEARTS });
      player.conn.send({ t: "announce", text: `Hit by ${by}!` });
      return;
    }
    run.hearts = BOSS_HEARTS;
    player.conn.send({ t: "hearts", hearts: run.hearts, max: BOSS_HEARTS });
    player.conn.send({ t: "announce", text: `Knocked out by ${by}! Back to the entrance.` });
    this.teleport(player, this.respawnPoint(player));
  }

  // The time is the server's, so it's final. Saving it and working out XP
  // need the database, so the player hears about it a moment later.
  private finishRun(player: Player, run: Run, now: number): void {
    run.state = "finished";
    const time = now - run.startedAt;
    const account = player.conn.account;
    if (!account) return;
    if (account.isAdmin) {
      // Admins can fly, so their times don't count.
      player.conn.send({ t: "finish", time, best: time, newBest: false, firstClear: false });
      return;
    }
    recordFinish(account.id, this.name, time)
      .then(async (record) => {
        player.conn.send({ t: "finish", time, best: record.best, newBest: record.newBest, firstClear: record.firstClear });
        const name = player.conn.name;
        console.log(`[${this.name}] ${name} finished in ${formatTime(time)}${record.newBest ? " (personal best)" : ""}`);
        this.broadcast({ t: "announce", text: `${name} finished in ${formatTime(time)}${record.newBest ? " — a new personal best!" : ""}` });

        const base = XP.parkourFirstClear[this.name] ?? XP.parkourDefault;
        if (record.firstClear) {
          this.giveXp(player, base, `First clear: ${this.info.name}`);
        } else {
          const bonus = record.newBest ? XP.parkourPersonalBest : 0;
          this.giveXp(player, base * XP.parkourRepeatFraction + bonus, record.newBest ? "Cleared again, new best!" : "Cleared again");
        }
        if (record.newBest) {
          await this.refreshLeaderboard();
          this.broadcast({ t: "leaderboard", entries: this.board });
        }
      })
      .catch((err) => {
        console.error(`[${this.name}] saving finish for ${account.username} failed:`, err);
        player.conn.send({ t: "finish", time, best: time, newBest: false, firstClear: false });
      });
  }
}


// Distance from point c to the segment a -> b (a fast player passes through
// an orb between two position updates).
function closestOnSegment(a: Vec3, b: Vec3, c: Vec3): number {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1] + (c[2] - a[2]) * d[2]) / len2)) : 0;
  return Math.hypot(a[0] + d[0] * t - c[0], a[1] + d[1] * t - c[1], a[2] + d[2] * t - c[2]);
}
