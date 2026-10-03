// Phase 1 room: everyone walks around the test level together. No rules yet.

import type { Vec3 } from "../../../shared/src/protocol.ts";
import { Room } from "./Room.ts";

export class TestRoom extends Room {
  protected spawnPoint(): Vec3 {
    // Spread players around a small circle so they don't spawn inside each other.
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.5 + Math.random() * 2;
    return [Math.cos(angle) * radius, 2, Math.sin(angle) * radius];
  }
}
