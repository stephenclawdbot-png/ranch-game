/**
 * Story mode (§4e): a single-player career campaign against named AI rival stables, in four
 * chapters (Club → County → National → Classics). Each chapter has six fixed races that
 * together cover every surface and the whole trip range (so every horse finds races that suit
 * it); winning three different races of a chapter completes it and earns the next licence.
 * Licences unlock Live race classes (eligibility) and the next Story chapter.
 *
 * Rewards are credits capped per chapter (economy.ts `storyReward`: full on a race's first win,
 * minimal on replays). We choose the *field* (the rivals' strength), never the result: every
 * story race is an honest simulation.
 *
 * Pure data and rules: no I/O, no clock.
 */
import type { Horse, RunningStyle, Silks, Surface, Going } from "@thoroughbred/shared";
import type { RaceTier } from "./types";
import type { StoryChapter } from "./economy";
import { STORY_CHAPTERS } from "./economy";
import { clubRunner } from "./field";

// ---------------------------------------------------------------------------
// Rival stables
// ---------------------------------------------------------------------------

export interface RivalStable {
  id: string;
  name: string;
  trainer: string;
  /** One word for the badge. */
  personality: string;
  bio: string;
  /** What they say when you meet them in the paddock. */
  greeting: string;
  /** Said when you beat them / when they beat you. */
  onYouWin: string;
  onTheyWin: string;
  silks: Silks;
  /** Most of their runners ride this way. */
  style: RunningStyle;
  /** Chapter in which they first appear. */
  debut: StoryChapter;
}

