import { describe, expect, it } from "vitest";
import { previewBreeding } from "./breeding";
import {
  OUTLOOK_SENTENCES,
  outlookBand,
  outlookTone,
  outlookNumbers,
  pairingOutlook,
  versusMareBand,
  possibleLooks,
  publicLevel,
  publicParentOf,
  type PublicParent,
} from "./breedingOutlook";
import { appearanceOf } from "./coat";
import { locusValue, potentials, vigourValue } from "./genome";
import { revealedRanges } from "./phenotype";
import { STAT_KEYS, type HorseState } from "./types";
import { SILKS, makeHorse, pedOf } from "./test-helpers";

const stud = (id: string, rarity: "common" | "rare" | "epic" = "common") => makeHorse(id, { id, sex: "colt", retired: true, rarity });
const mare = (id: string, rarity: "common" | "rare" | "epic" = "common") => makeHorse(id, { id, sex: "filly", retired: true, rarity });
const face = (h: HorseState) => appearanceOf(h.genome, { racingAge: true, starts: h.career.starts, retired: true }, SILKS).face;
const pub = (h: HorseState) => publicParentOf(h);

/**
 * The same horse with every hidden locus rewritten so nothing public changes: each stat pair
 * becomes a homozygous pair of the same expressed value, the vigour likewise, the quirks
 * flipped, a recessive big-heart copy added (one copy doesn't show), body shape and the
 * rig variants changed. Potentials, revealed ranges, coat and markings stay the same.
 */
function hiddenTwin(h: HorseState): HorseState {
  const g = h.genome;
  const stats = {} as typeof g.stats;
  for (const k of STAT_KEYS) {
    const v = locusValue(g.stats[k]);
    stats[k] = [v, v];
  }
  const vg = vigourValue(g.vigour);
  const flip = (p: readonly [0 | 1, 0 | 1]): [0 | 1, 0 | 1] => [p[0] ? 0 : 1, p[1] ? 0 : 1];
  return {
    ...h,
    genome: {
      ...g,
      stats,
      vigour: [vg, vg],
      quirks: { mudlark: flip(g.quirks.mudlark), gateShy: flip(g.quirks.gateShy), lateKick: flip(g.quirks.lateKick), crowdShy: flip(g.quirks.crowdShy) },
      genes2: { ...g.genes2, bigHeart: g.genes2.bigHeart[0] === "bh" && g.genes2.bigHeart[1] === "bh" ? g.genes2.bigHeart : ["bh", "n"] },
      morph: { ...g.morph, legLength: [g.morph.legLength[1] + 1, g.morph.legLength[0] - 1], neckLength: [-g.morph.neckLength[0], -g.morph.neckLength[1]] },
      variants: { head: [7, 7], mane: [6, 6], tail: [5, 5], build: [4, 4] },
      white: [g.white[1], g.white[0]], // same score, same visible markings, different alleles
    },
  };
}

