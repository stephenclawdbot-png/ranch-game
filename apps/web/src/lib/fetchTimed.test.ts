import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTimed, withTimeout } from "./fetchTimed";
import { ApiFailure } from "./player";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A fetch that never answers until its signal aborts (a server that hangs). */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
}

describe("fetchTimed", () => {
  it("passes a normal answer through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    const r = await fetchTimed("/x");
    expect(await r.json()).toEqual({ ok: true });
  });

  it("gives up after the timeout with the friendly 'try again'", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const p = fetchTimed("/x", {}, 1000);
    const check = expect(p).rejects.toMatchObject({ code: "timeout", status: 0 });
    await vi.advanceTimersByTimeAsync(1001);
    await check;
  });

  it("a caller's own abort still reaches the caller as an abort", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const mine = new AbortController();
    const p = fetchTimed("/x", { signal: mine.signal }, 10_000);
    mine.abort();
    const err = await p.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiFailure);
    expect((err as Error).name).toBe("AbortError");
  });

  it("a network error is ApiFailure 'network'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await fetchTimed("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).code).toBe("network");
  });
});

describe("withTimeout", () => {
  it("resolves in time, rejects when the wait never ends", async () => {
    await expect(withTimeout(Promise.resolve(3), 50)).resolves.toBe(3);
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => undefined), 500);
    const check = expect(p).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(501);
    await check;
  });
});
