#!/usr/bin/env node
/**
 * Database load per request and per page view, against a LOCAL server started with the query
 * meter on (packages/db queryMeter.ts). Never point this at production.
 *
 *   # server (production build, embedded database, fresh directory):
 *   DB_QUERY_LOG=/tmp/q.log PGLITE_DIR=/tmp/pg USDG_MODE=practice ADMIN_SECRET=local-admin-secret \
 *   CRON_SECRET=local-cron-secret npx next start -p 3311
 *
 *   # this script (the same DB_QUERY_LOG file):
 *   BASE_URL=http://localhost:3311 DB_QUERY_LOG=/tmp/q.log ADMIN_SECRET=local-admin-secret \
 *   CRON_SECRET=local-cron-secret OUT=/tmp/db-load.json node apps/web/e2e/db-load.mjs
 *
 * Every row: statements sent to the database and the time they took, for one request (API rows)
 * or one page view in a real browser (page rows: the document plus everything the page fetches
 * until the network is quiet). Each API row is measured twice: once when the lazy card tick is
 * due (TICK column) and once right after (the tick is throttled per instance).
 * SECTIONS=visitor,player,pages,live,idle,cron runs only those parts. LIVE=0 skips the Live race (it takes about 8 minutes of real time); IDLE_MIN sets how long
 * the idle-tab rows watch an open tab (default 3 minutes each).
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:3311").replace(/\/$/, "");
const LOG = process.env.DB_QUERY_LOG;
const ADMIN = process.env.ADMIN_SECRET ?? "";
const CRON = process.env.CRON_SECRET ?? "";
const OUT = process.env.OUT ?? "";
const WITH_LIVE = process.env.LIVE !== "0";
const IDLE_MIN = Number(process.env.IDLE_MIN ?? 3);
/** Longer than the lazy tick's throttle, so the next request finds the tick due. */
const TICK_GAP_MS = Number(process.env.TICK_GAP_MS ?? 4300);
if (!LOG) throw new Error("DB_QUERY_LOG must name the file the server writes its query log to");

