// A "peer" is anyone in a room: a real player's WebSocket Connection, or a
// server-side bot (BotPeer). Rooms only talk to the Peer interface, so bots
// play by exactly the same room code as people.

import { WebSocket } from "ws";
import type { ServerMsg } from "../../shared/src/protocol.ts";
import { DEFAULT_LOOK, type Look, lookOf } from "../../shared/src/unlocks.ts";
import { randomAppearance } from "../../shared/src/appearance.ts";
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
  rtt: number; // round trip to the client in ms (0 for bots)
  send(msg: ServerMsg): void;
  sendRaw(text: string): void; // an already-serialized message (broadcasts)
  kick(message: string): void;
}

// Clients send ~20 moves per second. Two limits:
// - Normal: bursts (a lag spike, clicking a button fast) are fine; past this
//   rate, extra messages are dropped quietly and the player stays connected.
// - Flood: several times that rate means a broken or hostile client: kicked.
const MESSAGE_BURST = 60;
const MESSAGES_PER_SECOND = 30;
const FLOOD_BURST = 150;
const FLOOD_PER_SECOND = 60;

let nextId = 1;

export class Connection implements Peer {
  readonly id: number;
  readonly isBot = false;
  readonly socket: WebSocket;
  readonly ip: string; // rate-limit key, see limits.ts
  readonly account: Account;
  readonly messageBudget = new TokenBucket(MESSAGE_BURST, MESSAGES_PER_SECOND);
  readonly floodBudget = new TokenBucket(FLOOD_BURST, FLOOD_PER_SECOND);
  droppedMessages = 0;
  name = "";
  look: Look;
  readonly isAdmin: boolean;
  room: Room | null = null;
  alive = true; // flipped by the heartbeat in index.ts
  pingAt = 0; // when the last heartbeat ping went out
  rtt = 100; // round trip in ms, smoothed over pings (a guess until the first)
  measured = false;

  constructor(socket: WebSocket, ip: string, account: Account) {
    this.id = nextId++;
    this.socket = socket;
    this.ip = ip;
    this.account = account;
    this.name = account.username;
    this.look = lookOf(account.loadout);
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
  look: Look;
  readonly isAdmin = false;
  room: Room | null = null;
  readonly rtt = 0;

  constructor(name: string) {
    this.id = nextId++;
    this.name = name;
    // Every bot looks a little different.
    this.look = { ...DEFAULT_LOOK, ...randomAppearance(this.id * 7919) };
  }

  send(): void {}
  sendRaw(): void {}
  kick(): void {}
}
