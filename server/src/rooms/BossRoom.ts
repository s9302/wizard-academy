// Trial VII: a boss fight played with the battle royale's classes. Everything
// about fighting (classes, weapons, abilities, health, pickups, falls, the
// wolves it summons) is RoyaleRoom's; this room turns off what doesn't
// belong (players hurting each other, the storm, the arena vote) and adds
// the Storm Tyrant (bosses/Boss.ts) as one more body attacks can hit.
//
// A round is an attempt: a short countdown, then the fight. It ends when the
// Tyrant falls (everyone still standing clears the trial: a best time,
// first-clear XP, Chapter VII) or when everyone is down (try again). You can
// fight alone, or bring friends; bots added from the Esc panel fight on your
// side. The Tyrant has more health the more of you there are.

import { DECOY_ID_BASE } from "../../../shared/src/abilities.ts";
import { BOSS_BODY_ID, BOSSES } from "../../../shared/src/bosses.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import type { ClientMsg } from "../../../shared/src/protocol.ts";
import type { RoomInfo } from "../../../shared/src/rooms.ts";
import { leaderboard, recordFinish } from "../accounts.ts";
import { Boss } from "../bosses/Boss.ts";
import { XP } from "../xp.ts";
import { formatTime } from "./ParkourRoom.ts";
import type { Player } from "./Room.ts";
import { navGridFor, SCALE } from "./RoundRoom.ts";
import { type Body, bodyAsEnemy, RoyaleRoom } from "./RoyaleRoom.ts";

const FIGHT_MS = 8 * 60_000 * SCALE; // time's up: the Tyrant wins
const RESULTS_MS = 9_000 * SCALE;

export class BossRoom extends RoyaleRoom {
  private boss: Boss;
  private fightStarted = 0;
  private won = false;
  private lastBossStep = Date.now();
  private board: { name: string; time: number }[] = [];

  constructor(info: RoomInfo, level: Level) {
    super(info, level, null);
    this.friendlyFire = false;
    this.stormOn = false;
    this.voting = false;
    const fight = level.bossFight;
    if (!fight) throw new Error(`${level.id} has no boss`);
    const arena = { min: [-1000, -50, -1000] as [number, number, number], max: [1000, 200, 1000] as [number, number, number] };
    this.boss = new Boss(fight.boss, arena, fight.home, {
      // Only during the fight, and only those still in it (admins too: they
      // can't be hurt, but can watch it fight).
      fighters: () => (this.state !== "playing" ? [] : [...this.players.values()].filter((p) => this.alive.has(p.conn.id)).map((p) => ({ id: p.conn.id, p: p.p }))),
      hurt: (id, by, amount) => {
        const target = this.players.get(id);
        if (target) this.damage(target, amount, null, this.boss.body(BOSS_BODY_ID)?.p, `was struck down by ${by}`);
      },
      defeated: (ids) => this.victory(ids),
      broadcast: (msg) => this.broadcast(msg),
      boxes: () => this.level.boxes,
      grid: () => navGridFor(this.level),
      summon: (kind, near, n) => {
        this.monsters.summon(kind, near, n);
        this.broadcast({ t: "monsters", list: this.monsters.list() });
      },
      summoned: () => this.monsters.countOf("wolf"),
    });
    this.refreshLeaderboard().catch((err) => console.error(`[${this.name}] leaderboard load failed:`, err));
  }

  private async refreshLeaderboard(): Promise<void> {
    this.board = await leaderboard(this.name, 10);
  }

  // ---- Round cycle ----

  protected override minPlayers(): number {
    return 1;
  }

  protected override roundMs(): number {
    return FIGHT_MS;
  }

  protected override resultsMs(): number {
    return RESULTS_MS;
  }

  protected override onCountdown(): void {
    super.onCountdown();
    this.boss.reset();
    this.monsters.clearAll();
    this.won = false;
  }

  protected override onPlayStart(now: number): void {
    super.onPlayStart(now);
    this.fightStarted = now;
  }

