// Thin wrapper around the browser WebSocket. Connects to /ws on the same host
// the page came from, so it works over plain HTTP locally and HTTPS publicly.

import type { ClientMsg, ServerMsg } from "../../shared/src/protocol.ts";

export type NetHandlers = {
  onMessage: (msg: ServerMsg) => void;
  // kicked: the server hung up on purpose (code 4000, with a reason);
  // otherwise the connection just dropped and trying again may work.
  onClose: (reason: string, kicked: boolean) => void;
};

export class Net {
  private socket: WebSocket;
  private lastError = "";
  private wasOpen = false;
  private closedByUs = false;

  constructor(handlers: NetHandlers) {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    this.socket = new WebSocket(`${scheme}://${location.host}/ws`);

    this.socket.addEventListener("message", (event) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(event.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "error") this.lastError = msg.message;
      handlers.onMessage(msg);
    });

    this.socket.addEventListener("open", () => (this.wasOpen = true));
    this.socket.addEventListener("close", (event) => {
      if (this.closedByUs) return; // leaving on purpose isn't a disconnect
      // A refused handshake (e.g. the session cookie expired) never opens.
      const fallback = this.wasOpen ? "Lost connection to the server." : "Could not connect. Your session may have expired.";
      handlers.onClose(this.lastError || event.reason || fallback, event.code === 4000);
    });
  }

  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("close", () => reject(new Error("Could not connect.")), { once: true });
    });
  }

  // Leave on purpose (Exit). The server sees the socket close and removes us
  // from the room; onClose is not called.
  // Resolves when the socket has closed (or after a second, whatever happens).
  close(): Promise<void> {
    this.closedByUs = true;
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    const done = new Promise<void>((resolve) => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
      setTimeout(resolve, 1000);
    });
    this.socket.close(1000, "Left the room");
    return done;
  }

  send(msg: ClientMsg): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
