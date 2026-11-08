/**
 * `fetch` that gives up: after `ms` (API_TIMEOUT_MS by default, the same as `api()`) the request
 * is aborted and the promise rejects with the same friendly ApiFailure `api()` uses, so no
 * button or loading state can wait forever on a request that never answers. A network error
 * becomes ApiFailure "network". The caller still reads the Response as before.
 */
import { API_TIMEOUT_MS, ApiFailure } from "./player";

export const TIMEOUT_MESSAGE = "The track is taking too long to answer. Try again; if it went through, you'll find it on Home under your races.";
export const NETWORK_MESSAGE = "Couldn't reach the track. Check your connection and try again.";

export async function fetchTimed(input: string, init: RequestInit = {}, ms: number = API_TIMEOUT_MS): Promise<Response> {
  const ctrl = typeof AbortController === "undefined" ? null : new AbortController();
  let timedOut = false;
  const timer = ctrl
    ? setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, ms)
    : null;
  // A caller's own signal still cancels (and its abort error reaches the caller unchanged).
  const theirs = init.signal ?? null;
  const onTheirAbort = () => ctrl?.abort();
  if (theirs && ctrl) {
    if (theirs.aborted) ctrl.abort();
    else theirs.addEventListener("abort", onTheirAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, ...(ctrl ? { signal: ctrl.signal } : {}) });
  } catch (err) {
    if (timedOut) throw new ApiFailure(0, "timeout", TIMEOUT_MESSAGE);
    if (theirs?.aborted) throw err;
    throw new ApiFailure(0, "network", NETWORK_MESSAGE);
  } finally {
    if (timer) clearTimeout(timer);
    theirs?.removeEventListener("abort", onTheirAbort);
  }
}

/**
 * Resolves like `promise`, or rejects with an ApiFailure "timeout" after `ms`. For waits that are
 * not a fetch (a service worker getting ready). The underlying work is not cancelled.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = TIMEOUT_MESSAGE): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ApiFailure(0, "timeout", message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
