// Background music, per mood: Spencer's own tracks (public/audio/music),
// calm ones for the Academy, the trials and the arena lobby, battle ones for
// fights and chases. A mood plays its tracks in turn from a random one.

export type MusicMood = "academy" | "trials" | "chase" | "arenaLobby" | "arenaBattle";

const M = "/audio/music/";

const CALM = [
  M + "calm1.mp3",
  M + "calm2.mp3",
  M + "calm3.mp3",
  M + "calm4.mp3",
  M + "calm5.mp3",
  M + "calm6.mp3",
  M + "calm7.mp3",
  M + "calm9.mp3",
  M + "calm10.mp3",
  M + "calm11.mp3",
  M + "calm12.mp3",
  M + "calm13.mp3",
  M + "calm14.mp3",
  M + "calm15.mp3",
];

const BATTLE = [
  M + "battle1.mp3",
  M + "battle2.mp3",
  M + "battle3.mp3",
  M + "battle4.mp3",
  M + "battle5.mp3",
  M + "battle6.mp3",
  M + "battle7.mp3",
  M + "battle8.mp3",
  M + "battle9.mp3",
  M + "battle10.mp3",
  M + "battle11.mp3",
  M + "battle12.mp3",
  M + "battle13.mp3",
];

export const MUSIC: Record<MusicMood, string[]> = {
  academy: CALM,
  trials: CALM,
  chase: BATTLE,
  arenaLobby: CALM,
  arenaBattle: BATTLE,
};

// The mood for a room's mode.
export function moodFor(mode: string): MusicMood {
  if (mode === "hub") return "academy";
  if (mode === "parkour") return "trials";
  if (mode === "royale") return "arenaLobby";
  if (mode === "boss" || mode === "ctf" || mode === "horde") return "arenaBattle";
  return "chase";
}
