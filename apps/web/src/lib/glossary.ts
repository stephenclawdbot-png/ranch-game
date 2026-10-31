/**
 * The glossary: one source for the wiki's Glossary page and the in-game term tooltips
 * (plain-language mode, components/onboarding/Term.tsx). Plain strings only, built from
 * game-core and shared constants, so it is safe in client components.
 */
import * as gc from "@thoroughbred/game-core";
import { FURLONG_MM, GoingSchema, HORSE_LENGTH_MM, SurfaceSchema } from "@thoroughbred/shared";

/** A term, its meaning in plain words, and the wiki page that explains it properly. */
export type GlossaryEntry = [term: string, meaning: string, slug: string];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FLOORS = gc.LEAGUE_TIERS.slice(0, gc.LEAGUE_TIERS.indexOf(gc.RELEGATION_FROM_TIER)).map(cap);

const list = (xs: readonly string[]) => xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

export const GLOSSARY: readonly GlossaryEntry[] = [
  ["Ability mark", "The rating a horse of its current running ability would settle at. Keeps strong newcomers out of the weakest bands.", "ratings-and-form"],
  ["All-out", "The hardest ride: more finishing kick, a higher injury risk.", "entering-a-race"],
  ["Allele", "One of the two copies of a gene a horse carries, one from its sire and one from its dam.", "genetics-and-inheritance"],
  ["Appraisal", "The game's valuation of a horse, which sets the lowest and highest price it can be listed at.", "the-market"],
  ["At stud", "A stallion retired from racing that still breeds.", "stud-and-broodmares"],
  ["Band", "The rating range a race class is open to, such as Handicap (0-55).", "ratings-and-form"],
  ["Bond", "How close a horse is to your stable; grows with care and racing.", "care-and-condition"],
  ["Broodmare", "A mare retired from racing that still breeds.", "stud-and-broodmares"],
  ["Burst", "The finishing kick in the last part of a race.", "stats-and-aptitudes"],
  ["Career clock", `A horse's starts out of ${gc.CAREER_MAX_STARTS}. Horses age by racing, never by the calendar.`, "racing-career"],
  ["Closer", "A horse ridden to settle at the back and make one long late run.", "entering-a-race"],
  ["Club, the", "The game's own stable. Its horses fill empty gates, and its rival stables race you in Story mode.", "race-types"],
  ["COI", "Coefficient of inbreeding: how related a foal's parents are. Higher means more inbred.", "inbreeding"],
  ["Colt", "A young male horse. He becomes a stallion once he can breed.", "growing-up"],
  ["Covering", "Mating a mare with a stallion. The foal is due a day later.", "breeding-basics"],
  ["Cup Run", "Your one run of the day in the Daily Cup.", "daily-cup"],
  ["Daily Cup", "A free daily time trial: everyone runs the same field with the same seed.", "daily-cup"],
  ["Dam", "A horse's mother.", "breeding-basics"],
  ["Durability", "Resistance to injury and fatigue.", "stats-and-aptitudes"],
  ["Easy", "The gentlest ride: a little less kick, a lower injury risk.", "entering-a-race"],
  ["Entries", "The stable entry bank you spend to run in Live races.", "credits-and-entries"],
  ["Family limits", "The lowest and highest a foal's genes can land, set by its family line.", "family-limits"],
  ["Feature", "The top race of every other race meeting on the Live card (Listed or Group 3, double prize money), and the Group 1 Weekend Feature on Saturdays.", "race-types"],
  ["Feature Qualifier", "A weekday Listed race: a top-3 finish gets a horse into that week's Weekend Feature.", "race-types"],
  ["Floor", `A League tier nobody is relegated from: ${list(FLOORS)}.`, "league"],
  ["Filly", "A young female horse. She becomes a mare once she can breed.", "growing-up"],
  ["Foal", "A newborn horse. It grows up through daily care.", "growing-up"],
  ["Form", "The last three finishes on the racecard, oldest first. 0 means outside the first nine.", "ratings-and-form"],
  ["Fragile legs", "An inherited weakness that raises injury risk, passed on by parents whose career ended in an injury.", "fragile-legs"],
  ["Front-runner", "A horse ridden to lead from the start.", "entering-a-race"],
  ["Furlong", `An old racing distance of ${FURLONG_MM / 1000} metres. Trips are shown in metres and furlongs.`, "race-types"],
  ["Gelding", "A male horse that can't breed.", "stud-and-broodmares"],
  ["Going", `The state of the ground: ${list(GoingSchema.options)}. It comes from each course's weather on the day.`, "weather-and-going"],
  ["Grade", `A letter for a horse's overall potential, from ${gc.GRADE_FLOORS[gc.GRADE_FLOORS.length - 1]![0]} up to ${gc.GRADE_FLOORS[0]![0]}.`, "genetics-and-inheritance"],
  ["Group race", "The top class: Group 3, Group 2 and Group 1.", "race-types"],
  ["Hall of Fame", "The Club's permanent roll of honour.", "hall-and-trophies"],
  ["Handicap", "A race for horses within a rating band.", "race-types"],
  ["In memoriam", "A horse killed by a fatal injury. It rests on the Legacy Farm and is never forgotten.", "legacy-farm"],
  ["Juvenile", `A young racehorse with up to ${gc.JUVENILE_MAX_STARTS} starts.`, "racing-career"],
  ["League", `Weekly tables of stables, scored from their best ${gc.BEST_RUNS_COUNTED} Live runs, with promotion, and relegation from ${cap(gc.RELEGATION_FROM_TIER)} up.`, "league"],
  ["Legacy Farm", "Where horses retire for good: no racing, no breeding, no stall, no upkeep.", "legacy-farm"],
  ["Length", `A horse's length, ${HORSE_LENGTH_MM / 1000} metres: how winning margins are measured.`, "how-races-are-run"],
  ["Licence", "Earned in Story mode; opens the higher Live race classes.", "race-types"],
  ["Listed race", "The class just below Group races.", "race-types"],
  ["Live race", `A shared race on the card, run in race meetings (${gc.MEETINGS_PER_DAY} a day, ${gc.RACES_PER_MEETING} races each), that everyone watches together. A horse can run ${gc.MAX_LIVE_STARTS_PER_DAY === 1 ? "one" : gc.MAX_LIVE_STARTS_PER_DAY} a day.`, "race-types"],
  ["Maiden", "A horse that has never won, and the race class for them.", "race-types"],
  ["Mare", "A grown female horse.", "breeding-basics"],
  ["Maturity type", "Early peaker, normal or late developer: when in its career a horse is at its best.", "racing-career"],
  ["Nick", "The breeding preview's word for how well a pairing fits: Excellent, Good, Fair or Poor nick.", "genetics-and-inheritance"],
  ["Novice", "The race class for horses with only a couple of wins.", "race-types"],
  ["Nursery", "Where foals wait when every stall is taken.", "growing-up"],
  ["OR", `Official rating, ${gc.OR_MIN} to ${gc.OR_MAX}: the handicapper's mark of how good a horse is.`, "ratings-and-form"],
  ["Outlook", "The breeding preview's words for how a foal of a pairing might turn out, e.g. \"Usually close to your mare, with a real chance to beat both parents\". Never odds.", "breeding-basics"],
  ["Paddock", "Where the runners parade before the off.", "entering-a-race"],
  ["Peak rating", "The highest rating a horse has reached. Rating bands check against it.", "ratings-and-form"],
  ["Peak window", "The stretch of starts in which a horse is at its best.", "racing-career"],
  ["Pedigree Scan", "Narrows the ranges shown for a horse's hidden potential, for good.", "genetics-and-inheritance"],
  ["Photo finish", "A finish where the first two are almost level.", "how-races-are-run"],
  ["Possible looks", "Sample foals the breeding preview draws for a pairing: what a foal could look like. Still a chance; new samples each day.", "breeding-basics"],
  ["Potential", "The ceiling for each stat, set by the genes. Training brings a horse up towards it.", "genetics-and-inheritance"],
  ["Prime", "The middle of a racing career, between juvenile and veteran.", "racing-career"],
  ["Provisional", `A horse in its first ${gc.PROVISIONAL_RUNS} rated runs, whose rating moves faster.`, "ratings-and-form"],
  ["Purse", "A race's prize money, shared among the first few home.", "race-types"],
  ["Quick Pick", "Runs your best-suited fresh horse in a Story race straight away.", "race-types"],
  ["Race meeting", `A block of ${gc.RACES_PER_MEETING} Live races, ${gc.MEETING_RACE_SPACING_MS / 60_000} minutes apart. There are ${gc.MEETINGS_PER_DAY} a day, from ${gc.MEETING_START_TIMES_UTC.join(", ")} UTC.`, "race-types"],
  ["Racecard", "The printed list of a race's runners, with form and ratings.", "entering-a-race"],
  ["Road to Saturday", "The Estate tile that opens This week: the week's Feature, your Qualifiers and your League line.", "the-estate"],
  ["Racing age", `Reached after ${gc.CARE_TO_RACING} care sessions as a youngster, one a day.`, "growing-up"],
  ["Result hash", "A fingerprint of a race's result, so a replay can be checked.", "how-races-are-run"],
  ["Scratch", "Withdraw your horse before entries close. The entry spent is lost.", "entering-a-race"],
  ["Season", `${gc.SEASON_DAYS} days of competition, ending with the Season Final.`, "league"],
  ["Season Final", "The championships on the last day of each season, one per distance division.", "league"],
  ["Weekend Feature", `Saturday's Group 1, for horses with a top 3 in that week's Qualifiers or a rating of 100+. Needs the ${gc.licenceDef(gc.licenceForTier("g1", true)).name}.`, "race-types"],
  ["Week recap", "The inbox note after each League week: your finish, your move and the points gap to promotion.", "league"],
  ["Seed", "The secret number that, with the field, decides a race. Sealed before the off, revealed after.", "how-races-are-run"],
  ["Sire", "A horse's father.", "breeding-basics"],
  ["Speed", "Top speed in a race.", "stats-and-aptitudes"],
  ["Stall", "A place in your stable. Every horse except those on the Legacy Farm needs one.", "facilities"],
  ["Stalker", "A horse ridden just behind the leaders, to pounce in the straight.", "entering-a-race"],
  ["Stallion", "A grown male horse that can breed.", "breeding-basics"],
  ["Stamina", "How long a horse can hold its speed; matters more the longer the trip.", "stats-and-aptitudes"],
  ["Story mode", "A solo campaign of chapters against named rival stables.", "race-types"],
  ["Surface", `What a race is run on: ${list(SurfaceSchema.options)}.`, "stats-and-aptitudes"],
  ["This week", "The Racing page that follows the road to Saturday: the Weekend Feature's conditions, the Qualifiers, each horse's status and your League gap.", "league"],
  ["Trip", "The distance of a race.", "stats-and-aptitudes"],
  ["Veteran", `A racehorse after start ${gc.PRIME_MAX_STARTS}, in the last part of its career.`, "racing-career"],
  ["Weanling", "A foal that has been weaned, on its way to yearling.", "growing-up"],
  ["Yearling", "A young horse in its last stage before racing age.", "growing-up"],
  ["Big heart", `A rare recessive gene: with two copies a horse has +${gc.BIG_HEART_STAMINA} stamina potential.`, "breeds"],
  ["Breed %", `A horse's mix of the ${gc.BREEDS.length} breeds. A foal's is the exact average of its parents'.`, "breeds"],
  ["Carrier", "A horse with one copy of a gene it doesn't show but can pass on, marked as a hidden copy on the horse page.", "genetics-and-inheritance"],
  ["Crossbred", "A horse with no single breed at the purebred mark and no named cross, named by its two biggest breeds.", "breeds"],
  ["Dominant", "A gene that shows with one copy.", "genetics-and-inheritance"],
  ["Incomplete dominance", "One copy of a gene shows a little and two copies show fully, like the Height gene or the dished face.", "genetics-and-inheritance"],
  ["Iron legs", `A dominant gene: the injury risk of every start × ${(gc.IRON_LEGS_RISK / 1000).toFixed(2)}.`, "breeds"],
  ["MSTN", "The speed gene: C/C sprinter, C/T miler, T/T stayer.", "breeds"],
  ["Named cross", `A classic two-breed cross with its own name: ${list(gc.NAMED_CROSSES.map(([, , name]) => name))}.`, "breeds"],
  ["Purebred", `A horse with one breed at ${gc.PUREBRED_PERMILLE / 10}% or more.`, "breeds"],
  ["Recessive", "A gene that shows only with two copies, so it can hide for generations.", "genetics-and-inheritance"],
  ["Size", "A horse's height against an average Thoroughbred. Taller moves points into speed and stamina, smaller into burst and durability.", "breeds"],
  ["Place", "Finishing second or third. A place bet on the tote pays if your runner finishes in the first two or three, depending on the field size.", "tote"],
  ["Dead heat", "Two runners crossing the line so close together that the judge can't split them: they share the position, and the prize for it.", "how-races-are-run"],
  ["Tote", "Pool betting on Live races for credits: everyone's stakes on a race go into one pool, the house takes a cut, and the winners share the rest. Bets close at the off.", "tote"],
  ["Weight", "What a horse carries in a handicap: better-rated horses carry more, to even the field up. Apprentice jockeys claim a few pounds off.", "race-types"],
  ["Tactic", "How the jockey rides the race: lead from the front, sit just behind the leaders, or come late from the back.", "entering-a-race"],
  ["Claiming race", "A race where every runner is for sale at a price its owner set when entering it.", "claiming-races"],
];

const KEY = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BY_KEY = new Map(GLOSSARY.map((e) => [KEY(e[0]), e]));

/** Looks a term up by name, case and punctuation ignored ("OR", "going", "dead heat"). */
export function glossaryEntry(term: string): GlossaryEntry | null {
  return BY_KEY.get(KEY(term)) ?? null;
}
