export interface RoomSizeWeight {
  size: number;
  weight: number;
}

/**
 * Room sizes for casual calls: mostly pairs and small groups, a thin tail up to the cap of ten.
 * The weights are a plausible starting point, not measured; override them to match real traffic.
 */
export const DEFAULT_ROOM_SIZES: RoomSizeWeight[] = [
  { size: 2, weight: 40 },
  { size: 3, weight: 22 },
  { size: 4, weight: 16 },
  { size: 5, weight: 9 },
  { size: 6, weight: 6 },
  { size: 7, weight: 3 },
  { size: 8, weight: 2 },
  { size: 9, weight: 1 },
  { size: 10, weight: 1 },
];

export type Random = () => number;

/** A small seedable generator, so a run can be repeated exactly. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleSize(weights: RoomSizeWeight[], random: Random): number {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let pick = random() * total;
  for (const w of weights) {
    pick -= w.weight;
    if (pick < 0) return w.size;
  }
  return weights[weights.length - 1]!.size;
}

/** Splits `users` into room sizes drawn from `weights`; the last room takes whatever remains (at least one person). */
export function planRooms(users: number, weights: RoomSizeWeight[], random: Random): number[] {
  const rooms: number[] = [];
  let remaining = users;
  while (remaining > 0) {
    const size = Math.min(sampleSize(weights, random), remaining);
    rooms.push(size);
    remaining -= size;
  }
  return rooms;
}

/** Exponentially distributed session length with the given mean, never shorter than `minSeconds`. */
export function sampleSessionSeconds(meanSeconds: number, random: Random, minSeconds = 10): number {
  return Math.max(minSeconds, -Math.log(1 - random()) * meanSeconds);
}
