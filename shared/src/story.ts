// The academy's story, told through the trials (one chapter each: three
// in the courtyard, three more through the Sanctum) and the hub. Each chapter has a few lines when you start the trial and a few
// when you clear it for the first time; clearing it is what completes the
// chapter. The hub's Chronicle board and lore tablets show the rest.

export type ChapterId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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
      "Headmaster Orrin Vale vanished on the night of the first storm, and the doors of his Sanctum have stayed shut ever since.",
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
      "The final pillar holds. Far behind you, the Sanctum's great doors grind open for the first time in years.",
      "Whatever Vale left inside is waiting for you.",
    ],
  },
  {
    id: 4,
    trial: "trial4",
    title: "Chapter IV: The Storm Gate",
    intro: [
      "Vale's letter pointed past the ruins, to where the storm begins. In the Sanctum, a doorway nobody had noticed is glowing.",
      "Beyond it, the gate stones float in the wind. Climb them, and mind the corners.",
    ],
    outro: [
      "The Storm Gate lets you through. On the far side, a stair spirals down into the dark.",
      "The storm has left its colors on your robes.",
    ],
  },
  {
    id: 5,
    trial: "trial5",
    title: "Chapter V: The Hollow Stair",
    intro: [
      "The stair goes down into the hollow at the storm's heart. Only Vale has ever come back up it.",
      "The stones get smaller the deeper you go.",
    ],
    outro: [
      "At the bottom of the hollow you find his footprints, glowing faintly, leading up toward the eye.",
      "He's close now.",
    ],
  },
  {
    id: 6,
    trial: "trial6",
    title: "Chapter VI: The Eye of the Storm",
    intro: [
      "The eye is quiet. Stones circle it like moths around a lamp, and in the middle, wild magic pours upward in a column.",
      "Somewhere past the ring, Vale is waiting. Don't keep him waiting any longer.",
    ],
    outro: [
      "Vale is sitting on the last stone, tired and grinning. \"You took your time,\" he says. Then, more quietly: \"Thank you.\"",
      "The storm will always come back, he tells you on the walk home. But now the academy has someone who knows the way through it.",
    ],
  },
  {
    id: 7,
    trial: "trial7",
    title: "Chapter VII: The Tyrant's Crown",
    intro: [
      "The storm came back sooner than Vale said it would, and this time it came back with a shape: a giant of thunder and stone, wearing the crown of the old ruins.",
      "No more running from it. Choose how you fight, sword, bow or staff, and bring friends if you have them.",
    ],
    outro: [
      "The Tyrant breaks apart into rain, and the crown rolls to a stop at your feet.",
      "Vale picks it up, turns it over, and hands it back to you. \"I think,\" he says, \"it was always meant for whoever was brave enough to take it off him.\"",
    ],
  },
  {
    id: 8,
    trial: "trial8",
    title: "Chapter VIII: The Frozen Summit",
    intro: [
      "With the Tyrant gone, winter came early. Snow fell on the academy in summer, and something enormous passed over the towers at night, blotting out the stars.",
      "Vale tracked it to the mountain's summit. \"A wyrm,\" he says. \"It sleeps up there for a hundred years, and the storm woke it. It won't come down for you. Make it.\"",
    ],
    outro: [
      "The Wyrm crashes into the snow and doesn't get up. The clouds break, and for the first time in weeks the sun is warm.",
      "Under one of its wings you find a cold, dark crystal humming with a voice that isn't yours. Vale goes very pale when he hears it.",
    ],
  },
  {
    id: 9,
    trial: "trial9",
    title: "Chapter IX: The Hollow Throne",
    intro: [
      "The voice in the crystal belongs to the Lich Sovereign, the first Headmaster, who wanted to live forever and very nearly did. The storm, the Tyrant, the Wyrm: all his.",
      "His throne is in the necropolis under the academy. He blinks from shadow to shadow and the dead rise when he calls them. This is the last trial. Bring everyone.",
    ],
    outro: [
      "The Lich's crown cracks, and with it the crystal, and with it the storm. Somewhere far above, every bell in the academy rings at once.",
      "Vale finds you on the stair, covered in dust. \"So that's it,\" he says. \"No more trials.\" He grins. \"For now.\"",
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
