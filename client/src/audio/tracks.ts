// Background music, per mood. Every track is CC0 (public domain) from
// OpenGameArt.org; credits are in public/audio/CREDITS.md anyway.

export type MusicMood = "academy" | "trials" | "chase" | "arenaLobby" | "arenaBattle";

const M = "/audio/music/";

export const MUSIC: Record<MusicMood, string[]> = {
  academy: [M + "academy-bards-tale.mp3"],
  trials: [M + "trials-kings-feast.mp3"],
  chase: [M + "chase-old-tower-inn.mp3"],
  arenaLobby: [M + "arena-prepare-to-fight.mp3"],
  arenaBattle: [M + "arena-battle-theme-a.mp3", M + "arena-battle-theme.mp3"],
};

// The mood for a room's mode.
export function moodFor(mode: string): MusicMood {
  if (mode === "hub") return "academy";
  if (mode === "parkour") return "trials";
  if (mode === "royale") return "arenaLobby";
  if (mode === "boss" || mode === "ctf" || mode === "horde") return "arenaBattle";
  return "chase";
}
