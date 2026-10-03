// Rate limiting helpers.

// Group addresses the way an attacker would have to "own" them. One IPv4
// address is one key. For IPv6, anyone with a single connection usually
// controls a whole /64 (2^64 addresses), so per-address limits are useless;
// key on the /64 prefix instead.
export function rateLimitKey(ip: string): string {
  if (ip.startsWith("::ffff:") && ip.includes(".")) return ip.slice(7); // IPv4-mapped
  if (!ip.includes(":")) return ip;

  const [head, tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const full = [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts];
  return full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

// Counts events (e.g. failed PIN attempts) per key in a sliding time window.
export class SlidingWindowLimiter {
  private events = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(max: number, windowMs: number, maxKeys = 10_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  private recent(key: string, now: number): number[] {
    const list = (this.events.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.events.set(key, list);
    else this.events.delete(key);
    return list;
  }

  // How long until this key may try again (0 = allowed now).
  retryAfterMs(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.max) return 0;
    return list[list.length - this.max] + this.windowMs - now;
  }

  record(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.events.set(key, list);
    if (this.events.size > this.maxKeys) this.sweep(now);
  }

  // Drop expired keys; if an attacker is still flooding us with new keys,
  // drop the oldest ones so memory stays bounded.
  sweep(now = Date.now()): void {
    for (const key of [...this.events.keys()]) this.recent(key, now);
    for (const key of this.events.keys()) {
      if (this.events.size <= this.maxKeys) break;
      this.events.delete(key);
    }
  }
}

// Classic token bucket: holds up to `capacity` tokens, refills at `perSecond`.
// Each message costs one token; an empty bucket means "too fast".
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perSecond: number;

  constructor(capacity: number, perSecond: number, now = Date.now()) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.tokens = capacity;
    this.last = now;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
