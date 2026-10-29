/**
 * The Post Time wiki: sections and pages (metadata only, so the client-side search can import it
 * without pulling in the page bodies). Page bodies live in ./pages/<slug>.tsx and are wired up in
 * ./content.tsx. Every number a page quotes comes from game-core, so the wiki follows the rules.
 */
import type { IconName } from "@/components/icons";

export type WikiSectionKey = "start" | "horses" | "racing" | "breeding" | "life" | "economy" | "club";

export interface WikiSection {
  key: WikiSectionKey;
  title: string;
  blurb: string;
  icon: IconName;
  /** Poster art for the section card (public path). */
  poster: string;
}

export interface WikiPageMeta {
  slug: string;
  section: WikiSectionKey;
  title: string;
  /** One line for the index, search results and link previews. */
  summary: string;
  /** Extra words the search should match. */
  keywords?: string[];
}

export const WIKI_SECTIONS: WikiSection[] = [
  { key: "start", title: "Getting started", blurb: "Your first stable, credits, entries and where everything lives.", icon: "stable-door", poster: "/art/diorama/poster-yard.png" },
  { key: "horses", title: "Your horses", blurb: "Stats, aptitudes, growing up, care, training and injuries.", icon: "horse-head", poster: "/art/diorama/poster-barn.png" },
  { key: "racing", title: "Racing", blurb: "Race types, entering, tactics, going and how a race is run.", icon: "flag", poster: "/art/diorama/poster-grandstand.png" },
  { key: "breeding", title: "Breeding & genetics", blurb: "Pairings, inheritance, family limits, coats and the fragile gene.", icon: "papers", poster: "/art/diorama/poster-pasture.png" },
  { key: "life", title: "Careers & retirement", blurb: "Stud, broodmares, the Legacy Farm and in memoriam.", icon: "laurel", poster: "/art/diorama/poster-paddock.png" },
  { key: "economy", title: "Sales & facilities", blurb: "The auction house, appraisal, packs, stalls and staff.", icon: "coin", poster: "/art/diorama/poster-sales-ring.png" },
  { key: "club", title: "Club & glory", blurb: "League, Daily Cup, Hall of Fame and your Trophy Room.", icon: "trophy", poster: "/art/diorama/poster-track-dusk.png" },
];

