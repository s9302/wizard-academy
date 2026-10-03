// One Connection per open WebSocket. It knows how to send messages and which
// room (if any) the player is in. Game logic lives in the rooms, not here.

import { WebSocket } from "ws";
import type { ServerMsg } from "../../shared/src/protocol.ts";
import { TokenBucket } from "./limits.ts";
import type { Room } from "./rooms/Room.ts";

// Clients send ~20 moves per second. Allow bursts (e.g. after a lag spike)
// but nothing close to a flood.
const MESSAGE_BURST = 60;
const MESSAGES_PER_SECOND = 30;

let nextId = 1;

export class Connection {
  readonly id: number;
  readonly socket: WebSocket;
  readonly ip: string; // rate-limit key, see limits.ts
  readonly messageBudget = new TokenBucket(MESSAGE_BURST, MESSAGES_PER_SECOND);
  name = "";
  room: Room | null = null;
  alive = true; // flipped by the heartbeat in index.ts

  constructor(socket: WebSocket, ip: string) {
    this.id = nextId++;
    this.socket = socket;
    this.ip = ip;
  }

  send(msg: ServerMsg): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  // Send an error the client can show, then hang up.
  kick(message: string): void {
    console.warn(`kicked #${this.id} ${this.name || "(no name)"} from ${this.ip}: ${message}`);
    this.send({ t: "error", message });
    this.socket.close(4000, message.slice(0, 100));
  }
}
