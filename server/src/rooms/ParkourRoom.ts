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
import { leaderboard, recordFinish } from "../accounts.ts";
import { XP } from "../xp.ts";
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
  // Top times from the database, cached and refreshed after each new best.
  private board: { name: string; time: number }[] = [];

  constructor(info: RoomInfo, level: Level) {
    super(info, level);
    if (!level.course) throw new Error(`${level.id} has no course`);
    this.course = level.course;
    this.refreshLeaderboard().catch((err) => console.error(`[${this.name}] leaderboard load failed:`, err));
  }

  private async refreshLeaderboard(): Promise<void> {
    this.board = await leaderboard(this.name);
  }

  private newRun(): Run {
    return { state: "ready", startedAt: 0, reached: 0, respawn: null };
  }

  protected onPlayerJoined(player: Player): void {
    this.runs.set(player.conn.id, this.newRun());
    player.conn.send({ t: "leaderboard", entries: this.board });
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
        this.broadcast({ t: "announce", text: `${name} finished in ${formatTime(time)}${record.newBest ? " \u2014 a new personal best!" : ""}` });

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