describe("breeding preview from public facts", () => {
  it("two pairings whose parents differ only in hidden alleles give identical previews", () => {
    let checked = 0;
    for (let i = 0; i < 12; i++) {
      const s = stud(`hid-s${i}`, i % 2 ? "rare" : "common");
      const m = mare(`hid-m${i}`, i % 3 ? "common" : "epic");
      const s2 = hiddenTwin(s);
      const m2 = hiddenTwin(m);
      // Nothing public moved...
      expect(potentials(s2.genome)).toEqual(potentials(s.genome));
      expect(revealedRanges(m2)).toEqual(revealedRanges(m));
      expect(face(s2)).toBe(face(s));
      // ...but the hidden genotypes did, so the old exact odds differ (that was the leak)...
      const exact = previewBreeding(s, m, pedOf(s, m), 1);
      const exact2 = previewBreeding(s2, m2, pedOf(s2, m2), 1);
      if (JSON.stringify(exact.overall) !== JSON.stringify(exact2.overall)) checked++;
      // ...while everything the player now sees is identical.
      expect(pub(s2)).toEqual(pub(s));
      expect(pub(s).face).toBe(face(s));
      expect(pairingOutlook(pub(s2), pub(m2), { coi: 0 })).toEqual(pairingOutlook(pub(s), pub(m), { coi: 0 }));
      expect(outlookNumbers(pub(s2), pub(m2), { coi: 0 })).toEqual(outlookNumbers(pub(s), pub(m), { coi: 0 }));
      expect(possibleLooks(pub(s2), pub(m2), 20_000, SILKS)).toEqual(possibleLooks(pub(s), pub(m), 20_000, SILKS));
    }
    expect(checked).toBeGreaterThan(6);
  });

  it("samples are the same all day and change with the day", () => {
    const s = pub(stud("day-s"));
    const m = pub(mare("day-m"));
    const today = possibleLooks(s, m, 20_391, SILKS);
    expect(today).toHaveLength(4);
    expect(possibleLooks(s, m, 20_391, SILKS)).toEqual(today);
    const days = [20_392, 20_393, 20_394, 20_395].map((d) => JSON.stringify(possibleLooks(s, m, d, SILKS)));
    expect(days.some((d) => d !== JSON.stringify(today))).toBe(true);
    // One look for the stallion finder is the first of the day's samples.
    expect(possibleLooks(s, m, 20_391, SILKS, 1)).toEqual(today.slice(0, 1));
    for (const l of today) expect(l.caption.length).toBeGreaterThan(2);
  });

  it("the strip shows the pairing's variety (distinct looks first)", () => {
    let distinct = 0;
    for (let i = 0; i < 20; i++) {
      const looks = possibleLooks(pub(stud(`var-s${i}`)), pub(mare(`var-m${i}`)), 20_391, SILKS);
      distinct += new Set(looks.map((l) => l.caption)).size;
      // A repeat only once every distinct look has been shown.
      const firstRepeat = looks.findIndex((l, j) => looks.findIndex((x) => x.caption === l.caption) !== j);
      if (firstRepeat >= 0) expect(new Set(looks.slice(firstRepeat).map((l) => l.caption)).size).toBeLessThanOrEqual(looks.length - firstRepeat);
    }
    expect(distinct / 20).toBeGreaterThanOrEqual(2.5);
  });

  it("looks follow the parents' public coat genes (two chestnuts never get a black-based foal)", () => {
    const s = stud("chs");
    const m = mare("chm");
    const red = (h: HorseState): HorseState => ({ ...h, genome: { ...h.genome, coat: { ...h.genome.coat, extension: ["e", "e"], grey: ["n", "n"] } } });
    for (let d = 0; d < 10; d++) {
      for (const l of possibleLooks(pub(red(s)), pub(red(m)), d, SILKS)) expect(["chestnut", "liver"]).toContain(l.appearance.colour?.base);
    }
  });

  it("maps the internal numbers to a small fixed vocabulary", () => {
    expect(outlookBand(500, 500)).toBe("upside");
    expect(outlookBand(350, 380)).toBe("upside");
    expect(outlookBand(300, 400)).toBe("risk");
    expect(outlookBand(360, 420)).toBe("risk");
    expect(outlookBand(200, 220)).toBe("level");
    expect(outlookBand(120, 100)).toBe("level");
    expect(outlookBand(119, 100)).toBe("longshot");
    expect(outlookBand(0, 0)).toBe("longshot");
    expect(versusMareBand(40)).toBe("better");
    expect(versusMareBand(39)).toBe("bitBetter");
    expect(versusMareBand(12)).toBe("bitBetter");
    expect(versusMareBand(11)).toBe("same");
    expect(versusMareBand(-11)).toBe("same");
    expect(versusMareBand(-12)).toBe("worse");
  });

  it("level parents have a real chance; far-apart parents make beating both a long shot; inbreeding is a risk", () => {
    const s = pub(stud("lvl-s"));
    const ranges = (lvl: number): PublicParent["ranges"] => Object.fromEntries(STAT_KEYS.map((k) => [k, { lo: lvl - 30, hi: lvl + 30 }])) as PublicParent["ranges"];
    const a = { ...s, id: "a", ranges: ranges(600) };
    const b = { ...s, id: "b", ranges: ranges(600) };
    const far = { ...s, id: "c", ranges: ranges(850) };
    expect(publicLevel(a)).toBe(600);
    expect(pairingOutlook(a, b, { coi: 0 }).outlook.phrase).toBe(OUTLOOK_SENTENCES.same.upside);
    // A much better mare: the foal is usually below her and matching her is a long shot...
    expect(pairingOutlook(a, far, { coi: 0 }).outlook.phrase).toBe(OUTLOOK_SENTENCES.worse.longshot);
    // ...and a much better stallion improves on the mare (the dam).
    expect(pairingOutlook(far, a, { coi: 0 }).outlook.phrase).toBe(OUTLOOK_SENTENCES.better.longshot);
    const inbred = pairingOutlook(a, b, { coi: 250 });
    expect(inbred.outlook.phrase).toMatch(/falling below both parents/);
    expect(inbred.outlook.tone).toBe("caution");
    expect(inbred.warnings.map((w) => w.key)).toContain("inbreeding");
    // A rising line falls back toward its grandparents' level.
    const rising = pairingOutlook(a, b, { coi: 0, grandparents: [{ ranges: ranges(450) }, { ranges: ranges(450) }] });
    expect(rising.warnings.map((w) => w.key)).toContain("rising");
    expect(outlookNumbers(a, b, { coi: 0, grandparents: [{ ranges: ranges(450) }] }).centre).toBeLessThan(600);
    // Well-known parents: a clear picture.
    expect(pairingOutlook(a, b, { coi: 0 }).certainty.key).toBe("clear");
    expect(pairingOutlook({ ...a, ranges: Object.fromEntries(STAT_KEYS.map((k) => [k, { lo: 500, hi: 700 }])) as PublicParent["ranges"] }, b, { coi: 0 }).certainty.key).toBe("hazy");
  });

  it("every (typical vs mare, tail vs both parents) pair is one sentence that can't contradict itself", () => {
    const versus = ["better", "bitBetter", "same", "worse"] as const;
    const tails = ["upside", "level", "longshot", "risk"] as const;
    const all = new Set<string>();
    for (const v of versus)
      for (const t of tails) {
        const line = OUTLOOK_SENTENCES[v][t];
        all.add(line);
        expect(line).not.toMatch(/\d|%/);
        // The typical half says one thing about the mare, and only that.
        const claims = [/improve on your mare/, /edge past your mare/, /close to your mare/, /below your mare/].filter((r) => r.test(line));
        expect(claims).toHaveLength(1);
        expect(claims[0]!.source).toContain(v === "better" ? "improve" : v === "bitBetter" ? "edge past" : v === "same" ? "close" : "below your mare");
        // Below the mare never comes with "a real chance"; upside is always hedged there.
        if (v === "worse") expect(line).not.toMatch(/real chance|improve|edge past/);
        if (v === "worse" && (t === "upside" || t === "level")) expect(line).toMatch(/though (some|a few) could beat both parents/);
        // A tail of risk never claims upside, and upside never claims risk.
        if (t === "risk") expect(line).toMatch(/below both parents/);
        if (t === "upside" || t === "level") expect(line).not.toMatch(/below both parents/);
        if (t === "longshot") expect(line).not.toMatch(/beat both|below both/);
        // The colour agrees with the words.
        const tone = outlookTone(v, t);
        if (/below your mare|below both/.test(line) && !/beat both/.test(line)) expect(tone).toBe("caution");
        if (/real chance|improve|edge past/.test(line) && t !== "risk") expect(tone).toBe("bright");
      }
    expect(all.size).toBe(16);
  });

  it("the sentence the outlook picks always matches its own numbers", () => {
    const base = pub(stud("prop-s"));
    const ranges = (lvl: number, w: number): PublicParent["ranges"] => Object.fromEntries(STAT_KEYS.map((k) => [k, { lo: lvl - w, hi: lvl + w }])) as PublicParent["ranges"];
    let n = 0;
    for (let sl = 400; sl <= 800; sl += 25)
      for (let ml = 400; ml <= 800; ml += 25)
        for (const [w, coi] of [[20, 0], [80, 0], [130, 120], [40, 250]] as const) {
          const sire = { ...base, id: "s", ranges: ranges(sl, w) };
          const mare = { ...base, id: "m", ranges: ranges(ml, w) };
          const num = outlookNumbers(sire, mare, { coi });
          const line = pairingOutlook(sire, mare, { coi }).outlook.phrase;
          if (/real chance/.test(line)) expect(num.beats).toBeGreaterThanOrEqual(350);
          if (/long shot/.test(line)) expect(num.beats).toBeLessThan(120);
          if (/below both parents/.test(line)) expect(num.below).toBeGreaterThanOrEqual(350);
          if (/improve on your mare/.test(line)) expect(num.versusMare).toBeGreaterThanOrEqual(40);
          if (/below your mare/.test(line)) expect(num.versusMare).toBeLessThanOrEqual(-12);
          // "Matching her is a long shot" is only said when she is the better parent.
          if (/matching her/.test(line)) expect(ml).toBeGreaterThan(sl);
          // The flagged combination never appears.
          expect(/below your mare/.test(line) && /real chance/.test(line)).toBe(false);
          n++;
        }
    expect(n).toBeGreaterThan(1000);
  });

  it("warns in words about fragile legs and injuries; the outlook has no numbers in it", () => {
    const s = pub(stud("w-s"));
    const m = pub(mare("w-m"));
    expect(pairingOutlook({ ...s, fragile: true }, m, { coi: 0 }).warnings.map((w) => w.key)).toContain("fragile");
    expect(pairingOutlook(s, { ...m, injured: true }, { coi: 0 }).warnings.map((w) => w.key)).toContain("injury");
    const o = pairingOutlook(s, m, { coi: 30 });
    expect(JSON.stringify(o)).not.toMatch(/\d/);
    expect(o.nick).toMatch(/^(Excellent|Good|Fair|Poor) nick$/);
  });
});
