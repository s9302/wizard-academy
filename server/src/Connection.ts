// A "peer" is anyone in a room: a real player's WebSocket Connection, or a
// server-side bot (BotPeer). Rooms only talk to the Peer interface, so bots
// play by exactly the same room code as people.

import { WebSocket } from "ws";
import type { ServerMsg } from "../../shared/src/protocol.ts";
import { TokenBucket } from "./limits.ts";
import type { Room } from "./rooms/Room.ts";

export interface Peer {
  readonly id: number;
  readonly isBot: boolean;
  name: string;
  room: Room | null;
  send(msg: ServerMsg): void;
  sendRaw(text: string): void; // an already-serialized message (broadcasts)
  kick(message: string): void;
}

// Clients send ~20 moves per second. Allow bursts (e.g. after a lag spike)
// but nothing close to a flood.
const MESSAGE_BURST = 60;
const MESSAGES_PER_SECOND = 30;

let nextId = 1;

export class Connection implements Peer {
  readonly id: number;
  readonly isBot = false;
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
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(text);
  }

  // Send an error the client can show, then hang up.
  kick(message: string): void {
    console.warn(`kicked #${this.id} ${this.name || "(no name)"} from ${this.ip}: ${message}`);
    this.send({ t: "error", message });
    this.socket.close(4000, message.slice(0, 100));
  }
}

// A server-side bot. Messages to it go nowhere; its brain (bots/ChaseBot.ts)
// reads the room state directly instead.
export class BotPeer implements Peer {
  readonly id: number;
  readonly isBot = true;
  name: string;
  room: Room | null = null;

  constructor(name: string) {
    this.id = nextId++;
    this.name = name;
  }

  send(): void {}
  sendRaw(): void {}
  kick(): void {}
}
