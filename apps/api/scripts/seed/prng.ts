/** Seeded random numbers, so every reseed with the same --seed produces the same data (mulberry32). */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number;
  /** Float in [lo, hi). */
  float(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T;
  shuffle<T>(items: readonly T[]): T[];
  /** UUID v4 format, deterministic. */
  uuid(): string;
  /** `bytes` random bytes as base64url (impact tokens). */
  token(bytes: number): string;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => int(0, 255));

  return {
    next,
    int,
    float: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from an empty list");
      return items[int(0, items.length - 1)]!;
    },
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        if ((r -= w) < 0) return v;
      }
      return items[items.length - 1]![0];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    uuid: () => {
      const b = bytes(16);
      b[6] = (b[6]! & 0x0f) | 0x40; // version 4
      b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    token: (n) => Buffer.from(bytes(n)).toString("base64url"),
  };
}
