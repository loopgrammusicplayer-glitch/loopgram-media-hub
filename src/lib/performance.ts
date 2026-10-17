// Shared latency budgets: targets, not measured service guarantees.
export const PERFORMANCE = {
  feedbackTargetMs: 50,
  cachedRequestTargetMs: 200,
  searchDebounceMs: 250,
  redisTimeoutMs: 1000,
  databaseTimeoutMs: 8000,
  uploadTimeoutMs: 120000,
  cacheEntries: 500,
  cacheInflight: 128,
  cacheLocalMs: 5000,
} as const;

export function latestRequest() {
  let generation = 0;
  return { invalidate: () => ++generation, isCurrent: (id: number) => id === generation };
}

// For raw HTTP only. TanStack server-function RPC keeps its own protocol.
export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number = PERFORMANCE.databaseTimeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}