// How much XP everything is worth. All awards happen on the server.

export const XP = {
  // Parkour: full reward the first time you clear a course, a quarter for
  // repeats (so farming one course is slow), plus a bonus for a new best.
  parkourFirstClear: { trial1: 100, trial2: 150, trial3: 200, trial4: 250, trial5: 300, trial6: 400, trial7: 600, trial8: 800, trial9: 1000 } as Record<string, number>,
  parkourDefault: 100,
  parkourRepeatFraction: 0.25,
  parkourPersonalBest: 25,

  // Tag and infection, per finished round.
  roundPlayed: 20,
  tagWinner: 40, // least time as It
  perTag: 5,
  infectionSurvivor: 50,
  perCurse: 10,
  maxTagsPaid: 10, // per round, per player

  // Battle royale, per finished round.
  royaleWinner: 75, // last wizard standing
  royaleTopThree: 20, // 2nd or 3rd
  perElimination: 15, // max maxTagsPaid per round
  teamWin: 50, // each member of the winning team (team rounds)
  hordeWave: 10, // Horde: per wave cleared, times the wave number (up to hordeWaveMax)
  hordeWaveMax: 120,

  // Monsters (battle royale and the Tyrant's wolves), paid on the kill.
  // Capped so a room full of monsters can't be farmed: at most
  // monsterKillsPaid kills per account in any monsterWindowMs.
  perMonster: { slime: 8, wolf: 10, golem: 25 } as Record<string, number>,
  monsterKillsPaid: 12,
  monsterWindowMs: 5 * 60_000,

  // A round with no other real players (only bots) pays half: practice.
  botsOnlyFraction: 0.5,
};
