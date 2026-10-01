import { useCallback, useState } from "react";

/** Progressive rows; a distant keyboard/cursor request opens its page, not its whole prefix. */
export function useRowWindow(initial = 50) {
  const [range, setRange] = useState({ from: 0, size: initial });
  const reveal = useCallback((rank: number) => {
    if (rank < 0) return;
    setRange((r) => rank >= r.from && rank < r.from + r.size ? r : { from: Math.floor(rank / 50) * 50, size: 50 });
  }, []);
  const reset = useCallback(() => setRange({ from: 0, size: initial }), [initial]);
  const more = useCallback(() => setRange((r) => ({ ...r, size: r.size + 50 })), []);
  const previous = useCallback(() => setRange((r) => ({ from: Math.max(0, r.from - 50), size: 50 })), []);
  return { ...range, reveal, reset, more, previous };
}