  protected override playStartText(): string {
    return `${BOSSES[this.boss.kind].name} rises from its throne!`;
  }

  protected override isRoundOver(): boolean {
    return this.won || this.alive.size === 0;
  }

  protected override onRoundEnded(): void {
    super.onRoundEnded();
    this.monsters.clearAll();
    this.broadcast({ t: "monsters", list: [] });
  }

  protected override results(): { title: string; lines: string[] } {
    const time = formatTime(Date.now() - this.fightStarted);
    if (this.won) {
      const standing = [...this.alive].map((id) => this.nameOf(id));
      return {
        title: `${BOSSES[this.boss.kind].name} has fallen! (${time})`,
        lines: [`Still standing: ${standing.join(", ") || "nobody"}`, "", "Best times:", ...this.board.map((e, i) => `${i + 1}. ${e.name} — ${formatTime(e.time)}`)],
      };
    }
    const { hp, max } = this.boss.health;
    return {
      title: `${BOSSES[this.boss.kind].name} stands. Try again!`,
      lines: [`It had ${Math.round((100 * hp) / Math.max(1, max))}% of its health left.`, "Tip: hide behind the pillars from its boulders, jump its shockwaves, and get out of the red circles."],
    };
  }

  // XP comes with the clear (see victory), like a trial's; nothing per round.
  protected override xpAwards(): { id: number; amount: number; reason: string }[] {
    return [];
  }

  // ---- The boss ----

  protected override onRoundTick(now: number): void {
    super.onRoundTick(now);
    const dt = Math.min(0.2, (now - this.lastBossStep) / 1000);
    this.lastBossStep = now;
    this.boss.step(now, dt);
  }

  protected override bodies(): Body[] {
    const body = this.boss.body(BOSS_BODY_ID);
    return body ? [...super.bodies(), body] : super.bodies();
  }

  protected override hitOther(id: number, amount: number, by: Player | null): boolean {
    if (id !== BOSS_BODY_ID) return false;
    if (this.state === "playing" && (!by || this.alive.has(by.conn.id))) this.boss.hit(amount);
    return true;
  }

  // Bots are on your side: they fight the boss and its wolves, wherever they are.
  protected override botEnemies(): Player[] {
    // (Not a Rogue's copies: those are on your side too.)
    return this.bodies()
      .filter((b) => b.id < DECOY_ID_BASE || b.id >= DECOY_ID_BASE + 1_000_000)
      .map(bodyAsEnemy);
  }

  protected override onRoundMessage(player: Player, msg: ClientMsg): void {
    if (msg.t === "monsters") return; // only the Tyrant calls monsters here
    super.onRoundMessage(player, msg);
  }

  protected override onJoinedRound(player: Player): void {
    super.onJoinedRound(player);
    player.conn.send(this.boss.stateMsg());
    player.conn.send({ t: "leaderboard", entries: this.board });
  }

  // Everyone still standing clears the trial, like finishing a course: a
  // time, XP for the first clear (less after), and the chapter.
  private victory(ids: number[]): void {
    this.won = true;
    const time = Date.now() - this.fightStarted;
    for (const id of ids) {
      const player = this.players.get(id);
      const account = player?.conn.account;
      if (!player || !account || account.isAdmin) continue;
      recordFinish(account.id, this.name, time)
        .then(async (record) => {
          player.conn.send({ t: "finish", time, best: record.best, newBest: record.newBest, firstClear: record.firstClear });
          const base = XP.parkourFirstClear[this.name] ?? XP.parkourDefault;
          if (record.firstClear) this.giveXp(player, base, `First clear: ${this.info.name}`);
          else this.giveXp(player, base * XP.parkourRepeatFraction + (record.newBest ? XP.parkourPersonalBest : 0), record.newBest ? "Beaten again, new best!" : "Beaten again");
          if (record.newBest) {
            await this.refreshLeaderboard();
            this.broadcast({ t: "leaderboard", entries: this.board });
          }
        })
        .catch((err) => console.error(`[${this.name}] saving the clear for ${account.username} failed:`, err));
    }
  }
}