export const WIKI_PAGES: WikiPageMeta[] = [
  // Getting started
  { slug: "quick-start", section: "start", title: "Quick start", summary: "Found a stable and win your first race in ten minutes.", keywords: ["new", "begin", "tutorial", "first"] },
  { slug: "the-estate", section: "start", title: "The estate", summary: "Estate, Stable, Racing, Club and Sales: what each area is for.", keywords: ["navigation", "menu", "areas"] },
  { slug: "credits-and-entries", section: "start", title: "Credits & entries", summary: "How you earn and spend Stable Credits, and the daily entry bank.", keywords: ["money", "coins", "currency", "entries", "daily"] },

  // Your horses
  { slug: "stats-and-aptitudes", section: "horses", title: "Stats & aptitudes", summary: "Speed, stamina and the rest; distance, going and surface preferences.", keywords: ["speed", "stamina", "distance", "going", "surface", "potential"] },
  { slug: "growing-up", section: "horses", title: "Growing up", summary: "From foal to veteran: life stages, care to racing age and the peak window.", keywords: ["foal", "weanling", "yearling", "juvenile", "prime", "veteran", "maturity", "nursery"] },
  { slug: "care-and-condition", section: "horses", title: "Care & condition", summary: "Daily care, feeds, fatigue, freshness, fitness, bond and morale.", keywords: ["feed", "groom", "fatigue", "fresh", "bond", "morale"] },
  { slug: "training", section: "horses", title: "Training", summary: "The trade-off board: what a session gains and what it risks.", keywords: ["train", "workout", "overwork", "realisation"] },
  { slug: "injuries-and-insurance", section: "horses", title: "Injuries & insurance", summary: "Injury risk, the four severities, the vet, and what insurance pays.", keywords: ["injury", "vet", "fatal", "career-ending", "insurance", "risk"] },

  // Racing
  { slug: "race-types", section: "racing", title: "Race types", summary: "Live races, quick races, Story chapters, scheduled cards and classes.", keywords: ["live", "quick", "story", "class", "maiden"] },
  { slug: "entering-a-race", section: "racing", title: "Entering a race", summary: "The racecard, entry fees, the paddock and choosing a tactic.", keywords: ["enter", "racecard", "paddock", "tactic", "front", "closer"] },
  { slug: "how-races-are-run", section: "racing", title: "How races are run", summary: "The race engine, sealed seeds and replays you can verify.", keywords: ["engine", "fair", "seed", "replay", "photo finish", "verify"] },
  { slug: "ratings-and-form", section: "racing", title: "Ratings & form", summary: "Official ratings, rating bands and the form figures on the card.", keywords: ["rating", "or", "form", "band"] },

  // Breeding & genetics
  { slug: "breeding-basics", section: "breeding", title: "Breeding basics", summary: "Covering a mare, seasons, fees, foaling and standing a stallion.", keywords: ["breed", "cover", "stud", "mare", "foal", "season", "fee"] },
  { slug: "genetics-and-inheritance", section: "breeding", title: "Genetics & inheritance", summary: "Alleles, potential and why a foal can beat, match or fall below its parents.", keywords: ["genes", "allele", "inherit", "mutation", "preview", "odds", "potential"] },
  { slug: "family-limits", section: "breeding", title: "Family limits & lineage", summary: "How the family line sets the lowest and highest a foal can be.", keywords: ["limits", "lineage", "floor", "ceiling", "family", "deep", "rising", "foundation"] },
  { slug: "inbreeding", section: "breeding", title: "Inbreeding & kinship", summary: "Coefficient of inbreeding, blocked pairings and what it costs.", keywords: ["coi", "inbreeding", "kin", "related"] },
  { slug: "coats-and-markings", section: "breeding", title: "Coats & markings", summary: "Every coat colour, the genes behind it and white markings.", keywords: ["coat", "colour", "color", "bay", "chestnut", "grey", "roan", "markings", "sabino", "dun"] },
  { slug: "fragile-legs", section: "breeding", title: "Fragile legs", summary: "The heritable weakness from career-ending injuries, and the gamble.", keywords: ["fragile", "injury", "inherit", "durability"] },

  // Careers & retirement
  { slug: "racing-career", section: "life", title: "The racing career", summary: "Starts, the career clock, juvenile, prime and veteran stages.", keywords: ["career", "starts", "max starts", "veteran"] },
  { slug: "stud-and-broodmares", section: "life", title: "Stud & broodmares", summary: "Sending a horse to stud or making a broodmare: no racing, still breeding.", keywords: ["stud", "broodmare", "retire", "gelding"] },
  { slug: "legacy-farm", section: "life", title: "The Legacy Farm", summary: "Retired for good: no racing, no breeding, no upkeep, never forgotten.", keywords: ["legacy", "pasture", "retire", "memoriam", "deceased"] },

  // Sales & facilities
  { slug: "the-market", section: "economy", title: "The auction house", summary: "Buying and selling horses: lots, appraisal, floors, ceilings and seller rules.", keywords: ["market", "sell", "buy", "auction", "lot", "appraisal", "price"] },
  { slug: "facilities", section: "economy", title: "Facilities", summary: "Stalls, the trainer and the vet: what each upgrade does and costs.", keywords: ["stalls", "trainer", "vet", "upgrade"] },
  { slug: "packs", section: "economy", title: "Packs", summary: "What packs contain, the odds and the pity counter.", keywords: ["pack", "odds", "pity", "rarity"] },

  // Club & glory
  { slug: "league", section: "club", title: "The League", summary: "Seasons, points, divisions and promotion.", keywords: ["league", "season", "points", "division"] },
  { slug: "daily-cup", section: "club", title: "The Daily Cup", summary: "One run a day through a ladder of races.", keywords: ["cup", "daily", "run"] },
  { slug: "hall-and-trophies", section: "club", title: "Hall of Fame & Trophy Room", summary: "Legends, honours and the silverware on your shelves.", keywords: ["hall", "fame", "trophy", "honours", "legend"] },
  { slug: "glossary", section: "club", title: "Glossary", summary: "Racing and breeding words used in the game, in plain English.", keywords: ["words", "terms", "definitions"] },
];

export const sectionOf = (key: WikiSectionKey) => WIKI_SECTIONS.find((s) => s.key === key)!;
export const pageMeta = (slug: string) => WIKI_PAGES.find((p) => p.slug === slug);
export const pagesIn = (key: WikiSectionKey) => WIKI_PAGES.filter((p) => p.section === key);

/** Previous and next page in reading order. */
export function neighbours(slug: string): { prev: WikiPageMeta | null; next: WikiPageMeta | null } {
  const i = WIKI_PAGES.findIndex((p) => p.slug === slug);
  return { prev: i > 0 ? WIKI_PAGES[i - 1]! : null, next: i >= 0 && i < WIKI_PAGES.length - 1 ? WIKI_PAGES[i + 1]! : null };
}
