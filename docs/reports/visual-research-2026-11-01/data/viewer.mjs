// Viewer captures: Trackside and 3D, desktop + phone, key moments; frame strips; perf.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3171";
const OUT = process.env.OUT;
mkdirSync(OUT, { recursive: true });
const MODE = process.env.MODE ?? "stills";
const args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const VP = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function open(browser, vp, q) {
  const ctx = await browser.newContext(VP[vp]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("pageerror", e.message.slice(0, 200)));
  const url = `${BASE}/dev/viewer?${q}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 240000 });
  await page.waitForSelector("canvas", { timeout: 240000 });
  await page.waitForTimeout(6000);
  return { ctx, page };
}

async function stills(browser) {
  const courses = (process.env.COURSES ?? "ashcombe,saltmarsh,harrowgate").split(",");
  const moments = { start: 1.0, mid: 37.06, f200: 62.22, finish: 74.11, post5: 79.11, post12: 86 };
  for (const vp of (process.env.VPS ?? "desktop,phone").split(",")) {
    for (const view of (process.env.VIEWS ?? "trackside,classic").split(",")) {
      for (const course of courses) {
        const extra = process.env.EXTRA ?? "";
        const { existsSync } = await import("node:fs");
        if (existsSync(`${OUT}/${vp}-${view}-${course}-post12${process.env.TAG ?? ""}.png`)) continue;
        const { ctx, page } = await open(browser, vp, `course=${course}&paused=1&t=1&view=${view}&riders=1&coats=showcase&quality=high&hour=14&rvdebug=1&debug=0${extra}`);
        for (const [name, t] of Object.entries(moments)) {
          try {
            await page.evaluate((t) => window.__rvClock?.seek(t), t);
            await page.waitForTimeout(view === "classic" ? 2500 : 1500);
            await page.screenshot({ path: `${OUT}/${vp}-${view}-${course}-${name}${process.env.TAG ?? ""}.png`, timeout: 120000 });
            log(vp, view, course, name);
          } catch (e) { log("fail", vp, view, course, name, e.message.slice(0, 80)); }
        }
        await ctx.close();
      }
    }
  }
}

// Frame strip: step the paused clock 1/12 s at a time around the final furlong.
async function strip(browser) {
  for (const view of ["trackside", "classic"]) {
    for (const vp of ["desktop", "phone"]) {
      const { ctx, page } = await open(browser, vp, `course=ashcombe&paused=1&t=60&view=${view}&riders=1&coats=showcase&quality=high&hour=14&rvdebug=1&debug=0${process.env.EXTRA ?? ""}`);
      const t0 = Number(process.env.T0 ?? 60);
      for (let i = 0; i < 16; i++) {
        await page.evaluate((t) => window.__rvClock?.seek(t), t0 + i / 12);
        await page.waitForTimeout(view === "classic" ? 900 : 500);
        await page.screenshot({ path: `${OUT}/strip-${vp}-${view}-${String(i).padStart(2, "0")}.png` });
      }
      log("strip", view, vp);
      await ctx.close();
    }
  }
}

// Perf: play in real time with the frame-time overlay, read stats and renderer.info.
async function perf(browser) {
  const res = [];
  for (const vp of ["desktop", "phone"]) for (const view of ["trackside", "classic"]) for (const quality of ["high", "low"]) {
    const { ctx, page } = await open(browser, vp, `course=ashcombe&t=30&view=${view}&quality=${quality}&riders=1&debug=1`);
    await page.waitForTimeout(12000);
    // Accumulate renderer.info over one whole frame (all passes, incl. post FX and the PiP).
    const frameInfo = await page.evaluate(async () => {
      const ri = window.__rvScene?.renderer?.info; if (!ri) return null;
      ri.autoReset = false; ri.reset();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const o = { calls: ri.render.calls, triangles: ri.render.triangles, points: ri.render.points, frames: ri.render.frame };
      ri.autoReset = true; return o;
    });
    log("frameInfo", JSON.stringify(frameInfo));
    const r = await page.evaluate(() => {
      const sc = window.__rvScene; const ri = sc?.renderer?.info;
      const gl = sc?.renderer?.getContext?.();
      const dbg = gl?.getExtension?.("WEBGL_debug_renderer_info");
      return {
        stats: window.__rvFrameStats ?? null,
        info: ri ? { calls: ri.render.calls, triangles: ri.render.triangles, points: ri.render.points, lines: ri.render.lines, geometries: ri.memory.geometries, textures: ri.memory.textures, programs: ri.programs?.length } : null,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        canvas: sc?.canvas ? [sc.canvas.width, sc.canvas.height] : null,
        overlay: document.querySelector("pre")?.textContent ?? null,
      };
    });
    const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
    res.push({ vp, view, quality, ...r, frameInfo, heapMB: heap });
    log(vp, view, quality, JSON.stringify(r.info), r.stats && r.stats.median);
    await page.screenshot({ path: `${OUT}/perf-${vp}-${view}-${quality}.png` });
    await ctx.close();
  }
  writeFileSync(`${OUT}/perf.json`, JSON.stringify(res, null, 1));
}

// Finale / build-up stills.
async function finale(browser) {
  for (const vp of ["desktop", "phone"]) for (const view of ["trackside", "classic"]) {
    const { ctx, page } = await open(browser, vp, `course=saltmarsh&paused=1&t=74&view=${view}&riders=1&coats=showcase&quality=high&rvdebug=1&debug=0&minepos=6`);
    const steps = await page.evaluate(() => window.__rvFinale?.steps?.() ?? []);
    log("finale steps", steps.join(","));
    await page.evaluate(() => window.__rvClock?.seek(76));
    for (let i = 0; i < steps.length; i++) {
      await page.evaluate((i) => window.__rvFinale?.goto(i, 1.2, true), i);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/finale-${vp}-${view}-${i}-${steps[i]}.png` });
    }
    await ctx.close();
    const b = await open(browser, vp, `course=saltmarsh&paused=1&t=-24&preoff=1&view=${view}&riders=1&coats=showcase&quality=high&rvdebug=1&debug=0`);
    for (const t of [-22, -15, -8, -3, 0.3]) {
      await b.page.evaluate((t) => window.__rvClock?.seek(t), t);
      await b.page.waitForTimeout(2000);
      await b.page.screenshot({ path: `${OUT}/preoff-${vp}-${view}-${t}.png` });
    }
    await b.ctx.close();
  }
}

