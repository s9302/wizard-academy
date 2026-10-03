// Every level, by id. The id is also the server room name.

import { playground } from "./playground.ts";
import { trial1 } from "./trial1.ts";
import type { Level } from "./types.ts";

export const LEVELS: Record<string, Level> = {
  [trial1.id]: trial1,
  [playground.id]: playground,
};
