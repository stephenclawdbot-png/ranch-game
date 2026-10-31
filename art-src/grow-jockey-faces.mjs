#!/usr/bin/env node
// Grow the jockey cast with the player base (admin; graphics round 2). Counts how many base
// faces of each pool (career stage x presentation) active jockeys wear; when a pool's share of
// worn faces passes the threshold, it writes new face descriptions (drawn from the attribute
// lists below, never repeating one) to art-src/jockey_faces_grown.json, generates them with
// PixelLab (gen-jockey-faces.mjs recipe: keyed hair, key silks, period kit), picks and keys them
// (pick_jockeys.py, process_jockeys.py), which rewrites the art index and game-core's face
// catalogue. No code changes: deploy the new files and the game assigns the new faces first
// (least-used). Looks (face x skin x hair x accessories) keep riders unique meanwhile.
//
//   node art-src/grow-jockey-faces.mjs [--usage usage.json] [--threshold 0.75] [--batch 10] [--dry]
//   usage: {"<face id>": <active jockeys wearing it>, ...}; without it, DATABASE_URL is queried
//   (select look->>'face', count(*) from jockeys where retired_at is null group by 1).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const GROWN = join(HERE, "jockey_faces_grown.json");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const THRESHOLD = Number(arg("--threshold", "0.75"));
const BATCH = Number(arg("--batch", "10"));
const DRY = process.argv.includes("--dry");

const catalogue = JSON.parse(readFileSync(join(ROOT, "packages/game-core/src/jockeyFaces.json"), "utf8")).faces;

async function usage() {
  const file = arg("--usage");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  if (!process.env.DATABASE_URL) throw new Error("pass --usage <file> or set DATABASE_URL");
  const { neon } = await import(join(ROOT, "packages/db/node_modules/@neondatabase/serverless/index.mjs"));
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`select look->>'face' as face, count(*)::int as n from jockeys where retired_at is null and look is not null group by 1`;
  return Object.fromEntries(rows.map((r) => [r.face, r.n]));
}

// Attribute lists for new faces (period-appropriate; hair colour stays the lime key).
const AGES = { apprentice: [15, 16, 17, 18, 19], prime: [25, 27, 29, 31, 33, 35], veteran: [46, 49, 52, 55, 58, 61] };
const PEOPLE = ["pale skin", "very pale skin", "fair freckled skin", "ruddy skin", "olive skin", "tan skin", "light brown skin", "brown skin", "dark brown skin", "deep dark skin", "East Asian", "South Asian", "Middle Eastern", "Mediterranean", "Latino", "mixed-race"];
const HAIR_M = ["short {hair} hair", "a {hair} side parting", "curly {hair} hair", "a {hair} fringe", "wavy {hair} hair", "{hair} sideburns", "a {hair} moustache", "a short {hair} beard", "cropped {hair} hair", "{hair} stubble"];
const HAIR_F = ["a {hair} bob", "a {hair} bun", "a {hair} plait", "{hair} curls", "{hair} finger waves", "a {hair} ponytail", "cropped {hair} hair", "{hair} hair tucked under the cap", "two {hair} plaits", "a {hair} shingle cut"];
const FEATURES = ["a strong jaw", "a snub nose", "a long nose", "big ears", "high cheekbones", "a dimpled chin", "thick eyebrows", "a mole on the cheek", "a gap in the teeth", "round wire spectacles", "a small scar", "rosy cheeks", "deep laugh lines", "a crooked nose"];
const MOODS = ["a warm smile", "a cheeky grin", "a calm gaze", "a determined frown", "a shy smile", "a proud look", "a wry smirk", "a big laugh", "a thoughtful look", "a steely stare"];

function* combos(stage, presents) {
  const who = presents === "f" ? (stage === "apprentice" ? "girl" : "woman") : stage === "apprentice" ? "boy" : "man";
  const role = stage === "apprentice" ? `apprentice jockey ${who}` : stage === "veteran" ? `veteran jockey ${who}` : `jockey ${who}`;
  const hairs = presents === "f" ? HAIR_F : HAIR_M;
  for (let i = 0; ; i++) {
    const age = AGES[stage][i % AGES[stage].length];
    const p = PEOPLE[(i * 7) % PEOPLE.length];
    const h = hairs[(i * 3) % hairs.length];
    const f = FEATURES[(i * 5) % FEATURES.length];
    const m = MOODS[(i * 11) % MOODS.length];
    yield `a ${role} about ${age}, ${p}, ${h}, ${f}, ${m}`;
  }
}

const NATIVE = { apprentice: ["black", "brown", "blonde", "auburn", "dark-brown", "ginger"], prime: ["black", "dark-brown", "brown", "blonde", "auburn", "ginger"], veteran: ["grey", "white", "grey", "brown", "white", "black"] };

const worn = await usage();
const grown = existsSync(GROWN) ? JSON.parse(readFileSync(GROWN, "utf8")) : {};
const known = new Set([...catalogue.map((f) => f.id), ...Object.keys(grown)]);
const descs = new Set(Object.values(grown).map((g) => g[1]));
const fresh = [];
for (const stage of ["apprentice", "prime", "veteran"]) {
  for (const presents of ["f", "m"]) {
    const pool = catalogue.filter((f) => f.stage === stage && f.presents === presents);
    const share = pool.filter((f) => (worn[f.id] ?? 0) > 0).length / Math.max(1, pool.length);
    console.log(`${stage}/${presents}: ${pool.length} faces, ${(share * 100).toFixed(0)}% worn`);
    if (share < THRESHOLD) continue;
    const prefix = `${stage[0] === "a" ? "a" : stage[0] === "v" ? "v" : "p"}${presents}-g`;
    let n = 1;
    const gen = combos(stage, presents);
    for (let k = 0; k < BATCH; k++) {
      while (known.has(`${prefix}${String(n).padStart(3, "0")}`)) n++;
      let d = gen.next().value;
      while (descs.has(d)) d = gen.next().value;
      const id = `${prefix}${String(n).padStart(3, "0")}`;
      known.add(id);
      descs.add(d);
      grown[id] = [NATIVE[stage][k % 6], d];
      fresh.push(id);
    }
  }
}
if (!fresh.length) {
  console.log("every pool is below the threshold: nothing to grow");
  process.exit(0);
}
console.log("new faces:", fresh.join(" "));
if (DRY) process.exit(0);
writeFileSync(GROWN, JSON.stringify(grown, null, 1) + "\n");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
run("node", ["art-src/gen-jockey-faces.mjs", ...fresh]);
run("python3", ["-I", "art-src/pick_jockeys.py", ...fresh]);
run("python3", ["-I", "art-src/process_jockeys.py"]);
console.log("done: review the new busts, then commit art + catalogue and deploy");
