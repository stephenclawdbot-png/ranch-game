/**
 * Painted-art cache in IndexedDB (works in workers and pages, no DOM): a horse strip or portrait
 * painted once on a device is kept, so the next page (and the next visit) draws it without
 * painting again. Values are small records of PNG blobs, keyed by everything that changes their
 * pixels. The whole store is cleared when the version changes (the painter's version and the
 * deployed build), and it is trimmed to the most recently used entries.
 *
 * Every call fails soft: no IndexedDB (private windows, blocked storage, tests) simply means
 * no cache, never an error.
 */

const DB = "post-time-paint";
const STORE = "art";
const META = "meta";
/** Entries kept (a strip is ~5-60 KB as PNG). */
const MAX_ENTRIES = 600;

export interface PaintCache {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
}

const NONE: PaintCache = { get: async () => null, put: async () => undefined };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

const opened = new Map<string, Promise<PaintCache>>();

/** The cache for this version (one connection per version per thread). */
export function paintCache(version: string): Promise<PaintCache> {
  let p = opened.get(version);
  if (!p) {
    p = open(version).catch(() => NONE);
    opened.set(version, p);
  }
  return p;
}

async function open(version: string): Promise<PaintCache> {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return NONE;
  const r = idb.open(DB, 1);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE).createIndex("t", "t");
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
  };
  const db = await req(r);
  // a new painter or a new deploy: everything painted before is thrown away
  {
    const tx = db.transaction([META, STORE], "readwrite");
    const meta = tx.objectStore(META);
    const v = await req(meta.get("version"));
    if (v !== version) {
      tx.objectStore(STORE).clear();
      meta.put(version, "version");
    }
    await done(tx);
  }
  let puts = 0;
  const trim = async () => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const n = await req(store.count());
    if (n > MAX_ENTRIES) {
      let drop = n - Math.floor(MAX_ENTRIES * 0.8);
      const cur = store.index("t").openCursor();
      await new Promise<void>((res) => {
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || drop <= 0) return res();
          c.delete();
          drop--;
          c.continue();
        };
        cur.onerror = () => res();
      });
    }
    await done(tx);
  };
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const tx = db.transaction(STORE, "readonly");
        const rec = (await req(tx.objectStore(STORE).get(key))) as { v: T; t: number } | undefined;
        if (!rec) return null;
        // most recently used: touch it now and then (a write per read would cost more than it saves)
        if (Date.now() - rec.t > 86_400_000) void touch(key, rec);
        return rec.v;
      } catch {
        return null;
      }
    },
    async put(key: string, value: unknown): Promise<void> {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ v: value, t: Date.now() }, key);
        await done(tx);
        if (++puts % 25 === 0) await trim();
      } catch {
        /* full or blocked: no cache */
      }
    },
  };
  async function touch(key: string, rec: { v: unknown; t: number }) {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ v: rec.v, t: Date.now() }, key);
      await done(tx);
    } catch {
      /* ignore */
    }
  }
}

/** The deployed build (layout's <meta name="build">), part of every cache version. Page only. */
export function deployedBuild(): string {
  try {
    return document.querySelector('meta[name="build"]')?.getAttribute("content") ?? "dev";
  } catch {
    return "dev";
  }
}
