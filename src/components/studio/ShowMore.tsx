import { useState } from "react";

/** Incremental rendering for long Studio lists: shows `step` items, then more on demand. */
export function usePaged<T>(items: T[] | undefined, step = 30) {
  const [n, setN] = useState(step);
  const list = items ?? [];
  return {
    visible: list.slice(0, n),
    more: list.length > n ? () => setN((x) => x + step) : null,
    left: Math.max(0, list.length - n),
  };
}

export function ShowMore({ more, left }: { more: (() => void) | null; left: number }) {
  if (!more) return null;
  return (
    <button onClick={more} className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
      Show more ({left} left)
    </button>
  );
}
