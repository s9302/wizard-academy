// Levels from XP. Shared so the client can draw the XP bar from a total.
//
// Each level needs a little more than the last: level 1 -> 2 takes 100 XP,
// 2 -> 3 takes 150, 3 -> 4 takes 200, and so on (+50 per level).

export function xpToReach(level: number): number {
  const n = Math.max(0, level - 1);
  return 100 * n + 25 * n * (n - 1);
}

export type LevelInfo = {
  level: number;
  intoLevel: number; // XP earned since reaching this level
  forNext: number; // XP this level takes in total
};

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (xpToReach(level + 1) <= xp) level++;
  const start = xpToReach(level);
  return { level, intoLevel: xp - start, forNext: xpToReach(level + 1) - start };
}
