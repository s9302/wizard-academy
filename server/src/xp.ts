// How much XP everything is worth. All awards happen on the server.

export const XP = {
  // Parkour: full reward the first time you clear a course, a quarter for
  // repeats (so farming one course is slow), plus a bonus for a new best.
  parkourFirstClear: { trial1: 100, trial2: 150, trial3: 200 } as Record<string, number>,
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

  // A round with no other real players (only bots) pays half: practice.
  botsOnlyFraction: 0.5,
};
