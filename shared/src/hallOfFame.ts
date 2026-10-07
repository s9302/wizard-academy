// The Hall of Champions (upstairs in the academy): what /api/halloffame
// returns. Admins aren't ranked.
export type HallOfFame = {
  xp: { name: string; xp: number }[]; // the most XP, best first
  times: Record<string, { name: string; time: number }[]>; // per trial room id: fastest first, ms
};
