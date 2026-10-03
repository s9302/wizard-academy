// Tag: one player is "It". Touching someone makes them It instead. Whoever
// spends the least time as It by the end of the round wins.

import { XP } from "../xp.ts";
import type { Player } from "./Room.ts";
import { ChaseRoom } from "./ChaseRoom.ts";

// The new It can't tag straight back: the old It gets a moment to escape.
const NO_TAG_BACK_MS = 2_000;

export class TagRoom extends ChaseRoom {
  private timeAsIt = new Map<number, number>(); // ms, this round
  private itSince = new Map<number, number>();
  private tagsMade = new Map<number, number>();

  protected pickInitialChasers(ids: number[]): number[] {
    return [ids[Math.floor(Math.random() * ids.length)]];
  }

  protected onRoundStart(): void {
    this.timeAsIt.clear();
    this.itSince.clear();
    this.tagsMade.clear();
  }

  protected onChaserAdded(id: number, now: number): void {
    this.itSince.set(id, now);
  }

  private stopClock(id: number, now: number): void {
    const since = this.itSince.get(id);
    if (since === undefined) return;
    this.timeAsIt.set(id, (this.timeAsIt.get(id) ?? 0) + (now - since));
    this.itSince.delete(id);
  }

  protected applyTag(tagger: Player, victim: Player, now: number): void {
    this.stopClock(tagger.conn.id, now);
    this.tagsMade.set(tagger.conn.id, (this.tagsMade.get(tagger.conn.id) ?? 0) + 1);
    this.removeChaser(tagger.conn.id);
    this.makeChaser(victim.conn.id, now, NO_TAG_BACK_MS);
  }

  protected isRoundOver(): boolean {
    return false; // tag only ends when the clock runs out
  }

  protected lateJoinerIsChaser(): boolean {
    return false;
  }

  protected results(now: number): { title: string; lines: string[] } {
    for (const id of [...this.itSince.keys()]) this.stopClock(id, now);
    const scores = [...this.players.keys()]
      .map((id) => ({ name: this.nameOf(id), ms: this.timeAsIt.get(id) ?? 0 }))
      .sort((a, b) => a.ms - b.ms);
    const lines = scores.map((s, i) => `${i + 1}. ${s.name} — ${(s.ms / 1000).toFixed(1)} s as It`);
    const winner = scores[0];
    return { title: winner ? `${winner.name} wins! Least time as It.` : "Round over", lines };
  }

  protected xpAwards(): { id: number; amount: number; reason: string }[] {
    const ids = [...this.players.keys()];
    const least = Math.min(...ids.map((id) => this.timeAsIt.get(id) ?? 0));
    const awards = ids.map((id) => ({ id, amount: XP.roundPlayed, reason: "Round played" }));
    for (const id of ids) {
      if ((this.timeAsIt.get(id) ?? 0) === least) awards.push({ id, amount: XP.tagWinner, reason: "Least time as It" });
      const tags = Math.min(this.tagsMade.get(id) ?? 0, XP.maxTagsPaid);
      if (tags) awards.push({ id, amount: tags * XP.perTag, reason: `${tags} tag${tags === 1 ? "" : "s"}` });
    }
    return awards;
  }

  protected describeTag(tagger: Player, victim: Player): string {
    return `${tagger.conn.name} tagged ${victim.conn.name}. ${victim.conn.name} is It!`;
  }

  protected describeStart(names: string[]): string {
    return `${names.join(" and ")} is It! Run!`;
  }
}