export const RIVAL_STABLES: readonly RivalStable[] = [
  {
    id: "house-harrowgate",
    name: "Harrowgate House",
    trainer: "Eleanor Harrow",
    personality: "Old guard",
    bio: "Forty seasons at the Club and never once late for first lot. Eleanor runs her horses from the front and expects newcomers to wait their turn.",
    greeting: "New colours? We'll see if they're still clean by the furlong pole.",
    onYouWin: "Hm. Well ridden. Don't let it go to your head.",
    onTheyWin: "That's how it's done at Harrowgate. Come back when you've learned the track.",
    silks: { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" },
    style: "front",
    debut: "club",
  },
  {
    id: "house-larkspur",
    name: "Larkspur Farm",
    trainer: "Cass Lark",
    personality: "Friendly rival",
    bio: "Cass took out a licence the same week you did. Cheerful, stubborn and always up for a rematch, her closers come late and come hard.",
    greeting: "You again! Best of luck, honestly. Mostly.",
    onYouWin: "Gah! Next time. Same time next week?",
    onTheyWin: "Did you see that finish? Don't worry, I'll buy the teas.",
    silks: { pattern: "stars", primary: "#2346a8", secondary: "#f4efe3", cap: "#e47aa5" },
    style: "closer",
    debut: "club",
  },
  {
    id: "house-vicarage",
    name: "Old Vicarage Stables",
    trainer: "Tom Penrose",
    personality: "Patient",
    bio: "A retired parson with three horses and infinite patience. Tom's stalkers sit in behind and pounce when everyone else has gone too soon.",
    greeting: "Lovely morning for it. Mind the pace: it rarely holds.",
    onYouWin: "A blessing on your yard. That was nicely judged.",
    onTheyWin: "Patience, my friend. The race is run in the last furlong.",
    silks: { pattern: "solid", primary: "#1f9d5c", secondary: "#1f9d5c", cap: "#f4efe3" },
    style: "stalker",
    debut: "club",
  },
  {
    id: "house-saltmarsh",
    name: "Saltmarsh Racing",
    trainer: "Jory Salt",
    personality: "Grafter",
    bio: "Jory trains on the estuary sands in all weathers. His horses love it soft, never know when they're beaten and never look pretty doing it.",
    greeting: "Bit of rain would suit us. Hope you brought your wellies.",
    onYouWin: "Fair play. You earned that one the hard way.",
    onTheyWin: "Told you. Saltmarsh horses don't stop.",
    silks: { pattern: "stripes", primary: "#6fb3e6", secondary: "#f4efe3", cap: "#16224d" },
    style: "stalker",
    debut: "county",
  },
  {
    id: "house-kestrel",
    name: "Kestrel Downs",
    trainer: "Rhea Kestrel",
    personality: "Speed merchant",
    bio: "Rhea buys fast and sells faster. Kestrel horses blaze the early fractions; the question is always whether they last.",
    greeting: "Try to keep up. We'll be the ones in front.",
    onYouWin: "Lucky pace collapse. It won't happen twice.",
    onTheyWin: "Wire to wire. Write it down.",
    silks: { pattern: "diamonds", primary: "#5b2f8f", secondary: "#f2e27a", cap: "#5b2f8f" },
    style: "front",
    debut: "county",
  },
  {
    id: "house-bellmont",
    name: "Bellmont Lodge",
    trainer: "Marcus Bellamy",
    personality: "Big money",
    bio: "Bellmont has the biggest string in the country and the shiniest horseboxes. Marcus is charming, ruthless and never forgets a defeat.",
    greeting: "Ah, the plucky small yard. Everyone loves a story.",
    onYouWin: "Remarkable. My people will be in touch about that horse.",
    onTheyWin: "Money can't buy everything. It did buy that, though.",
    silks: { pattern: "sash", primary: "#f4efe3", secondary: "#c8242f", cap: "#c8242f" },
    style: "stalker",
    debut: "national",
  },
  {
    id: "house-copperfield",
    name: "Copperfield Stud",
    trainer: "Ada Copperfield",
    personality: "Bloodline purist",
    bio: "Five generations of stayers. Ada can recite a pedigree back to the foundation mares and believes stamina is the only honest virtue.",
    greeting: "Distance finds out every pedigree. Let's see yours.",
    onYouWin: "Interesting. Who is the dam? I'd like to look her up.",
    onTheyWin: "Blood will out. It always does over a trip.",
    silks: { pattern: "chevron", primary: "#e8742a", secondary: "#2d2f33", cap: "#2d2f33" },
    style: "closer",
    debut: "national",
  },
  {
    id: "house-ashcombe",
    name: "Ashcombe Park",
    trainer: "Lady Helena Ashcombe",
    personality: "Champion yard",
    bio: "Ashcombe has won every Classic at least twice. Helena is unfailingly polite, and her horses are the yardstick every other stable is measured by.",
    greeting: "Welcome to the Classics. We've been rather expecting you.",
    onYouWin: "Splendid. Truly. The Classics need new names.",
    onTheyWin: "Well run. There is always next year, and Ashcombe will be here.",
    silks: { pattern: "quartered", primary: "#6e1b2b", secondary: "#a9b0b8", cap: "#6e1b2b" },
    style: "stalker",
    debut: "classics",
  },
];

const RIVAL_BY_ID = new Map(RIVAL_STABLES.map((r) => [r.id, r]));

export function rivalById(id: string): RivalStable | undefined {
  return RIVAL_BY_ID.get(id);
}

/** FNV-1a of a string (integer maths only). */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Which of a race's rival stables a (house) runner runs for. Deterministic from its id. */
export function rivalFor(rivalIds: readonly string[], horseId: string): RivalStable | undefined {
  const ids = rivalIds.filter((id) => RIVAL_BY_ID.has(id));
  if (!ids.length) return undefined;
  return RIVAL_BY_ID.get(ids[fnv(horseId) % ids.length]!);
}

// ---------------------------------------------------------------------------
// Chapters and races
// ---------------------------------------------------------------------------

export interface StoryRaceDef {
  /** Stable key, e.g. "club-1". Also the first-win key for rewards. */
  key: string;
  chapter: StoryChapter;
  /** 1-based order inside the chapter (a suggestion: every race of an open chapter can be run). */
  order: number;
  name: string;
  track: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: "clear" | "overcast" | "rain" | "dusk";
  /** Class label used on the race card. */
  raceClass: "maiden" | "novice" | "handicap" | "listed" | "graded";
  /** Rival stables in the field (the first is the headline rival). */
  rivals: string[];
  /** Runners including yours. */
  fieldSize: number;
  /** Target mean current stat of the rival runners. */
  strength: number;
  /** Narrative beat before the race, and after a win / a defeat. */
  intro: string;
  win: string;
  loss: string;
}

export interface StoryChapterDef {
  id: StoryChapter;
  number: number;
  title: string;
  /** One-line hook. */
  tagline: string;
  intro: string;
  /** Shown once the chapter is complete. */
  outro: string;
  /** Different races to win to complete the chapter. */
  winsToComplete: number;
  /** Licence level needed to run this chapter. */
  licenceRequired: number;
  /** Licence level earned on completion. */
  licenceEarned: number;
  races: StoryRaceDef[];
}

type RaceSeed = Omit<StoryRaceDef, "chapter" | "order" | "key" | "fieldSize" | "strength"> & { strength?: number };

function chapterRaces(chapter: StoryChapter, base: number, fieldSize: number, races: RaceSeed[]): StoryRaceDef[] {
  return races.map((r, i) => ({ ...r, key: `${chapter}-${i + 1}`, chapter, order: i + 1, fieldSize, strength: r.strength ?? base + i * 3 }));
}

export const STORY_CHAPTER_DEFS: readonly StoryChapterDef[] = [
  {
    id: "club",
    number: 1,
    title: "The Club",
    tagline: "Small fields, big ambitions.",
    intro: "Every yard starts here: the Club's Saturday meetings, a tea tent and three stables who have run this place for years. Win three Club races to earn your County licence.",
    outro: "The Club committee signs your County licence over a slice of fruit cake. Harrowgate's trainer almost smiles. The County circuit awaits, and so do Handicap races on the Live card.",
    winsToComplete: 3,
    licenceRequired: 1,
    licenceEarned: 2,
    races: chapterRaces("club", 318, 7, [
      { name: "Larkspur Welcome Plate", track: "Larkspur", distanceM: 1200, surface: "turf", going: "good", weather: "clear", raceClass: "maiden", rivals: ["house-larkspur", "house-vicarage"], intro: "Cass Lark waves from the next box over. \"First race? Mine too, more or less.\" A gentle six furlongs to find your feet.", win: "Your first Club winner. Cass is first to shake your hand, already plotting the rematch.", loss: "Not today, but the horse learned plenty. Cass promises she won't mention it. She mentions it." },
      { name: "Harrowgate Dash", track: "Harrowgate", distanceM: 1000, surface: "dirt", going: "good", weather: "overcast", raceClass: "maiden", rivals: ["house-harrowgate", "house-larkspur"], intro: "Five furlongs on Harrowgate's dirt, where Eleanor Harrow's front-runners have bullied newcomers for decades. Break sharp or forget it.", win: "You beat Harrowgate on their own track. Eleanor writes something in a small black notebook.", loss: "Harrowgate's speed was too much over the minimum trip. Eleanor nods, as if it was always going to be so." },
      { name: "Vicarage All-Weather Mile", track: "Old Vicarage", distanceM: 1600, surface: "synthetic", going: "good", weather: "clear", raceClass: "novice", rivals: ["house-vicarage", "house-harrowgate"], intro: "Tom Penrose's horses love the all-weather mile. \"The pace never holds,\" he says, and he usually means it.", win: "A mile on the synthetic, judged to perfection. Tom raises his flat cap to you.", loss: "Tom's stalker pounced late, exactly as he said it would. Patience is a skill too." },
      { name: "Club Stayers' Trial", track: "Harrowgate", distanceM: 2400, surface: "dirt", going: "good", weather: "dusk", raceClass: "novice", rivals: ["house-harrowgate", "house-vicarage"], intro: "A mile and a half under the floodlights. Stamina counts more than speed tonight.", win: "Your horse kept galloping when the others had nothing left. A real stayer.", loss: "A long way for a young horse. Try one with stamina, or a kinder ride." },
      { name: "Lamplight Sprint", track: "Larkspur", distanceM: 1200, surface: "synthetic", going: "good", weather: "dusk", raceClass: "novice", rivals: ["house-larkspur", "house-harrowgate"], intro: "Larkspur's evening sprint on the all-weather. Cass has brought her best closer and a flask of cocoa.", win: "Under the lamps, you held off the late charge. Cass groans theatrically.", loss: "Cass's closer swept past in the last hundred metres. She's unbearable for the rest of the evening." },
      { name: "Club Championship", track: "Larkspur", distanceM: 2000, surface: "turf", going: "good", weather: "clear", raceClass: "novice", rivals: ["house-harrowgate", "house-larkspur", "house-vicarage"], strength: 334, intro: "The Club Championship: all three of the old stables, ten furlongs of turf and the committee watching from the balcony.", win: "Club champion! The committee rings the old brass bell, and everyone at the Club knows your colours now.", loss: "The Championship goes to an old hand this time. Next year's trophy has your name on the waiting list." },
    ]),
  },
  {
    id: "county",
    number: 2,
    title: "County Circuit",
    tagline: "Bigger fields, sharper rivals.",
    intro: "The County circuit means proper racecourses, bigger fields and two new rivals: Saltmarsh's grafters and Kestrel's speedballs. Win three County races to earn your National licence.",
    outro: "The County stewards hand over your National licence. Rhea Kestrel pretends not to watch. Listed and Group races on the Live card are open to you now.",
    winsToComplete: 3,
    licenceRequired: 2,
    licenceEarned: 3,
    races: chapterRaces("county", 368, 8, [
      { name: "Saltmarsh Novice Stakes", track: "Saltmarsh", distanceM: 1400, surface: "turf", going: "soft", weather: "rain", raceClass: "novice", rivals: ["house-saltmarsh", "house-larkspur"], intro: "Rain off the estuary and Jory Salt grinning. \"Proper ground, this.\" Seven furlongs on soft turf.", win: "You out-slogged the Saltmarsh horses on their own soft ground. Jory claps you on the back, hard.", loss: "The Saltmarsh horses relished the mud. A horse with a better turn of foot in the soft might do it." },
      { name: "Kestrel Sprint", track: "Kestrel Downs", distanceM: 1100, surface: "dirt", going: "good", weather: "clear", raceClass: "handicap", rivals: ["house-kestrel", "house-saltmarsh"], intro: "Rhea Kestrel's sprinters on Kestrel's own dirt. \"Try to keep up.\" They will go very fast, very early.", win: "You let Kestrel burn themselves out and picked them off. Rhea is lost for words, briefly.", loss: "Wire to wire, just as Rhea promised. Next time, sit closer to that pace, or let it collapse." },
      { name: "Estuary All-Weather", track: "Saltmarsh", distanceM: 2000, surface: "synthetic", going: "good", weather: "overcast", raceClass: "handicap", rivals: ["house-saltmarsh", "house-kestrel"], intro: "Ten furlongs on the new all-weather by the estuary. Saltmarsh and Kestrel can't stand each other, which might help you.", win: "While the two rivals duelled, you came through the middle. The County notices.", loss: "A close-fought handicap. The weights were fair; the margins were not." },
      { name: "Downs Mile", track: "Kestrel Downs", distanceM: 1600, surface: "dirt", going: "good", weather: "clear", raceClass: "handicap", rivals: ["house-kestrel", "house-larkspur"], intro: "Cass Lark has made the step up too. \"Couldn't let you have all the fun.\" A mile on the Downs dirt.", win: "You and Cass fought it out, and you came out on top. She insists on a photo anyway.", loss: "Kestrel's miler held on. Cass consoles you, then admits she finished behind you." },
      { name: "Marsh Marathon", track: "Saltmarsh", distanceM: 2600, surface: "synthetic", going: "good", weather: "rain", raceClass: "handicap", rivals: ["house-saltmarsh", "house-harrowgate"], intro: "Thirteen furlongs. Eleanor Harrow has come down from the Club with an old stayer \"for the outing\".", win: "A true test of stamina, passed with honours. Eleanor writes in the notebook again.", loss: "The trip found your horse out. The stayers' game is a different game." },
      { name: "County Cup", track: "Bellmont", distanceM: 2200, surface: "turf", going: "good", weather: "clear", raceClass: "listed", rivals: ["house-kestrel", "house-saltmarsh", "house-larkspur"], strength: 384, intro: "The County Cup at Bellmont: grandstands, a brass band, and a man from Bellmont Lodge taking notes on every runner.", win: "County Cup winner! The man from Bellmont hands you a card: \"Marcus Bellamy would like a word.\"", loss: "A gallant run in the County Cup. The man from Bellmont writes something down regardless." },
    ]),
  },
  {
    id: "national",
    number: 3,
    title: "National Stage",
    tagline: "The big yards take notice.",
    intro: "On the National stage you meet the money: Bellmont Lodge's enormous string and Copperfield Stud's stayers bred over five generations. Win three National races to earn your Classics licence.",
    outro: "The Jockey Club grants your Classics licence. Marcus Bellamy offers to buy your best horse; Ada Copperfield asks about its dam. The Classics await, and Feature races on the Live card.",
    winsToComplete: 3,
    licenceRequired: 3,
    licenceEarned: 4,
    races: chapterRaces("national", 405, 9, [
      { name: "Bellmont Stakes", track: "Bellmont", distanceM: 1600, surface: "turf", going: "firm", weather: "clear", raceClass: "listed", rivals: ["house-bellmont", "house-kestrel"], intro: "Bellmont Lodge sends three runners to its own Stakes. Marcus Bellamy: \"Ah, the plucky small yard.\"", win: "You beat Bellmont at Bellmont. Marcus's smile doesn't reach his eyes.", loss: "Bellmont's depth told in the end. Money can't buy everything, but it bought that." },
      { name: "Copperfield Stayers' Cup", track: "Copperfield", distanceM: 2800, surface: "turf", going: "good", weather: "overcast", raceClass: "listed", rivals: ["house-copperfield", "house-saltmarsh"], intro: "Fourteen furlongs at Copperfield, where Ada's stayers have won this race eleven times. \"Distance finds out every pedigree.\"", win: "Your horse stayed every yard. Ada asks, very politely, for its pedigree.", loss: "Copperfield blood told over the trip. Some horses are born to stay." },
      { name: "Metropolitan Sprint", track: "Kestrel Downs", distanceM: 1200, surface: "synthetic", going: "good", weather: "dusk", raceClass: "listed", rivals: ["house-kestrel", "house-bellmont"], intro: "Six furlongs under the lights, and Rhea Kestrel wants revenge for the County.", win: "Faster than Kestrel over six. Rhea finally says \"well run\" and means it.", loss: "Kestrel got their revenge. Rhea is insufferable, which is at least consistent." },
      { name: "National Dirt Derby", track: "Bellmont", distanceM: 2000, surface: "dirt", going: "good", weather: "clear", raceClass: "graded", rivals: ["house-bellmont", "house-copperfield"], intro: "The Dirt Derby: Group class, ten furlongs, and both of the big yards at full strength.", win: "A Group winner! The papers call your yard \"the story of the season\".", loss: "A Group race is a Group race. Your horse belongs at this level, though." },
      { name: "Foundry Mile", track: "Copperfield", distanceM: 1400, surface: "synthetic", going: "good", weather: "rain", raceClass: "graded", rivals: ["house-copperfield", "house-bellmont", "house-saltmarsh"], intro: "Seven furlongs on Copperfield's all-weather, with Jory Salt back for a crack at the big time.", win: "A tactical masterpiece on the all-weather. Three rival yards, one winner.", loss: "A rough race in a big field. The draw and the pace didn't fall your way." },
      { name: "National Trophy", track: "Ashcombe", distanceM: 2400, surface: "dirt", going: "good", weather: "clear", raceClass: "graded", rivals: ["house-bellmont", "house-copperfield", "house-ashcombe"], strength: 422, intro: "The National Trophy at Ashcombe Park. Lady Helena Ashcombe watches from the royal box, and so does the whole country.", win: "National Trophy winner! Lady Ashcombe sends a handwritten note: \"See you at the Classics.\"", loss: "The National Trophy stays with the big yards, but Lady Ashcombe made a point of asking your name." },
    ]),
  },
  {
    id: "classics",
    number: 4,
    title: "The Classics",
    tagline: "History is written here.",
    intro: "The Classics: the oldest races in the calendar, Ashcombe Park's home ground, and every rival you have ever met. Win three Classics to become a Classics champion.",
    outro: "Classics champion. Your colours hang in the Ashcombe weighing room beside a century of legends, and every rival yard knows your name. The Hall of Fame has a place for you.",
    winsToComplete: 3,
    licenceRequired: 4,
    licenceEarned: 5,
    races: chapterRaces("classics", 440, 10, [
      { name: "Ashcombe Guineas", track: "Ashcombe", distanceM: 1600, surface: "turf", going: "good", weather: "clear", raceClass: "graded", rivals: ["house-ashcombe", "house-bellmont"], intro: "The Guineas: the first Classic of the year, a straight mile, and Lady Ashcombe's best colt as favourite.", win: "Guineas winner! The first Classic belongs to your yard.", loss: "The Guineas is a cruel race: one mile, no excuses. There are more Classics to come." },
      { name: "Classic Sprint", track: "Kestrel Downs", distanceM: 1100, surface: "dirt", going: "good", weather: "clear", raceClass: "graded", rivals: ["house-kestrel", "house-ashcombe"], intro: "The fastest race of the season. Rhea Kestrel has bought a new sprinter just for today.", win: "The fastest horse in the land. Rhea shakes your hand, and holds it a moment.", loss: "Kestrel's new speedster was a blur. The sprint crown stays on the Downs." },
      { name: "Grand All-Weather Derby", track: "Saltmarsh", distanceM: 2400, surface: "synthetic", going: "good", weather: "overcast", raceClass: "graded", rivals: ["house-saltmarsh", "house-copperfield", "house-ashcombe"], intro: "The all-weather Derby by the estuary, and Jory Salt has a horse who could win it.", win: "Derby winner on the all-weather! Jory leads the applause, loudest of all.", loss: "A gruelling Derby. Everyone in the field earned their oats today." },
      { name: "Ashcombe Oaks", track: "Ashcombe", distanceM: 2400, surface: "turf", going: "good", weather: "clear", raceClass: "graded", rivals: ["house-ashcombe", "house-larkspur"], intro: "The Oaks, and look who's here: Cass Lark, all the way from the Club, with the best horse she has ever had.", win: "Oaks winner! Cass finished right behind you and is crying happy tears anyway.", loss: "A fierce Oaks. Cass ran the race of her life, and so did you." },
      { name: "Copperfield St Leger", track: "Copperfield", distanceM: 2800, surface: "dirt", going: "good", weather: "dusk", raceClass: "graded", rivals: ["house-copperfield", "house-harrowgate"], intro: "The Leger: the oldest Classic and the longest. Eleanor Harrow has entered too. \"One last time.\"", win: "St Leger winner! Eleanor Harrow closes her black notebook and gives it to you.", loss: "The Leger rewards the true stayer. Eleanor's old horse ran a blinder." },
      { name: "The Thoroughbred Classic", track: "Ashcombe", distanceM: 2000, surface: "synthetic", going: "good", weather: "clear", raceClass: "graded", rivals: ["house-ashcombe", "house-bellmont", "house-copperfield"], strength: 458, intro: "The last Classic of the season. Every great yard, every great horse, ten furlongs. This is the one they remember.", win: "Winner of the Thoroughbred Classic! The roar from the stands is something you'll hear for the rest of your life.", loss: "The greatest race of the year, and you were in it. Ashcombe wins, but the crowd chants your yard's name." },
    ]),
  },
];

const RACE_BY_KEY = new Map(STORY_CHAPTER_DEFS.flatMap((c) => c.races.map((r) => [r.key, r] as const)));

export function storyRaceByKey(key: string): StoryRaceDef | undefined {
  return RACE_BY_KEY.get(key);
}

export function chapterDef(id: StoryChapter): StoryChapterDef {
  return STORY_CHAPTER_DEFS.find((c) => c.id === id)!;
}

/** Rival stables who appear in a chapter (in first-appearance order). */
export function chapterRivals(id: StoryChapter): RivalStable[] {
  const ids: string[] = [];
  for (const r of chapterDef(id).races) for (const x of r.rivals) if (!ids.includes(x)) ids.push(x);
  return ids.map((x) => RIVAL_BY_ID.get(x)!).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Progress and licences
// ---------------------------------------------------------------------------

export interface LicenceDef {
  level: number;
  name: string;
  /** Live race classes it adds. */
  unlocks: string;
}

export const LICENCES: readonly LicenceDef[] = [
  { level: 1, name: "Club licence", unlocks: "Maiden and Novice races and the 0–55 Handicap" },
  { level: 2, name: "County licence", unlocks: "the 50–75 and 70–95 Handicaps" },
  { level: 3, name: "National licence", unlocks: "Listed and Group races" },
  { level: 4, name: "Classics licence", unlocks: "Feature races, Group 1 and the Season Final" },
  { level: 5, name: "Classics champion", unlocks: "the champion's title (every class is already open)" },
];

export const MAX_LICENCE = 5;

export function licenceDef(level: number): LicenceDef {
  return LICENCES[Math.max(1, Math.min(MAX_LICENCE, level)) - 1]!;
}

/** Licence level a Live race class needs. `feature` = Weekend Feature, Season Final or the hourly Feature. */
export function licenceForTier(tier: RaceTier, feature = false): number {
  if (feature) return 4;
  switch (tier) {
    case "hcp_50_75":
    case "hcp_70_95":
      return 2;
    case "listed":
    case "g3":
    case "g2":
      return 3;
    case "g1":
      return 4;
    default:
      return 1;
  }
}

/** Null when the licence allows the race, else the licence that would. */
export function licenceBlock(level: number, tier: RaceTier, feature = false): LicenceDef | null {
  const need = licenceForTier(tier, feature);
  return level >= need ? null : licenceDef(need);
}

export interface ChapterProgress {
  chapter: StoryChapterDef;
  unlocked: boolean;
  /** Race keys won at least once. */
  won: string[];
  complete: boolean;
}

/** Chapter states from the licence level and the set of story race keys won. */
export function storyProgress(licenceLevel: number, wonKeys: ReadonlySet<string>): ChapterProgress[] {
  return STORY_CHAPTER_DEFS.map((chapter) => {
    const won = chapter.races.filter((r) => wonKeys.has(r.key)).map((r) => r.key);
    return { chapter, unlocked: licenceLevel >= chapter.licenceRequired, won, complete: won.length >= chapter.winsToComplete || licenceLevel >= chapter.licenceEarned };
  });
}

/** The chapter a player is working on: the first unlocked, incomplete one (else the last). */
export function currentChapter(licenceLevel: number, wonKeys: ReadonlySet<string>): StoryChapter {
  const p = storyProgress(licenceLevel, wonKeys);
  return (p.find((c) => c.unlocked && !c.complete) ?? [...p].reverse().find((c) => c.unlocked) ?? p[0]!).chapter.id;
}

/** Licence after recording wins (never goes down). */
export function licenceAfter(licenceLevel: number, wonKeys: ReadonlySet<string>): number {
  let level = Math.max(1, licenceLevel);
  for (const c of STORY_CHAPTER_DEFS) {
    if (level < c.licenceRequired) break;
    const wins = c.races.filter((r) => wonKeys.has(r.key)).length;
    if (wins >= c.winsToComplete) level = Math.max(level, c.licenceEarned);
  }
  return Math.min(MAX_LICENCE, level);
}

export function isStoryChapter(x: unknown): x is StoryChapter {
  return typeof x === "string" && (STORY_CHAPTERS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// The field: rival runners at the chapter's strength
// ---------------------------------------------------------------------------

/**
 * A rival stable's runner in a story race: an honest Club-style horse at the race's strength,
 * fit for the race (its trip and surface), mostly ridden the way its stable rides. `horseId`
 * keeps the house horse's identity; callers keep its name and look.
 */
export function storyRivalRunner(race: Pick<StoryRaceDef, "key" | "strength" | "distanceM" | "surface">, raceSeedLabel: string, horseId: string, rival: RivalStable | undefined): Horse {
  const h = fnv(`${raceSeedLabel}|${horseId}`);
  const style: RunningStyle = rival && h % 3 !== 0 ? rival.style : (["front", "stalker", "closer"] as const)[h % 3]!;
  const spread = (h >>> 3) % 31; // 0..30 around the race strength
  const runner = clubRunner(`story|${race.key}|${raceSeedLabel}`, { id: horseId, strength: race.strength - 15 + spread, spread: 50, distanceM: race.distanceM, surface: race.surface, style });
  return rival ? { ...runner, ownerId: rival.id, appearance: { ...runner.appearance, silks: rival.silks } } : runner;
}
