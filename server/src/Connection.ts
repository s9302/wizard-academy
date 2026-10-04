// A "peer" is anyone in a room: a real player's WebSocket Connection, or a
// server-side bot (BotPeer). Rooms only talk to the Peer interface, so bots
// play by exactly the same room code as people.

import { WebSocket } from "ws";
import type { ServerMsg } from "../../shared/src/protocol.ts";
import type { Look } from "../../shared/src/unlocks.ts";
import type { Account } from "./accounts.ts";
import { TokenBucket } from "./limits.ts";
import type { Room } from "./rooms/Room.ts";

export interface Peer {
  readonly id: number;
  readonly isBot: boolean;
  readonly account: Account | null; // null for bots
  name: string;
  look: Look; // hat and robe, shown to everyone
  readonly isAdmin: boolean;
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
  readonly account: Account;
  readonly messageBudget = new TokenBucket(MESSAGE_BURST, MESSAGES_PER_SECOND);
  name = "";
  look: Look;
  readonly isAdmin: boolean;
  room: Room | null = null;
  alive = true; // flipped by the heartbeat in index.ts

  constructor(socket: WebSocket, ip: string, account: Account) {
    this.id = nextId++;
    this.socket = socket;
    this.ip = ip;
    this.account = account;
    this.name = account.username;
    this.look = { hat: account.loadout.hat, robe: account.loadout.robe };
    this.isAdmin = account.isAdmin;
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
  readonly account = null;
  name: string;
  look: Look = { hat: "classic", robe: "auto" };
  readonly isAdmin = false;
  room: Room | null = null;

  constructor(name: string) {
    this.id = nextId++;
    this.name = name;
  }

  send(): void {}
  sendRaw(): void {}
  kick(): void {}
}
