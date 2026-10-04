// People you can talk to (walk up and press E): teachers around the academy
// and someone waiting in each trial with a hint. Their looks use the same
// avatar as players; their lines are plain text, shown one at a time.

import type { Look } from "./unlocks.ts";

export type Npc = { name: string; look: Look; lines: string[] };

const L = (l: Partial<Look>): Look => ({ hat: "classic", robe: "midnight", skin: "light", hair: "short", hairColor: "brown", face: "smile", features: [], acc: "none", outfit: "robe", ...l });

export const NPCS: Record<string, Npc> = {
  // ---- The academy ----
  thistle: {
    name: "Professor Thistle",
    look: L({ hat: "tall", robe: "emerald", skin: "fair", hair: "bun", hairColor: "silver", face: "calm", acc: "spectacles", outfit: "scholar" }),
    lines: [
      "Ah, a student who actually stops to listen. Rare.",
      "The Spellbook behind me holds every spell you've earned. Arcane Bolt is honest work. Frost Shard slows. Spark Volley is rude up close.",
      "In the arena, the Wizard holds a spell, the Rogue a bow and daggers, the Knight a sword and shield. Press Esc there to choose.",
      "And do try the Wardrobe. A wizard should look like one.",
    ],
  },
  bram: {
    name: "Groundskeeper Bram",
    look: L({ hat: "classic", robe: "auto", skin: "tan", hair: "curly", hairColor: "black", face: "grin", features: ["beard"], outfit: "tunic" }),
    lines: [
      "Mind the hedges, I only just trimmed 'em.",
      "Those trial portals on the west side are the Headmaster's. Each one you clear opens a bit more of the grounds.",
      "Some of the trials ask more of you than jumping now. Keep your eyes open for glowing things, and listen to anyone you meet in there.",
      "Level up enough and you'll learn to jump twice in the air. Handy on my roof, too.",
    ],
  },
  rook: {
    name: "Captain Rook",
    look: L({ hat: "crown", robe: "crimson", skin: "brown", hair: "mohawk", hairColor: "black", face: "fierce", features: ["scar"], acc: "earrings", outfit: "battlemage" }),
    lines: [
      "Looking for a fight? The arena portal's right there.",
      "Watch the ground in there. Lava burns, the void swallows, and green pads will throw you sky-high.",
      "Blue pads are teleporters. Step on one and you're across the arena before anyone can blink.",
      "Bored of wizards? Press Esc in the arena and add monsters. Slimes, wolves, golems. They hunt everyone, bots included.",
    ],
  },
  quill: {
    name: "Librarian Quill",
    look: L({ hat: "starry", robe: "ivory", skin: "deep", hair: "long", hairColor: "white", face: "calm", outfit: "archmage" }),
    lines: [
      "Shh. The Chronicle remembers everything you've done here. I just make sure nobody spills ink on it.",
      "Headmaster Vale went into the storm to find where it begins. Six trials lead after him.",
      "Two of them end in something that won't let you pass. The bridge has its golem, and the eye has its wraith.",
      "Click to cast at them. Dodge what they throw. Jump the shockwaves. You get three hearts, so don't spend them all at once.",
    ],
  },

  // ---- The trials ----
  pip: {
    name: "Pip",
    look: L({ hat: "classic", robe: "auto", skin: "light", hair: "spiky", hairColor: "ginger", face: "grin", outfit: "tunic" }),
    lines: [
      "Oh! Another first-year! I'm Pip. I've been stuck on this one for a week.",
      "The finish is sealed until you gather the three star orbs along the way. They float right over the path. Run through them.",
      "Miss one and you'll have to go back for it. Or press R and start over, like I've done about forty times.",
    ],
  },
  archivist: {
    name: "The Archivist",
    look: L({ hat: "tall", robe: "ivory", skin: "porcelain", hair: "long", hairColor: "silver", face: "calm", outfit: "archmage" }),
    lines: [
      "You climbed my spire. Few do. The way out is sealed by four runes.",
      "Listen. \"The sun wakes first. The moon chases it. The stars come out to watch. And the flame keeps the night.\"",
      "Step on them in that order. Get it wrong and they forget, and you begin again.",
    ],
  },
  mara: {
    name: "Old Mara",
    look: L({ hat: "classic", robe: "storm", skin: "olive", hair: "braids", hairColor: "white", face: "smile", features: ["freckles", "blush"], outfit: "cloak" }),
    lines: [
      "Still in one piece? Good. Past the rope, the bridge's guardian wakes. A golem, older than the academy.",
      "Click to throw bolts at it. Keep moving: its boulders fly straight, and you can jump its shockwave if you time it.",
      "Three hits and you'll be thrown back here to try again. It's slow. Be quicker.",
    ],
  },
  ash: {
    name: "Sentry Ash",
    look: L({ hat: "storm", robe: "midnight", skin: "dark", hair: "short", hairColor: "teal", face: "fierce", outfit: "battlemage" }),
    lines: [
      "Halt. The Storm Gate won't open for just anyone.",
      "Four storm shards are caught in the wind along the way. Bring them all to the gate and it will let you through.",
      "They glow blue. You can't miss them. Well. You can. People do.",
    ],
  },
  echo: {
    name: "The Echo",
    look: L({ hat: "starry", robe: "storm", skin: "porcelain", hair: "ponytail", hairColor: "violet", face: "surprised", outfit: "cloak" }),
    lines: [
      "...you... you... you came down the stair...",
      "Four runes guard the bottom. Mark it well: \"Flame first, to light the way. Then stars, to steer by. Then the moon, to rest. The sun comes last of all.\"",
      "...all... all... all...",
    ],
  },
  shade: {
    name: "The Headmaster's Shade",
    look: L({ hat: "crown", robe: "ivory", skin: "fair", hair: "long", hairColor: "silver", face: "calm", features: ["beard", "mustache"], acc: "monocle", outfit: "archmage" }),
    lines: [
      "You found me. Well, the part of me the storm let go of.",
      "The rest of me is held by the Storm Wraith, past the ring. Break it, and I can come home.",
      "It throws orbs, calls lightning where you stand, and its shockwave runs along the ground. Keep moving and keep casting.",
    ],
  },
};

// Lines for wandering students (chosen at random when you talk to one).
export const STUDENT_LINES = [
  "Have you tried the Spiral Spire? I fell off on the second lap. Twice.",
  "I heard Captain Rook let a golem into the arena on purpose.",
  "The fountain crystal hums at night. I'm sure of it.",
  "Professor Thistle gave me extra homework for setting the hedge on fire.",
  "Somebody said the Headmaster's still out there in the storm.",
  "If you stand on a green pad in the arena, you fly. Best day of my life.",
  "The Wardrobe has a hooded cloak now. Very mysterious. Very me.",
  "Don't tell anyone, but I'm scared of the slimes.",
];