// Natural playback: the director's own shots (no seeks), a frame every ~1.2 s.
async function play(browser) {
  for (const vp of (process.env.VPS ?? "desktop,phone").split(",")) for (const view of (process.env.VIEWS ?? "classic,trackside").split(",")) {
    const t0 = process.env.PT0 ?? "52";
    const { ctx, page } = await open(browser, vp, `course=${process.env.PCOURSE ?? "saltmarsh"}&t=${t0}&view=${view}&riders=1&coats=showcase&quality=high&rvdebug=1&debug=0`);
    for (let i = 0; i < Number(process.env.PN ?? 26); i++) {
      try {
        const t = await page.evaluate(() => window.__rvClock?.time() ?? 0);
        await page.screenshot({ path: `${OUT}/play-${vp}-${view}-${String(i).padStart(2, "0")}-t${t.toFixed(1)}.png`, timeout: 60000 });
      } catch (e) { log("fail", e.message.slice(0, 60)); }
      await page.waitForTimeout(1200);
    }
    log("play", vp, view);
    await ctx.close();
  }
}

const browser = await chromium.launch({ args });
try {
  if (MODE === "play") await play(browser);
  if (MODE === "stills") await stills(browser);
  if (MODE === "strip") await strip(browser);
  if (MODE === "perf") await perf(browser);
  if (MODE === "finale") await finale(browser);
} finally { await browser.close(); }
