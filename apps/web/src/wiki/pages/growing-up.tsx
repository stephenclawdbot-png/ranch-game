import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, Figure, GameLink, H2, H3, HorseCard, HorseRow, Lead, List, P, Table, WikiLink, pct, sampleGenome } from "../kit";

const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", pattern: "hoops", cap: "#1f4e9c" } as const;
const TYPES: gc.MaturityType[] = ["early", "normal", "late"];
const TYPE_LABEL: Record<gc.MaturityType, string> = { early: "Early peaker", normal: "Normal maturity", late: "Late developer" };
const TYPE_BLURB: Record<gc.MaturityType, string> = {
  early: "Comes to hand quickly and is at its best in the first half of its career.",
  normal: "Peaks through the middle of its career.",
  late: "Keeps improving and is at its best later in its career.",
};
const STAT_LABEL: Record<gc.StatKey, string> = { speed: "Speed", stamina: "Stamina", burst: "Burst", durability: "Durability", adaptability: "Adaptability", temperament: "Temperament" };

/** A grey horse, shown as a foal, a young racehorse and a seasoned one (coats change with the career). */
function greyThroughLife() {
  for (let i = 0; i < 400; i++) {
    const g = sampleGenome(`grow-grey-${i}`);
    if (!g.coat.grey.includes("G")) continue;
    const at = (racingAge: boolean, starts: number) => gc.appearanceOf(g, { racingAge, starts, retired: false }, SILKS as Parameters<typeof gc.appearanceOf>[2]);
    return { foal: at(false, 0), young: at(true, 0), seasoned: at(true, gc.GREY_WHITE_AT_STARTS) };
  }
  return null;
}

/** Average maturity of the six stats (permille of potential) at each start, by maturity type. */
function curves() {
  return TYPES.map((type) => ({
    type,
    points: Array.from({ length: gc.CAREER_MAX_STARTS + 1 }, (_, s) => {
      const v = gc.STAT_KEYS.reduce((a, k) => a + gc.maturityAt(k, type, gc.CARE_TO_RACING, s), 0) / gc.STAT_KEYS.length;
      return Math.round(v);
    }),
  }));
}

