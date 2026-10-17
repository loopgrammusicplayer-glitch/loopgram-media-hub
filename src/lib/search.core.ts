// Pure search helpers (no I/O) so behaviour is unit-tested.
export const SEARCH = { maxTerms: 6, minTerm: 2, cacheTtlSeconds: 60, perPage: 12 } as const;

/** Lowercase, split on non-word chars, drop tiny/duplicate terms, cap the count (bounded work per query). */
export function tokenize(q: string): string[] {
  const seen = new Set<string>();
  for (const t of q.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    if (t.length >= SEARCH.minTerm) seen.add(t);
    if (seen.size >= SEARCH.maxTerms) break;
  }
  return [...seen];
}

/** Every term must appear somewhere in the fields; score = title hits weigh more. 0 = no match. */
export function score(terms: string[], title: string, ...rest: (string | string[])[]): number {
  if (!terms.length) return 0;
  const t = title.toLowerCase();
  const body = rest.map((f) => (Array.isArray(f) ? f.join(" ") : f)).join(" ").toLowerCase();
  let s = 0;
  for (const term of terms) {
    if (t.includes(term)) s += 3;
    else if (body.includes(term)) s += 1;
    else return 0;
  }
  return s;
}

/** Cache key: catalogue version + normalized terms + offset, so a publish/unpublish instantly orphans old results. */
export function searchCacheKey(version: string | number, terms: string[], offset: number) {
  return `srch:${version}:${[...terms].sort().join("+")}:${offset}`;
}

/** Valid listing cursor: the sort key of the last item seen (ISO time # id), or a numeric offset for legacy tables. */
export function isValidCursor(c: string) {
  return /^\d{1,6}$/.test(c) || /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f-]{36}$/i.test(c);
}
