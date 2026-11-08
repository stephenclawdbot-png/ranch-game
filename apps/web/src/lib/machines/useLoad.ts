"use client";
/**
 * React side of LOAD_MACHINE (./load.ts). Fetches on mount and whenever `key` changes; a newer
 * load always wins over an older one still in flight. `retryMs` retries a failure on its own
 * (e.g. [2000, 5000, 10000]); `reload()` is the Try again button.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { LOAD_START, loadReducer, type LoadState } from "./load";

export interface Load<T> extends LoadState<T> {
  reload: () => void;
}

export function useLoad<T>(fetcher: (() => Promise<T>) | null, key: string, opts: { retryMs?: readonly number[] } = {}): Load<T> {
  const [state, dispatch] = useReducer(loadReducer<T>, undefined, LOAD_START<T>);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const retryMs = opts.retryMs;
  const retryKey = retryMs?.join(",") ?? "";

  const start = useCallback((attempt: number) => {
    const f = fetcherRef.current;
    if (!f) return;
    const id = ++seq.current;
    dispatch({ type: "load" });
    f().then(
      (data) => {
        if (id === seq.current) dispatch({ type: "loaded", data });
      },
      (error: unknown) => {
        if (id !== seq.current) return;
        dispatch({ type: "fail", error });
        const wait = retryMs?.[attempt];
        if (wait !== undefined) {
          setTimeout(() => {
            if (id === seq.current) start(attempt + 1);
          }, wait);
        }
      },
    );
    // retryMs is captured by retryKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const enabled = fetcher !== null;
  useEffect(() => {
    if (!enabled) return;
    start(0);
    return () => {
      seq.current++;
    };
  }, [key, enabled, start]);

  const reload = useCallback(() => start(0), [start]);
  return { ...state, reload };
}
