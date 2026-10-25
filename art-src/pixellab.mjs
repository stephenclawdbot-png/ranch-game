#!/usr/bin/env node
// Minimal PixelLab v2 client (Node 22, global fetch). The API key is read at runtime from
// ~/.config/pixellab/key (or $PIXELLAB_KEY) and is never written anywhere.
//
// Library use:
//   import { post, get, pollJob, saveBase64Png, balance, run } from "./pixellab.mjs";
// CLI use (generic runner):
//   node art-src/pixellab.mjs <endpoint> <request.json> <out/prefix>
//   -> POSTs the request, polls the background job if any, saves every base64 image found
//      in the response as <out/prefix>-<n>.png and the response metadata as <prefix>.json.
//   node art-src/pixellab.mjs balance
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.pixellab.ai/v2";
const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, "generation-log.jsonl");

function key() {
  if (process.env.PIXELLAB_KEY) return process.env.PIXELLAB_KEY.trim();
  return readFileSync(join(homedir(), ".config/pixellab/key"), "utf8").trim();
}

const headers = () => ({ Authorization: `Bearer ${key()}`, "Content-Type": "application/json" });

async function handle(res, what) {
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`${what} -> HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 2000)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function get(path) {
  const res = await fetch(BASE + path, { headers: headers() });
  return handle(res, `GET ${path}`);
}

export async function getRaw(path) {
  const res = await fetch(BASE + path, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function post(path, body) {
  const res = await fetch(BASE + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  return handle(res, `POST ${path}`);
}

export async function balance() {
  return get("/balance");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a background job until completed/failed. */
export async function pollJob(id, { interval = 5000, timeout = 20 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const job = await get(`/background-jobs/${id}`);
    if (job.status === "completed") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`job ${id} ${job.status}: ${JSON.stringify(job.last_response ?? job).slice(0, 2000)}`);
    }
    if (Date.now() - t0 > timeout) throw new Error(`job ${id} timed out`);
    await sleep(interval);
  }
}

export function saveBase64Png(b64, file) {
  mkdirSync(dirname(file), { recursive: true });
  const data = b64.includes(",") && b64.startsWith("data:") ? b64.split(",")[1] : b64;
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

/** Walk a response and collect every {base64: "..."} image (or bare data-url string), in order. */
export function collectImages(obj, out = []) {
  if (!obj || typeof obj !== "object") {
    if (typeof obj === "string" && obj.startsWith("data:image/png;base64,")) out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectImages(v, out);
    return out;
  }
  if (typeof obj.base64 === "string" && obj.base64.length > 64) {
    out.push(obj.base64);
    return out;
  }
  for (const v of Object.values(obj)) collectImages(v, out);
  return out;
}

/** Strip base64 payloads from a request/response so it can be logged. */
export function strip(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => (typeof v === "string" && v.length > 300 ? `<${v.length} chars>` : v)),
  );
}

/** Image file -> {type:"base64", base64, format:"png"} */
export function b64img(file) {
  return { type: "base64", base64: readFileSync(file).toString("base64"), format: "png" };
}

/**
 * POST an endpoint, wait for its job (if it returns one), save images to `${prefix}-N.png`.
 * Returns { response, job, files }.
 */
export async function run(endpoint, request, prefix) {
  const t0 = Date.now();
  const response = await post(endpoint, request);
  const jobId = response.background_job_id ?? response.job_id ?? null;
  let job = null;
  if (jobId) job = await pollJob(jobId);
  const payload = job ?? response;
  // De-duplicate: jobs often return the same picture as `images` and `quantized_images`.
  const imgs = [...new Set(collectImages(payload))];
  const files = imgs.map((b, i) => saveBase64Png(b, `${prefix}-${i}.png`));
  mkdirSync(dirname(resolve(prefix)), { recursive: true });
  const meta = { endpoint, request: strip(request), response: strip(response), job: job && strip(job), files };
  writeFileSync(`${prefix}.json`, JSON.stringify(meta, null, 1));
  appendFileSync(
    LOG,
    JSON.stringify({
      at: new Date().toISOString(),
      endpoint,
      prefix: resolve(prefix).replace(resolve(HERE, "..") + "/", ""),
      secs: Math.round((Date.now() - t0) / 1000),
      usage: job?.usage ?? response.usage ?? null,
      images: files.length,
    }) + "\n",
  );
  return { response, job, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, reqFile, prefix] = process.argv.slice(2);
  if (cmd === "balance") {
    console.log(JSON.stringify(await balance()));
  } else if (cmd && reqFile && prefix) {
    const req = JSON.parse(readFileSync(reqFile, "utf8"));
    const { files, job, response } = await run(cmd, req, prefix);
    console.log(JSON.stringify({ files, usage: job?.usage ?? response.usage }, null, 1));
  } else {
    console.error("usage: pixellab.mjs balance | <endpoint> <request.json> <out/prefix>");
    process.exit(2);
  }
}
