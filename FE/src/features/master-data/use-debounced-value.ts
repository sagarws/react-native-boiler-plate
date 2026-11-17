"use client";

import { useEffect, useState } from "react";

/** Value that follows `value` after `delay` ms of no changes (TrackVid `useDebounce`). Timer cleared on change/unmount. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
