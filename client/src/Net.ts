// Thin wrapper around the browser WebSocket. Connects to /ws on the same host
// the page came from, so it works over plain HTTP locally and HTTPS publicly.

import type { ClientMsg, ServerMsg } from "../../shared/src/protocol.ts";

export type NetHandlers = {
  onMessage: (msg: ServerMsg) => void;
  onClose: (reason: string) => void;
};

export class Net {
  private socket: WebSocket;
  private lastError = "";
  private wasOpen = false;

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
      // A refused handshake (e.g. the session cookie expired) never opens.
      const fallback = this.wasOpen ? "Lost connection to the server." : "Could not connect. Your session may have expired.";
      handlers.onClose(this.lastError || event.reason || fallback);
    });
  }

  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("close", () => reject(new Error("Could not connect.")), { once: true });
    });
  }

  send(msg: ClientMsg): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
