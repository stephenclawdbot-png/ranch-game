/** Device tier: lite from cheap signals, the player's override and its persistence, measured drops. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tierFromSignals, resolveTier, median } from "./deviceTier";

describe("tier from signals", () => {
  it("lite on low memory, few cores, Save-Data or no worker painting; full otherwise", () => {
    expect(tierFromSignals({ deviceMemory: 8, hardwareConcurrency: 8, saveData: false, workerPaint: true })).toEqual({ tier: "full", reason: null });
    expect(tierFromSignals({ deviceMemory: 4, hardwareConcurrency: 8 }).tier).toBe("lite");
    expect(tierFromSignals({ deviceMemory: 2 }).reason).toBe("memory");
    expect(tierFromSignals({ deviceMemory: 8, hardwareConcurrency: 4 }).reason).toBe("cores");
    expect(tierFromSignals({ hardwareConcurrency: 2 }).tier).toBe("lite");
    expect(tierFromSignals({ deviceMemory: 8, hardwareConcurrency: 12, saveData: true }).reason).toBe("save-data");
    expect(tierFromSignals({ deviceMemory: 8, hardwareConcurrency: 12, workerPaint: false }).reason).toBe("no-worker");
    // absent signals (Safari, Firefox: no deviceMemory) are no reason
    expect(tierFromSignals({ hardwareConcurrency: 8, workerPaint: true }).tier).toBe("full");
    expect(tierFromSignals({}).tier).toBe("full");
  });

  it("the player's setting wins; Auto keeps a measured drop", () => {
    const strong = { deviceMemory: 8, hardwareConcurrency: 8, workerPaint: true };
    const weak = { deviceMemory: 2, hardwareConcurrency: 4 };
    expect(resolveTier("full", weak, null)).toMatchObject({ tier: "full", auto: false });
    expect(resolveTier("lite", strong, null)).toMatchObject({ tier: "lite", auto: false });
    expect(resolveTier("auto", strong, null)).toMatchObject({ tier: "full", auto: true });
    expect(resolveTier("auto", weak, null)).toMatchObject({ tier: "lite", auto: true, reason: "memory" });
    expect(resolveTier("auto", strong, { tier: "lite", reason: "slow-frames" })).toMatchObject({ tier: "lite", auto: true, reason: "slow-frames" });
    expect(resolveTier("full", strong, { tier: "lite", reason: "slow-frames" }).tier).toBe("full");
  });

  it("median", () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

// ----------------------------------------------------------------------------- in a "browser"

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

function fakeBrowser(nav: Record<string, unknown>, storage: MemStorage | null) {
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    addEventListener: (t: string, cb: () => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(cb),
    removeEventListener: (t: string, cb: () => void) => listeners.get(t)?.delete(cb),
    dispatchEvent: (e: { type: string }) => {
      listeners.get(e.type)?.forEach((l) => l());
      return true;
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { documentElement: { dataset: {} as Record<string, string> } });
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("Event", class {
    constructor(public type: string) {}
  });
  if (storage) vi.stubGlobal("localStorage", storage);
  else
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
}

describe("in a browser", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const strong = { deviceMemory: 8, hardwareConcurrency: 8 };

  it("registers with art-pipeline: builds follow the tier and the setting, and the setting persists", async () => {
    const ls = new MemStorage();
    fakeBrowser(strong, ls);
    const art = await import("@thoroughbred/art-pipeline");
    art.setBuildSwitch(null);
    const t = await import("./deviceTier");
    // no OffscreenCanvas here: Auto picks lite (no worker painting)
    expect(t.tierState()).toMatchObject({ detail: "auto", tier: "lite", reason: "no-worker" });
    expect(art.buildsOn()).toBe(false);
    t.setHorseDetail("full");
    expect(ls.getItem(t.DETAIL_KEY)).toBe("full");
    expect(art.buildsOn()).toBe(true);
    expect((document.documentElement.dataset as Record<string, string>).tier).toBe("full");
    // a new page view reads it back
    vi.resetModules();
    const t2 = await import("./deviceTier");
    expect(t2.tierState().detail).toBe("full");
    t2.setHorseDetail("auto");
    expect(ls.getItem(t2.DETAIL_KEY)).toBeNull();
    art.setDeviceBuilds(null);
  });

  it("Auto drops a slow full device to lite for good and shows the note once; a pinned setting does not drop", async () => {
    const ls = new MemStorage();
    fakeBrowser(strong, ls);
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("createImageBitmap", async () => ({}));
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() {
        return {};
      }
    });
    const t = await import("./deviceTier");
    expect(t.tierState()).toMatchObject({ tier: "full", auto: true });
    expect(t.liteNoteDue()).toBe(false);
    t.reportPaintMs(400);
    t.reportFrameMedian(20);
    expect(t.currentTier()).toBe("full");
    t.reportFrameMedian(55);
    expect(t.tierState()).toMatchObject({ tier: "lite", auto: true, reason: "slow-frames" });
    expect(JSON.parse(ls.getItem(t.AUTO_KEY)!)).toMatchObject({ tier: "lite", reason: "slow-frames" });
    expect(t.liteNoteDue()).toBe(true);
    t.dismissLiteNote();
    expect(t.liteNoteDue()).toBe(false);
    // remembered on the next visit
    vi.resetModules();
    const t2 = await import("./deviceTier");
    expect(t2.currentTier()).toBe("lite");
    // the player pins Full: no drop, no note
    t2.setHorseDetail("full");
    t2.reportPaintMs(5000);
    expect(t2.currentTier()).toBe("full");
    expect(t2.liteNoteDue()).toBe(false);
    (await import("@thoroughbred/art-pipeline")).setDeviceBuilds(null);
  });

  it("blocked storage: no errors, Auto from the signals", async () => {
    fakeBrowser({ deviceMemory: 2, hardwareConcurrency: 8 }, null);
    const t = await import("./deviceTier");
    expect(t.tierState()).toMatchObject({ tier: "lite", reason: "memory" });
    expect(() => t.setHorseDetail("full")).not.toThrow();
    expect(() => t.dismissLiteNote()).not.toThrow();
    (await import("@thoroughbred/art-pipeline")).setDeviceBuilds(null);
  });
});