/** SECTIONS=visitor,player,pages,live,idle,cron runs only those parts (default: all), so a long run can be done in pieces. */
const SECTIONS = new Set((process.env.SECTIONS ?? "visitor,player,pages,live,idle,cron").split(",").map((x) => x.trim()));
const on = (section) => SECTIONS.has(section);
/** Results are written after every row, so an interrupted run keeps what it measured. */
const save = () => {
  if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 2));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[db-load ${new Date().toISOString().slice(11, 19)}]`, ...a);
const lines = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);

/** Waits until no statement has been logged for `quietMs` (after-response work included). */
async function settle(quietMs = 350) {
  let n = lines().length;
  for (;;) {
    await sleep(quietMs);
    const m = lines().length;
    if (m === n) return;
    n = m;
  }
}

const rows = [];
async function measure(label, fn, extra = {}) {
  await settle();
  const before = lines().length;
  const t0 = Date.now();
  const res = await fn();
  const wallMs = Date.now() - t0;
  await settle();
  const mine = lines().slice(before);
  const row = {
    label,
    queries: mine.length,
    dbMs: Math.round(mine.reduce((a, l) => a + Number(l.split("\t")[1] ?? 0), 0) * 10) / 10,
    writes: mine.filter((l) => /^(insert|update|delete)/i.test(l.split("\t")[2] ?? "")).length,
    wallMs,
    ...(res && typeof res.status === "function" ? { status: res.status(), cache: res.headers()["cache-control"] ?? "" } : {}),
    ...extra,
  };
  rows.push(row);
  save();
  log(`${label}: ${row.queries} q (${row.writes} writes), ${row.dbMs} ms db${row.status ? `, HTTP ${row.status}` : ""}${row.cache ? `, ${row.cache}` : ""}`);
  return res;
}

/** One API/document request, measured with the tick due and again right after. */
async function both(ctx, label, path, init = {}) {
  const call = () => (init.method === "POST" ? ctx.request.post(`${BASE}${path}`, { data: init.data ?? {}, maxRedirects: 0 }) : ctx.request.get(`${BASE}${path}`, { maxRedirects: 0 }));
  await sleep(TICK_GAP_MS);
  const res = await measure(`${label} [tick due]`, call, { path, tick: true });
  await measure(label, call, { path, tick: false });
  return res;
}

/** A page view in a real browser: the document and every fetch until the network is quiet. */
async function pageView(page, label, path) {
  await sleep(TICK_GAP_MS);
  const calls = {};
  const onRequest = (req) => {
    const u = new URL(req.url());
    if (u.origin !== new URL(BASE).origin || !(u.pathname.startsWith("/api/") || req.resourceType() === "document")) return;
    const key = `${req.method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "[id]")}`;
    calls[key] = (calls[key] ?? 0) + 1;
  };
  page.on("request", onRequest);
  await measure(`page view: ${label}`, async () => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
    await sleep(1500);
  }, { path, page: true, calls });
  page.off("request", onRequest);
  log("  requests:", Object.entries(calls).map(([k, n]) => `${k}${n > 1 ? ` x${n}` : ""}`).join(", "));
}

/** An open tab left alone for `minutes`: statements per minute. */
async function idleTab(page, label, minutes) {
  await settle();
  const before = lines().length;
  await sleep(minutes * 60_000);
  const n = lines().length - before;
  rows.push({ label: `idle tab: ${label}`, queries: n, perMinute: Math.round((n / minutes) * 10) / 10, minutes, idle: true });
  save();
  log(`idle tab: ${label}: ${n} q in ${minutes} min`);
}

/** Requests wait up to three minutes (a busy machine must not turn a slow answer into a failed run). */
function patient(ctx) {
  for (const m of ["get", "post"]) {
    const original = ctx.request[m].bind(ctx.request);
    ctx.request[m] = (url, options = {}) => original(url, { timeout: 180_000, ...options });
  }
  return ctx;
}

async function main() {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    // ------------------------------------------------------------ signed out
    const anon = patient(await browser.newContext({ viewport: { width: 1280, height: 800 } }));
    log("warming up (first request creates the database and publishes the card)");
    await anon.request.get(`${BASE}/`, { timeout: 300_000 });
    await anon.request.get(`${BASE}/api/races`);
    await settle(1000);
    if (on("visitor")) {
    const zero = "00000000-0000-4000-8000-000000000000";
    for (const [label, path] of [
      ["GET / (signed out)", "/"],
      ["GET /races (signed out)", "/races"],
      ["GET /api/me (signed out)", "/api/me"],
      ["GET /api/races (signed out)", "/api/races"],
      ["GET /wiki", "/wiki"],
      ["GET /wiki/quick-start", "/wiki/quick-start"],
      ["GET /hall", "/hall"],
      ["GET /api/hall", "/api/hall"],
      ["GET /league", "/league"],
      ["GET /api/league", "/api/league"],
      ["GET /news", "/news"],
      ["GET /api/news", "/api/news"],
      ["GET /tipsters", "/tipsters"],
      ["GET /api/tipsters", "/api/tipsters"],
      ["GET /play", "/play"],
      [`GET /race/<unknown>`, `/race/${zero}`],
    ]) {
      await both(anon, label, path);
    }
    await both(anon, "POST /api/events (signed out, 1 page_view)", "/api/events", { method: "POST", data: { events: [{ name: "page_view", route: "/" }] } });
    const anonPage = await anon.newPage();
    await pageView(anonPage, "/ (signed out)", "/");
    await pageView(anonPage, "/races (signed out)", "/races");
    await pageView(anonPage, "/wiki (signed out)", "/wiki");
    await anonPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await idleTab(anonPage, "/ signed out, visible", Math.min(IDLE_MIN, 2));
    await anonPage.close();
    }

    // ------------------------------------------------------------ signed in
    const ctx = patient(await browser.newContext({ viewport: { width: 1280, height: 800 } }));
    const founded = await measure("POST /api/account (found a stable)", () =>
      ctx.request.post(`${BASE}/api/account`, { data: { stableName: `Load Lodge ${Date.now() % 100000}`, silks: { pattern: "solid", primary: "#1f6f4a", secondary: "#f2e8c9", cap: "#1f6f4a" }, timezone: "UTC" } }),
    );
    if (founded.status() !== 201) throw new Error(`founding failed: HTTP ${founded.status()} ${await founded.text()}`);
    const player = (await founded.json()).player;
    const horseId = player.horses[0].id;
    if (on("player")) {
    for (const [label, path] of [
      ["GET / (signed in)", "/"],
      ["GET /api/me", "/api/me"],
      ["GET /api/home", "/api/home"],
      ["GET /api/engage", "/api/engage"],
      ["GET /api/social/home", "/api/social/home"],
      ["GET /api/notifications/count", "/api/notifications/count"],
      ["GET /api/notifications", "/api/notifications"],
      ["GET /races (signed in)", "/races"],
      ["GET /api/races (signed in)", "/api/races"],
      ["GET /api/races/live-wait", "/api/races/live-wait"],
      ["GET /stable", "/stable"],
      ["GET /horse/[id]", `/horse/${horseId}`],
      ["GET /api/horses/[id]", `/api/horses/${horseId}`],
      ["GET /api/story", "/api/story"],
      ["GET /api/picks/today", "/api/picks/today"],
    ]) {
      await both(ctx, label, path);
    }
    await both(ctx, "POST /api/events (signed in, 1 page_view)", "/api/events", { method: "POST", data: { events: [{ name: "page_view", route: "/" }] } });
    }

    // Story race, skipped to the result: a finished race page.
    const story = await measure("POST /api/races/quick (Story, instant)", () => ctx.request.post(`${BASE}/api/races/quick`, { data: { pick: "auto", instant: true } }));
    const storyId = story.status() === 201 ? (await story.json()).raceId : null;
    if (storyId && on("player")) {
      await sleep(1500);
      for (const [label, path] of [
        ["GET /race/[id] (Story, finished)", `/race/${storyId}`],
        ["GET /api/races/[id] (Story, finished)", `/api/races/${storyId}`],
        ["GET /api/races/[id]/replay (finished)", `/api/races/${storyId}/replay`],
        ["GET /api/races/[id]/live?w=0 (finished)", `/api/races/${storyId}/live?w=0`],
        ["GET /api/races/[id]/me (finished)", `/api/races/${storyId}/me`],
      ]) {
        await both(ctx, label, path);
      }
    } else log("story race not created:", story.status(), (await story.text()).slice(0, 200));

    const page = await ctx.newPage();
    if (on("pages")) {
    await pageView(page, "/ (signed in)", "/");
    await pageView(page, "/races (signed in)", "/races");
    await pageView(page, "/stable", "/stable");
    await pageView(page, "/horse/[id]", `/horse/${horseId}`);
    await pageView(page, "/me", "/me");
    if (storyId) await pageView(page, "/race/[id] (Story, finished)", `/race/${storyId}`);
    }

    // ------------------------------------------------------------ a Live race, in real time
    let liveId = null;
    if (WITH_LIVE && ADMIN && on("live")) {
      const pick = await measure("POST /api/races/live-pick (enter a Live race)", () => ctx.request.post(`${BASE}/api/races/live-pick`, { data: {} }));
      if (pick.status() === 201) {
        liveId = (await pick.json()).pick?.raceId ?? null;
      } else log("live pick declined:", pick.status(), (await pick.text()).slice(0, 200));
    }
    if (liveId) {
      const moved = await ctx.request.post(`${BASE}/api/admin/races/${liveId}/start-early`, { data: { minutes: 5 }, headers: { "x-admin-secret": ADMIN } });
      const postTimeMs = (await moved.json()).postTimeMs;
      if (!postTimeMs) throw new Error(`start-early failed: ${moved.status()} ${await moved.text()}`);
      log("live race", liveId, "off at", new Date(postTimeMs).toISOString());
      await both(ctx, "GET /race/[id] (Live, entries open)", `/race/${liveId}`);
      await both(ctx, "GET /api/races/[id] (Live, entries open)", `/api/races/${liveId}`);
      await both(ctx, "GET /api/races/live-wait (entered)", `/api/races/live-wait?raceId=${liveId}`);
      await pageView(page, "/race/[id] (Live, entries open)", `/race/${liveId}`);
      // An idle tab on Home while the race is pending (the signed-in pollers).
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const idleFor = Math.max(0.5, Math.min(IDLE_MIN, (postTimeMs - 45_000 - Date.now()) / 60_000));
      await idleTab(page, "/ signed in, visible, race pending", Math.round(idleFor * 10) / 10);
      // After entries close (30 s before the off): the locked field and the gate countdown.
      while (Date.now() < postTimeMs - 22_000) await sleep(1000);
      await measure("GET /race/[id] (Live, field locked) [tick due]", () => ctx.request.get(`${BASE}/race/${liveId}`), { tick: true });
      await measure("GET /api/races/[id]/live?w=0 (before the off)", () => ctx.request.get(`${BASE}/api/races/${liveId}/live?w=0`));
      while (Date.now() < postTimeMs + 12_000) await sleep(500);
      await measure("GET /race/[id] (Live, running) [tick due]", () => ctx.request.get(`${BASE}/race/${liveId}`), { tick: true });
      await measure("GET /race/[id] (Live, running)", () => ctx.request.get(`${BASE}/race/${liveId}`));
      await measure("GET /api/races/[id]/live?w=0 (running, complete window)", () => ctx.request.get(`${BASE}/api/races/${liveId}/live?w=0`));
      await measure("GET /api/races/[id]/live?w=1 (running)", () => ctx.request.get(`${BASE}/api/races/${liveId}/live?w=1`));
      await measure("GET /api/races (a race is live)", () => ctx.request.get(`${BASE}/api/races`));
      // Watch in the browser: everything the race page asks for over 30 s of live broadcast.
      await measure("page: /race/[id] live for 30 s (one viewer)", async () => {
        await page.goto(`${BASE}/race/${liveId}`, { waitUntil: "domcontentloaded" });
        await sleep(30_000);
      }, { page: true });
      // Until the result is official.
      const deadline = Date.now() + 6 * 60_000;
      for (;;) {
        const r = await ctx.request.get(`${BASE}/api/races/${liveId}/replay`);
        if (r.status() === 200 || Date.now() > deadline) break;
        await sleep(3000);
      }
      await sleep(6000);
      await both(ctx, "GET /race/[id] (Live, finished)", `/race/${liveId}`);
      await both(ctx, "GET /api/races/[id] (Live, finished)", `/api/races/${liveId}`);
      await both(ctx, "GET /api/races/[id]/replay (Live, finished)", `/api/races/${liveId}/replay`);
      await both(ctx, "GET /api/races/[id]/live?w=0 (Live, finished)", `/api/races/${liveId}/live?w=0`);
      await pageView(page, "/race/[id] (Live, finished)", `/race/${liveId}`);
      await both(anon, "GET /race/[id] (Live, finished, signed out)", `/race/${liveId}`);
    }

    // ------------------------------------------------------------ idle tabs
    // Nobody touches the page: the first minutes after a load, then the minutes after that
    // (pollers stop for an idle tab), then the same tab hidden, then /races.
    if (on("idle")) {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await idleTab(page, "/ signed in, visible, minutes 0-3 after the load", IDLE_MIN);
    await idleTab(page, "/ signed in, visible, minutes 3-6 (no input)", IDLE_MIN);
    const hiddenPage = await ctx.newPage();
    await hiddenPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await hiddenPage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.close();
    await idleTab(hiddenPage, "/ signed in, hidden", IDLE_MIN);
    await hiddenPage.close();
    const racesPage = await ctx.newPage();
    await racesPage.goto(`${BASE}/races`, { waitUntil: "networkidle" });
    await idleTab(racesPage, "/races signed in, visible", IDLE_MIN);
    await racesPage.close();
    }

    // ------------------------------------------------------------ crons
    if (CRON && on("cron")) {
      await measure("GET /api/cron/race-card", () => ctx.request.get(`${BASE}/api/cron/race-card`, { headers: { authorization: `Bearer ${CRON}` } }));
      await measure("GET /api/cron/chain", () => ctx.request.get(`${BASE}/api/cron/chain`, { headers: { authorization: `Bearer ${CRON}` } }));
    }
  } finally {
    await browser.close();
    if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 2));
  }
  console.log("\nlabel\tqueries\twrites\tdb ms\tstatus\tcache-control");
  for (const r of rows) console.log(`${r.label}\t${r.queries}${r.perMinute !== undefined ? ` (${r.perMinute}/min)` : ""}\t${r.writes ?? ""}\t${r.dbMs ?? ""}\t${r.status ?? ""}\t${r.cache ?? ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
