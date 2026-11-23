import { useCallback, useEffect, useRef, useState } from "react";

/** State returned by {@link usePoll}. */
export interface PollState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  /** Fetches again now (e.g. after an action). */
  reload: () => Promise<void>;
}

/**
 * Loads `load()` once, then every `intervalMs` (0 = load once). The loader returns
 * `{ data }` or `{ error }` (a message), matching how Eden results are unwrapped.
 */
export function usePoll<T>(
  load: () => Promise<{ data?: T; error?: string }>,
  intervalMs: number,
): PollState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await loader.current();
    setLoading(false);
    if (result.error !== undefined) setError(result.error);
    else {
      setError(undefined);
      setData(result.data);
    }
  }, []);

  useEffect(() => {
    void reload();
    if (intervalMs <= 0) return undefined;
    const timer = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs]);

  return { data, error, loading, reload };
}
