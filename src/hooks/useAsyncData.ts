import { useCallback, useEffect, useState } from 'react';

export interface AsyncDataState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Small loader hook for UI views: tracks loading / error / data and ignores
 * results from stale requests. `load` must be memoised by the caller
 * (useCallback); pass `null` to load nothing.
 */
export function useAsyncData<T>(load: (() => Promise<T>) | null): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!load) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);

    load()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [load, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, isLoading, error, reload };
}
