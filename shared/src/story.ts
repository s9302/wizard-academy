// The academy's story, told through the three trials (one chapter each) and
// the hub. Each chapter has a few lines when you start the trial and a few
// when you clear it for the first time; clearing it is what completes the
// chapter. The hub's Chronicle board and lore tablets show the rest.

export type ChapterId = 1 | 2 | 3;

export type Chapter = {
  id: ChapterId;
  trial: string; // room id of the trial that completes it
  title: string;
  intro: string[];
  outro: string[];
};

export const CHAPTERS: Chapter[] = [
  {
    id: 1,
    trial: "trial1",
    title: "Chapter I: The Floating Steps",
    intro: [
      "Headmaster Orrin Vale vanished on the night of the first storm, and the academy doors have stayed shut ever since.",
      "He left three trials behind. The first asks one thing of a new student: can you keep your feet when the ground won't?",
    ],
    outro: [
      "The last stone settles under you, and somewhere behind the academy a hedge parts with a sigh.",
      "The Spell Garden is open. Frost grows there now: a spell left for whoever got this far.",
    ],
  },
  {
    id: 2,
    trial: "trial2",
    title: "Chapter II: The Spiral Spire",
    intro: [
      "Vale climbed this spire every night to read the stars. His students said he was looking for something in the east.",
      "Three laps. Don't look down, and don't look back.",
    ],
    outro: [
      "From the top you can see what Vale saw: a purple storm turning slowly over the old ruins.",
      "The Observatory is open, and the Headmaster's star charts are still pinned to the walls.",
    ],
  },
  {
    id: 3,
    trial: "trial3",
    title: "Chapter III: The Shattered Bridge",
    intro: [
      "The bridge to the Headmaster's tower broke the night he disappeared. Nobody has crossed it since.",
      "Long leaps, thin ledges, and a rope over nothing. This is the trial he built for his successor.",
    ],
    outro: [
      "The final pillar holds. Far behind you, the academy's great doors grind open for the first time in years.",
      "Whatever Vale left inside is waiting for you.",
    ],
  },
];

// Lore tablets in the hub areas the chapters unlock (see levels/academy.ts).
export const TABLETS: Record<string, { title: string; lines: string[] }> = {
  garden: {
    title: "A note in the Spell Garden",
    lines: [
      "Frost Shard: a splinter of winter. It stings less than a bolt, but whoever it hits moves like they're wading through snow.",
      "Plant it where your rival is going, not where they are. (O.V.)",
    ],
  },
  observatory: {
    title: "The Headmaster's star chart",
    lines: [
      "The storm over the ruins is wild magic, the same kind the academy was built to tame. It grows every year.",
      "Spark Volley: three little sparks, fanned out. Useless at range. At close quarters, rude.",
    ],
  },
  sanctum: {
    title: "A letter on the Headmaster's desk",
    lines: [
      "If you are reading this, you crossed my bridge. Good. I went into the storm to find where it begins, and I have not come back.",
      "The ruins are where you practise. The storm will test you there, and the other students will test you harder.",
      "Look after the academy until I return. The crown on the stand is yours. Wear it badly. (Orrin Vale)",
    ],
  },
};

// Which chapters a player has completed: a chapter is done once its trial
// has a best time.
export function chaptersDone(bestTimes: Record<string, number>): ChapterId[] {
  return CHAPTERS.filter((c) => bestTimes[c.trial] !== undefined).map((c) => c.id);
}

export function chapterForTrial(roomId: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.trial === roomId);
}
