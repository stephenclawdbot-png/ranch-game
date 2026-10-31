/**
 * Radio commentary name clips over HTTP: the upload and missing-names endpoints (secret,
 * constant-time, size limits, known names only) and the public clip route (immutable cache,
 * 404 until voiced). Uses the shared PGlite singleton, like the routes.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { COMMENTARY_RECIPE, createAccount, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import { POST } from "../../app/api/commentary/names/route";
import { GET as MISSING } from "../../app/api/commentary/names/missing/route";
import { GET as CLIP } from "../../app/api/commentary/names/[recipe]/[caster]/[intensity]/[key]/route";
import { dbHandle } from "./db";

const SECRET = "test-commentary-secret-0123456789";
let h: DbHandle;
let horseName: string;

beforeAll(async () => {
  h = await dbHandle();
  const acc = await createAccount(h.db, { stableName: `Radio Stable ${Date.now() % 100000}`, silks: { pattern: "hoops", primary: "#8e2323", secondary: "#f3e7c9", cap: "#263238" }, startingCredits: 1000, starterHorses: 1, now: new Date() });
  const stable = await stableOf(h.db, acc.accountId);
  const horse = (await h.db.select().from(schema.horses)).find((x) => x.ownerStableId === stable.id);
  horseName = horse!.name;
});
afterEach(() => {
  delete process.env.COMMENTARY_UPLOAD_SECRET;
});

const mp3 = (fill: number, n = 1500) => {
  const b = Buffer.alloc(n, fill);
  b[0] = 0xff;
  b[1] = 0xf3;
  return b;
};
const b64 = (b: Buffer) => b.toString("base64");
const body = (over: Record<string, unknown> = {}) => ({ name: horseName, caster: "bm_lewis", recipe: COMMENTARY_RECIPE, clips: { calm: b64(mp3(1)), building: b64(mp3(2)), climax: b64(mp3(3)) }, ...over });
const upload = (payload: unknown, auth?: string, extra: Record<string, string> = {}) =>
  POST(new Request("https://tb.example/api/commentary/names", { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload), headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}), ...extra } }));
const missing = (auth?: string, q = "") => MISSING(new Request(`https://tb.example/api/commentary/names/missing${q}`, { headers: auth ? { Authorization: auth } : {} }));
const clip = (p: { recipe?: string; caster?: string; intensity?: string; key: string }) =>
  CLIP(new Request("https://tb.example/x"), { params: Promise.resolve({ recipe: p.recipe ?? `${COMMENTARY_RECIPE}`, caster: p.caster ?? "bm_lewis", intensity: p.intensity ?? "calm", key: p.key }) });
const keyOf = (n: string) => encodeURIComponent(n.trim().replace(/\s+/g, " ").toLowerCase());

describe("commentary upload", () => {
  it("is off without the secret configured, and refuses a wrong or missing secret", async () => {
    expect((await upload(body(), `Bearer ${SECRET}`)).status).toBe(503);
    process.env.COMMENTARY_UPLOAD_SECRET = SECRET;
    expect((await upload(body())).status).toBe(401);
    expect((await upload(body(), `Bearer ${SECRET}x`)).status).toBe(401);
    expect((await upload(body(), SECRET)).status).toBe(401);
    expect((await missing()).status).toBe(401);
    expect((await missing(`Bearer nope`)).status).toBe(401);
  });

  it("stores a known name's clips and serves them, immutable", async () => {
    process.env.COMMENTARY_UPLOAD_SECRET = SECRET;
    // Before: 404, briefly cached (the caster says the number).
    const before = await clip({ key: keyOf(horseName) });
    expect(before.status).toBe(404);
    expect(before.headers.get("Cache-Control")).toContain("max-age=600");
    const res = await upload(body(), `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const got = await clip({ key: keyOf(horseName), intensity: "building" });
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(got.headers.get("Cache-Control")).toContain("immutable");
    expect(Buffer.from(await got.arrayBuffer()).equals(mp3(2))).toBe(true);
    // Another recipe, caster or intensity: not served.
    expect((await clip({ key: keyOf(horseName), recipe: `${COMMENTARY_RECIPE + 1}` })).status).toBe(404);
    expect((await clip({ key: keyOf(horseName), caster: "bm_george" })).status).toBe(404);
    expect((await clip({ key: keyOf(horseName), intensity: "shouting" })).status).toBe(404);
  });

  it("enforces the limits: body size, clip size and format, known names, casters", async () => {
    process.env.COMMENTARY_UPLOAD_SECRET = SECRET;
    const auth = `Bearer ${SECRET}`;
    expect((await upload(body(), auth, { "Content-Length": `${200 * 1024}` })).status).toBe(413);
    expect((await upload("x".repeat(170 * 1024), auth)).status).toBe(413);
    expect((await upload("{not json", auth)).status).toBe(400);
    expect((await upload(body({ clips: { calm: "!!", building: "a", climax: "b" } }), auth)).status).toBe(400);
    expect((await upload(body({ clips: { calm: b64(mp3(1, 40 * 1024)), building: b64(mp3(2)), climax: b64(mp3(3)) } }), auth)).status).toBe(400);
    expect((await upload(body({ clips: { calm: b64(Buffer.alloc(1500, 0x3c)), building: b64(mp3(2)), climax: b64(mp3(3)) } }), auth)).status).toBe(400);
    expect((await upload(body({ name: "Nobody Is Called This" }), auth)).status).toBe(404);
    expect((await upload(body({ caster: "af_heart" }), auth)).status).toBe(400);
    expect((await upload(body({ recipe: COMMENTARY_RECIPE + 7 }), auth)).status).toBe(400);
  });

  it("lists names still missing clips, per caster", async () => {
    process.env.COMMENTARY_UPLOAD_SECRET = SECRET;
    const res = await missing(`Bearer ${SECRET}`, "?limit=500");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { recipe: number; names: Array<{ key: string; casters: string[] }> };
    expect(data.recipe).toBe(COMMENTARY_RECIPE);
    const mine = data.names.find((n) => n.key === horseName.toLowerCase());
    // bm_lewis was uploaded above; the other two casters are still to do.
    expect(mine?.casters).toEqual(["bm_george", "bm_daniel"]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
