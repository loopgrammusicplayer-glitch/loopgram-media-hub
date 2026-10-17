import { PERFORMANCE } from "./performance";

type Flight = { promise: Promise<unknown>; valid: boolean };
export function createCache(options: {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string, ttl: number) => Promise<unknown>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const memory = new Map<string, { value: unknown; expires: number }>();
  const flights = new Map<string, Flight>();
  const metrics = { memoryHit: 0, remoteHit: 0, miss: 0, shared: 0, readFailure: 0, writeFailure: 0, rejected: 0 };
  return {
    metrics,
    forget(...keys: string[]) {
      for (const key of keys) {
        memory.delete(key);
        const flight = flights.get(key);
        if (flight) { flight.valid = false; flights.delete(key); }
      }
    },
    async get<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
      const entry = memory.get(key);
      if (entry && entry.expires > now()) { metrics.memoryHit++; return entry.value as T; }
      const running = flights.get(key);
      if (running) { metrics.shared++; return running.promise as Promise<T>; }
      if (flights.size >= PERFORMANCE.cacheInflight) { metrics.rejected++; throw new Error("Content is busy. Please retry."); }
      const flight: Flight = { promise: Promise.resolve(), valid: true };
      flight.promise = (async () => {
        let value: T | undefined;
        let hit = false;
        try {
          const raw = await options.read(key);
          if (raw !== null) { value = JSON.parse(raw) as T; hit = true; metrics.remoteHit++; }
        } catch { metrics.readFailure++; }
        if (!hit) {
          metrics.miss++;
          value = await load();
          if (flight.valid) {
            try { await options.write(key, JSON.stringify(value), ttl); } catch { metrics.writeFailure++; }
          }
        }
        // Invalidated loads can return to their original caller, but cannot repopulate caches.
        if (flight.valid) {
          if (memory.size >= PERFORMANCE.cacheEntries) memory.delete(memory.keys().next().value ?? "");
          memory.set(key, { value, expires: now() + Math.min(PERFORMANCE.cacheLocalMs, ttl * 1000) });
        }
        return value as T;
      })().finally(() => { if (flights.get(key) === flight) flights.delete(key); });
      flights.set(key, flight);
      return flight.promise as Promise<T>;
    },
  };
}