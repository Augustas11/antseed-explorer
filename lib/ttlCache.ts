interface TtlCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCache<T> {
  get: () => Promise<T>;
  clear: () => void;
}

export function createTtlCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = () => Date.now(),
): TtlCache<T> {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error("ttlMs must be a finite non-negative number");
  }

  let entry: TtlCacheEntry<T> | null = null;
  let inflight: Promise<T> | null = null;

  const get = async (): Promise<T> => {
    const current = now();
    if (entry && current < entry.expiresAt) {
      return entry.value;
    }
    if (inflight) return inflight;

    inflight = load()
      .then((value) => {
        entry = { value, expiresAt: now() + ttlMs };
        return value;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  };

  return {
    get,
    clear() {
      entry = null;
      inflight = null;
    },
  };
}
