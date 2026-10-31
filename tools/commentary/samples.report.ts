/**
 * Sample race calls for listening checks, through the real pipeline: the racing engine runs
 * real fields, the race viewer builds the voiced call (buildVoicedRaceCall), the speech plan and
 * the crowd cues (schedule.ts) exactly as the browser does, then mix_samples.py mixes the clips
 * like the Web Audio player. Three races: an easy win, a comeback and a photo finish, one per
 * caster.
 *
 *   SAMPLES_DIR=/tmp/samples npx vitest run --config tools/commentary/vitest.config.ts samples
 *     -> $SAMPLES_DIR/races.json and names.txt (the runners to voice)
 *   python3 tools/commentary/render_names.py --model ... --voices ... --names "$(cat $SAMPLES_DIR/names.txt)" --out $SAMPLES_DIR/names
 *   SAMPLES_DIR=... npx vitest run --config tools/commentary/vitest.config.ts samples
 *     -> $SAMPLES_DIR/plan-*.json (now that the name clips' lengths are known)
 *   python3 tools/commentary/mix_samples.py $SAMPLES_DIR
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { RaceReplay } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import { makeInput, seedFor, typicalField } from "../../packages/racing-engine/src/test-fixtures";
import { COURSES } from "../../packages/game-core/src/courses";
import { buildVoicedRaceCall, type VoicedCallLine } from "../../packages/race-viewer/src/call/buildRaceCall";
import { pickCaster } from "../../packages/race-viewer/src/call/voice/casters";
import { MIX, makeResolver, nameClipKey, nameKey, phraseKey, type CommentaryManifest } from "../../packages/race-viewer/src/call/voice/library";
import { crowdCues, planSpeech, SPEECH } from "../../packages/race-viewer/src/call/voice/schedule";
import { phraseId } from "../../packages/race-viewer/src/call/voice/speech";

const NAMES = [
  "Silver Bramble", "Quiet Riot", "Golden Mile", "Harbour Light", "Velvet Thunder", "Copper Comet", "Midnight Ledger", "Northern Tide",
  "Rosewood Rebel", "Storm Warden", "Lucky Lantern", "Ashford Arrow", "Bramble Rose", "Kestrel Wind", "Saltmarsh Sally", "Larkspur Lad",
];
const DIR = process.env.SAMPLES_DIR ?? fileURLToPath(new URL("./out/samples", import.meta.url));
const LIB = fileURLToPath(new URL("../../apps/web/public/audio/commentary", import.meta.url));

interface Sample {
  kind: "easy" | "comeback" | "photo";
  replay: RaceReplay;
  lines: VoicedCallLine[];
  raceId: string;
  caster: string;
  course: string;
}

function race(k: number, kind: string) {
  const distanceM = [1200, 1400, 1600, 2000][k % 4]!;
  const course = COURSES[k % COURSES.length]!;
  const field = typicalField(8, distanceM).map((e, i) => ({ ...e, name: NAMES[(k + i * 3) % NAMES.length]!, id: `h${i + 1}` }));
  const replay = simulateRace(makeInput(field, { distanceM, seed: seedFor(k), id: `sample-${kind}-${k}` }));
  const lines = buildVoicedRaceCall({
    replay,
    names: Object.fromEntries(replay.horses.map((h) => [h.horseId, h.name])),
    distanceM,
    course: { name: course.name, homeStraightM: course.homeStraightM, finishGradientPermille: course.finishGradientPermille },
    going: "good",
    uptoSec: Number.POSITIVE_INFINITY,
    seed: replay.race.id,
  });
  return { replay, lines, course: course.name };
}

const has = (lines: VoicedCallLine[], ...texts: string[]) => lines.some((l) => l.speech?.tokens.some((t) => t.k === "p" && texts.map(phraseId).includes(t.id)));

function pick(kind: Sample["kind"], caster: string): Sample {
  for (let k = 1; k < 3000; k++) {
    const { replay, lines, course } = race(k, kind);
    const finish = lines.find((l) => l.kind === "finish" || l.kind === "photo");
    const result = lines.find((l) => l.kind === "result");
    if (!finish || !result?.speech) continue;
    const ok =
      kind === "photo"
        ? finish.kind === "photo" && !/dead heat/i.test(result.text)
        : kind === "easy"
          ? finish.kind === "finish" && result.speech.intensity === "calm"
          : finish.kind === "finish" && finish.speech?.intensity === "climax" && has(lines, "But look at this!", "And here comes");
    if (!ok) continue;
    // A race id whose caster is the one wanted (the pick is the viewer's, from the id alone).
    for (let j = 0; ; j++) {
      const raceId = `sample-${kind}-${k}-${j}`;
      if (pickCaster(raceId).id === caster) return { kind, replay, lines, raceId, caster, course };
    }
  }
  throw new Error(`no ${kind} race found`);
}

it("builds the sample races and their speech plans", () => {
  mkdirSync(DIR, { recursive: true });
  const samples = [pick("easy", "bm_george"), pick("comeback", "bm_lewis"), pick("photo", "bm_daniel")];
  const names = [...new Set(samples.flatMap((s) => s.replay.horses.map((h) => h.name)))];
  writeFileSync(join(DIR, "names.txt"), names.join(","));
  writeFileSync(
    join(DIR, "races.json"),
    JSON.stringify(
      samples.map((s) => ({ kind: s.kind, raceId: s.raceId, caster: s.caster, course: s.course, lines: s.lines.map((l) => ({ atSec: l.atSec, kind: l.kind, intensity: l.speech?.intensity ?? null, text: l.text })) })),
      null,
      1,
    ),
  );
  const manifest = JSON.parse(readFileSync(join(LIB, "manifest.json"), "utf8")) as CommentaryManifest;
  const durPath = join(DIR, "names", "durations.json");
  if (!existsSync(durPath)) {
    console.log(`names to voice: ${join(DIR, "names.txt")}; render them, then run this again`);
    return;
  }
  const nameDur = JSON.parse(readFileSync(durPath, "utf8")) as Record<string, number>;
  for (const s of samples) {
    const files: Record<string, string> = {};
    const resolve = makeResolver(s.caster, (key) => {
      const [kind, caster, intensity, id] = key.split("|") as [string, string, string, string];
      if (kind === "p") {
        const e = manifest.clips[caster]?.[intensity]?.[id];
        if (!e) return "missing";
        files[key] = join(LIB, caster, intensity, `${id}.mp3`);
        return e.d;
      }
      const d = nameDur[`${caster}|${intensity}|${id}`];
      if (d === undefined) return "missing";
      files[key] = join(DIR, "names", caster, intensity, `${id}.mp3`);
      return d;
    });
    const plan = planSpeech(s.lines, resolve);
    expect(plan.waitingFrom).toBe(-1);
    const cues = crowdCues(plan);
    const dt = s.replay.sampleEvery / s.replay.tickHz;
    const raceEnd = (s.replay.frames.length - 1) * dt;
    const winnerSec = s.replay.result.winningTimeUs / 1e6;
    writeFileSync(
      join(DIR, `plan-${s.kind}.json`),
      JSON.stringify(
        {
          kind: s.kind,
          caster: s.caster,
          raceId: s.raceId,
          course: s.course,
          distanceM: s.replay.race.distanceM,
          winnerSec,
          raceEnd,
          winner: s.replay.horses.find((h) => h.horseId === s.replay.result.finishOrder[0]!.horseId)!.name,
          lines: plan.lines.map((l) => ({ ...l, clips: l.clips.map((c) => ({ ...c, file: files[c.key] })) })),
          cues: cues.map((c) => ({ ...c, at: Number.isFinite(c.at) ? c.at : -1e9 })),
          mix: MIX,
          beds: Object.fromEntries(Object.entries(manifest.beds).map(([k, v]) => [k, join(LIB, "beds", v.file)])),
          speech: SPEECH,
          text: s.lines.map((l) => `${l.atSec.toFixed(1).padStart(5)} ${(l.speech?.intensity ?? "-").padEnd(8)} ${l.text}`),
        },
        null,
        1,
      ),
    );
    console.log(`${s.kind}: ${s.raceId} (${s.caster}) ${plan.lines.length} spoken lines, race ${raceEnd.toFixed(1)} s, winner at ${winnerSec.toFixed(1)} s`);
  }
  // Keys used by the player and this report agree.
  expect(nameClipKey("bm_george", "calm", " Silver  Bramble")).toBe(`n|bm_george|calm|${nameKey("Silver Bramble")}`);
  expect(phraseKey("bm_george", "calm", "x")).toBe("p|bm_george|calm|x");
});
