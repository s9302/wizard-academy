// Parkour trials. The server judges every run from the positions it accepted:
// when it started, which checkpoints were reached (in order), and the finish
// time. Clients only display what the server tells them, so a modified client
// can't fake a time.
//
// A run goes: ready (on the start platform) -> running (stepped off) ->
// finished (reached the finish after every checkpoint). Walking back onto the
// start platform, or pressing R, resets it.

import type { Course, Level } from "../../../shared/src/levels/types.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { inZone, segmentTouchesZone } from "../../../shared/src/levels/types.ts";
import type { ClientMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { Player } from "./Room.ts";
import { Room } from "./Room.ts";

const LEADERBOARD_SIZE = 10;

type Run = {
  state: "ready" | "running" | "finished";
  startedAt: number; // server clock, ms
  reached: number; // checkpoints reached so far
  respawn: Vec3 | null; // last checkpoint's respawn point, or null for the start
};

export function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export class ParkourRoom extends Room {
  private course: Course;
  private runs = new Map<number, Run>();
  // Best time per player name, for this server session. (Phase 5 moves best
  // times into the database, tied to real accounts.)
  private bestTimes = new Map<string, { name: string; time: number }>();

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
    if (!level.course) throw new Error(`${level.id} has no course`);
    this.course = level.course;
  }

  private newRun(): Run {
    return { state: "ready", startedAt: 0, reached: 0, respawn: null };
  }

  protected onPlayerJoined(player: Player): void {
    this.runs.set(player.conn.id, this.newRun());
    player.conn.send({ t: "leaderboard", entries: this.leaderboard() });
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
    }
  }

  private resetRun(player: Player): void {
    const run = this.runs.get(player.conn.id);
    if (!run || run.state === "ready") return;
    this.runs.set(player.conn.id, this.newRun());
    player.conn.send({ t: "runReset" });
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

    const checkpoints = this.course.checkpoints;
    const next = checkpoints[run.reached];
    if (next && segmentTouchesZone(from, to, next.zone)) {
      run.reached += 1;
      run.respawn = next.respawn;
      player.conn.send({ t: "checkpoint", reached: run.reached, count: checkpoints.length, split: now - run.startedAt });
      return;
    }

    if (run.reached === checkpoints.length && segmentTouchesZone(from, to, this.course.finish)) {
      this.finishRun(player, run, now);
    }
  }

  private finishRun(player: Player, run: Run, now: number): void {
    run.state = "finished";
    const time = now - run.startedAt;
    const name = player.conn.name;
    const key = name.toLowerCase();
    const previous = this.bestTimes.get(key);
    const newBest = !previous || time < previous.time;
    if (newBest) this.bestTimes.set(key, { name, time });
    const best = newBest ? time : previous.time;

    player.conn.send({ t: "finish", time, best, newBest });
    console.log(`[${this.name}] ${name} finished in ${formatTime(time)}${newBest ? " (personal best)" : ""}`);
    this.broadcast({ t: "announce", text: `${name} finished in ${formatTime(time)}${newBest ? " — a new personal best!" : ""}` });
    if (newBest) this.broadcast({ t: "leaderboard", entries: this.leaderboard() });
  }

  private leaderboard(): { name: string; time: number }[] {
    return [...this.bestTimes.values()].sort((a, b) => a.time - b.time).slice(0, LEADERBOARD_SIZE);
  }
}
