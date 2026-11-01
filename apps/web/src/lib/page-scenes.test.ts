/**
 * Graphics round 2: every page family opens on its own picture, and the wiki never shows a
 * picture a page uses as its backdrop. Reads the source: every scene key given to a band,
 * header, backdrop, strip or living diorama, per file, grouped into page families.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "../..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "dev" || f === "admin" || f === "node_modules") continue;
      out.push(...files(p));
    } else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** Files that make up one page family (the rest: each file is its own family). */
const FAMILIES: Record<string, string[]> = {
  "profile and my pages": ["app/me/page.tsx", "app/me/bets/page.tsx", "app/me/betting/page.tsx", "app/me/races/page.tsx", "app/link/LinkClient.tsx"],
  jockeys: ["app/jockeys/page.tsx", "app/jockeys/[id]/page.tsx", "app/jockeys/window/page.tsx"],
  "prize pool and beta": ["src/components/chain/PoolScreen.tsx", "src/components/playtest/BetaScreen.tsx"],
  market: ["app/market/page.tsx", "src/components/economy/SalesRing.tsx", "src/components/economy/MarketScreen.tsx"],
  packs: ["app/packs/page.tsx", "src/components/economy/PacksScreen.tsx"],
  stable: ["app/stable/page.tsx", "src/components/stable/RanchStage.tsx"],
  wiki: ["app/wiki/layout.tsx", "app/wiki/page.tsx"],
  "story": ["src/components/competition/StoryScreen.tsx"],
  "league": ["src/components/competition/LeagueScreen.tsx"],
  "home": ["src/components/home/EstateStage.tsx", "src/components/home/HomeView.tsx"],
};
/**
 * Not backdrops: the race's own broadcast build-up (its runners parading in the paddock and
 * cantering to post) shows the race itself, whatever page it is on.
 */
const BROADCAST = ["src/components/race/PaddockParade.tsx", "src/components/race/RaceExperience.tsx"];

const familyOf = (rel: string) => Object.entries(FAMILIES).find(([, fs]) => fs.includes(rel))?.[0] ?? rel;

/** Scene keys a file opens on: band / header / backdrop / strip props and living dioramas. */
function scenesIn(text: string): string[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const keys = new Set<string>();
  for (const m of src.matchAll(/<(?:SceneBand|PageHeader|SceneBackdrop|SceneStrip|Diorama|DioramaSlot|StillScene)\b[^>]*?\bscene="([a-z-]+)"/g)) keys.add(m[1]!);
  for (const m of src.matchAll(/\bband=\{\{\s*scene:\s*"([a-z-]+)"/g)) keys.add(m[1]!);
  for (const m of src.matchAll(/\{\s*scene:\s*"([a-z-]+)",\s*alt:/g)) keys.add(m[1]!);
  for (const m of src.matchAll(/:\s*"(chapter-[a-z]+)"/g)) keys.add(m[1]!);
  return [...keys];
}

// living dioramas and the poster each blurs behind its pages
const POSTER: Record<string, string> = {
  stable: "diorama/poster-yard.png",
  yard: "diorama/poster-yard.png",
  barn: "diorama/poster-barn.png",
  grandstand: "diorama/poster-grandstand.png",
  paddock: "diorama/poster-paddock.png",
  "track-dusk": "diorama/poster-track-dusk.png",
  pasture: "diorama/poster-pasture.png",
  "sales-ring": "diorama/poster-sales-ring.png",
};
const imageOf = (key: string) => POSTER[key] ?? `scenes/${key}.png`;

describe("page scenes", () => {
  const all = [...files(join(WEB, "app")), ...files(join(WEB, "src"))];
  const byScene = new Map<string, Set<string>>();
  for (const f of all) {
    const rel = relative(WEB, f);
    if (rel.startsWith("src/wiki/") || BROADCAST.includes(rel)) continue;
    for (const key of scenesIn(readFileSync(f, "utf8"))) {
      const img = imageOf(key);
      if (!byScene.has(img)) byScene.set(img, new Set());
      byScene.get(img)!.add(familyOf(rel));
    }
  }

  it("finds the scenes (sanity)", () => {
    expect(byScene.size).toBeGreaterThan(30);
    expect(byScene.get("scenes/owners-office.png")).toEqual(new Set(["profile and my pages"]));
  });

  it("no backdrop picture is used by two page families", () => {
    const shared = [...byScene].filter(([, fams]) => fams.size > 1).map(([img, fams]) => `${img}: ${[...fams].join(", ")}`);
    expect(shared).toEqual([]);
  });

  it("no wiki picture is also a page backdrop, and the wiki never repeats one", () => {
    const wiki = files(join(WEB, "src/wiki")).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/(?:src|poster):\s*"\/art\/((?:scenes|diorama)\/[a-z0-9-]+\.png)"|src="\/art\/((?:scenes|diorama)\/[a-z0-9-]+\.png)"/g)].map((m) => m[1] ?? m[2]!));
    expect(wiki.length).toBeGreaterThan(25);
    const pageImages = new Set(byScene.keys());
    expect(wiki.filter((w) => pageImages.has(w) && w !== "scenes/club-library.png")).toEqual([]);
    expect(wiki.filter((w, i) => wiki.indexOf(w) !== i)).toEqual([]);
  });
});