export default function GrowingUpPage() {
  const grey = greyThroughLife();
  const cv = curves();
  const lo = Math.min(...cv.flatMap((c) => c.points));
  const atRacingAge = (type: gc.MaturityType) => Math.round(gc.STAT_KEYS.reduce((a, k) => a + gc.maturityAt(k, type, gc.CARE_TO_RACING, 0), 0) / gc.STAT_KEYS.length);
  const atEnd = (type: gc.MaturityType) => Math.round(gc.STAT_KEYS.reduce((a, k) => a + gc.maturityAt(k, type, gc.CARE_TO_RACING, gc.CAREER_MAX_STARTS), 0) / gc.STAT_KEYS.length);
  const newborn = gc.maturityAt("speed", "normal", 0, 0);
  return (
    <>
      <Lead>
        A horse grows up on its own clock, not the calendar. A youngster moves on with each day you care for it; a racehorse moves on with each start. Nothing ages while you are away, so a
        foal left alone for a month is still the same foal, waiting for you.
      </Lead>
      <Figure src="/art/diorama/poster-pasture.png" alt="Mares and foals out at pasture" caption="Foals grow up through daily care, then move on to the racecourse." focus={0.6} />

      <H2 id="stages">The life stages</H2>
      <Table
        head={["Stage", "Reached by", "What it can do"]}
        rows={[
          ["Foal", "Being born", "Grow. No training, no racing."],
          ["Weanling", `${gc.CARE_TO_WEAN} care sessions`, "Grow. Still too young to train."],
          ["Yearling", `${gc.CARE_TO_YEARLING} care sessions`, "Light training only, at half the usual effect."],
          ["Juvenile", `${gc.CARE_TO_RACING} care sessions (racing age)`, `Race. Juvenile until ${gc.JUVENILE_MAX_STARTS} starts.`],
          ["Prime", `${gc.JUVENILE_MAX_STARTS + 1} starts`, `The heart of the career, to ${gc.PRIME_MAX_STARTS} starts.`],
          ["Veteran", `${gc.PRIME_MAX_STARTS + 1} starts`, `Still racing, with slightly higher injury risk, until ${gc.CAREER_MAX_STARTS} starts.`],
        ]}
      />
      <P>
        After {gc.CAREER_MAX_STARTS} starts (or earlier, if you choose or an injury ends it) the racing career is over. A horse can then go to stud or become a broodmare while it has
        breedings left, or retire for good to the Legacy Farm. See <WikiLink slug="racing-career" /> and <WikiLink slug="stud-and-broodmares" />.
      </P>
      <Facts
        rows={[
          ["Care sessions to wean", gc.CARE_TO_WEAN],
          ["Care sessions to yearling", gc.CARE_TO_YEARLING],
          ["Care sessions to racing age", gc.CARE_TO_RACING],
          ["Juvenile", `0 to ${gc.JUVENILE_MAX_STARTS} starts`],
          ["Prime", `${gc.JUVENILE_MAX_STARTS + 1} to ${gc.PRIME_MAX_STARTS} starts`],
          ["Veteran", `${gc.PRIME_MAX_STARTS + 1} to ${gc.CAREER_MAX_STARTS} starts`],
        ]}
      />

      <H2 id="care-to-racing">From foal to racing age</H2>
      <P>
        Each counted care session moves a youngster one step on. You get one counted session per horse per day, so a newborn foal needs at least <b>{gc.CARE_TO_RACING} days</b> of care to
        reach racing age. Miss a day and growth simply waits. Its body fills out as it grows: a newborn shows about {pct(newborn)} of its potential, and gains evenly with each session up to its
        racing-age level.
      </P>
      {grey && (
        <>
          <P>Coats can change too. A grey is born coloured, races dappled, and goes grey as its career goes on:</P>
          <HorseRow>
            <HorseCard appearance={grey.foal} name="As a foal" line="Born coloured" size="sm" />
            <HorseCard appearance={grey.young} name="At racing age" line="Dappled" size="sm" />
            <HorseCard appearance={grey.seasoned} name={`After ${gc.GREY_WHITE_AT_STARTS} starts`} line="Grey" size="sm" />
          </HorseRow>
        </>
      )}

      <H2 id="maturity">Maturity and the peak window</H2>
      <P>
        Genes give every horse a maturity type. It decides when, in starts, the horse reaches its full potential, and how long it stays there. Before the window the horse is still
        improving; after it, it slowly loses a little, speed first.
      </P>
      <Table
        head={["Type", "Peak window", "At racing age", "At the last start", "In short"]}
        rows={TYPES.map((t) => [TYPE_LABEL[t], `starts ${gc.PEAK_WINDOW[t][0]} to ${gc.PEAK_WINDOW[t][1]}`, pct(atRacingAge(t)), pct(atEnd(t)), TYPE_BLURB[t]])}
        caption="Share of potential shown, averaged over the six stats."
      />
      <div className="inset grid gap-3 p-3" role="img" aria-label="How much of its potential a horse shows at each start, by maturity type">
        <p className="label">Share of potential at each start, 0 to {gc.CAREER_MAX_STARTS}</p>
        {cv.map((c) => (
          <div key={c.type} className="grid gap-1">
            <span className="caption">{TYPE_LABEL[c.type]}</span>
            <div className="flex h-12 items-end gap-[2px]">
              {c.points.map((v, s) => {
                const [from, to] = gc.PEAK_WINDOW[c.type];
                return (
                  <span
                    key={s}
                    title={`Start ${s}: ${pct(v)}`}
                    className="flex-1"
                    style={{ height: `${Math.max(4, ((v - lo) / (1000 - lo)) * 100)}%`, background: s >= from && s <= to ? "var(--color-brass)" : "#8fa592" }}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <p className="caption">Brass bars: the peak window. Worked out by the game&rsquo;s own maturity curve when this page is built.</p>
      </div>
      <H3>Not every stat peaks at once</H3>
      <P>
        Each stat&rsquo;s window is nudged from the horse&rsquo;s own:{" "}
        {gc.STAT_KEYS.map((k, i) => {
          const d = gc.STAT_PEAK_SHIFT[k];
          return (
            <span key={k}>
              {STAT_LABEL[k]} {d === 0 ? "on time" : d < 0 ? `${-d} starts early` : `${d} starts late`}
              {i < gc.STAT_KEYS.length - 1 ? ", " : "."}
            </span>
          );
        })}{" "}
        Speed and burst come first; stamina, adaptability and temperament keep building.
      </P>
      <Callout tone="tip">
        <p>
          Check the maturity type on the horse&rsquo;s Career tab before you plan big races. Point an early peaker at good races soon, and give a late developer time: its best days are still
          ahead.
        </p>
      </Callout>

      <H2 id="nursery">The nursery</H2>
      <P>
        Every horse not yet at racing age shows in the <GameLink href="/nursery">Nursery</GameLink>, with its care progress and what is known so far about its potential. Foals arrive from
        your own mares, from Paddock Packs and, on your second day, as a gift from the Club.
      </P>
      <List
        items={[
          <>A foal needs a stall. If the stalls are full it waits in the nursery overflow slot, and moves in as soon as a stall frees up.</>,
          <>
            Its potential shows as a range that narrows at each stage and with every start. A Pedigree Scan narrows it for good. See <WikiLink slug="genetics-and-inheritance" />.
          </>,
          <>
            When the last care session is done, the youngster appears under <b>Ready to race</b>. Tap <b>Welcome to the yard</b> and it joins your racing string.
          </>,
          <>
            A stable hand from <WikiLink slug="facilities" /> cares for every horse in one tap.
          </>,
        ]}
      />
      <Callout tone="rule" title="Time never hurts a horse">
        <p>Stages move only with care and starts. Nothing ages, declines or is lost because time passed; a missed day only pauses growth.</p>
      </Callout>
      <P>
        Day-to-day care is covered in <WikiLink slug="care-and-condition" />.
      </P>
    </>
  );
}
