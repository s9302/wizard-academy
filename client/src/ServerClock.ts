// An estimate of the server's clock, so server timestamps (when a move was
// received, when your run started) can be compared with "now" on this machine.
//
// Every message stamped with server time is a sample of (server clock - our
// clock), off by however long the message took to arrive. The fastest
// messages give the best (highest) samples, so jump up to those right away
// and only drift down slowly if the network gets slower.

export class ServerClock {
  private offset: number | null = null;

  get ready(): boolean {
    return this.offset !== null;
  }

  note(serverTime: number): void {
    const sample = serverTime - performance.now();
    if (this.offset === null || sample > this.offset) {
      this.offset = sample;
    } else {
      this.offset += (sample - this.offset) * 0.02;
    }
  }

  now(): number {
    return performance.now() + (this.offset ?? 0);
  }
}
