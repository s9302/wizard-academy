// Every level, by id. The id is also the server room name.

import { academy } from "./academy.ts";
import { arena } from "./arena.ts";
import { ARENAS } from "./arenas.ts";
import { courtyard } from "./courtyard.ts";
import { playground } from "./playground.ts";
import { trial1 } from "./trial1.ts";
import { trial2 } from "./trial2.ts";
import { trial3 } from "./trial3.ts";
import { trial4 } from "./trial4.ts";
import { trial5 } from "./trial5.ts";
import { trial6 } from "./trial6.ts";
import { trial7 } from "./trial7.ts";
import type { Level } from "./types.ts";

export const LEVELS: Record<string, Level> = {
  ...Object.fromEntries(ARENAS.map((a) => [a.id, a])),
  [academy.id]: academy,
  [arena.id]: arena,
  [trial1.id]: trial1,
  [trial2.id]: trial2,
  [trial3.id]: trial3,
  [trial4.id]: trial4,
  [trial5.id]: trial5,
  [trial6.id]: trial6,
  [trial7.id]: trial7,
  [courtyard.id]: courtyard,
  [playground.id]: playground,
};
