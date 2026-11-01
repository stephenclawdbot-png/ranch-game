/**
 * The identity set (dev harnesses and contact sheets only): eight horses of different breeds,
 * builds and manes, each a real foundation genome of its breed (game-core
 * generateFoundationGenome) with a chosen coat, so every view can be compared side by side. Their
 * build and hair come from their own genes (game-core buildOf / hairOf), never set by hand.
 */
import type { HorseAppearance, Silks } from "@thoroughbred/shared";
import * as gc from "@thoroughbred/game-core";

export interface IdentityHorse {
  name: string;
  breed: gc.Breed;
  seed: string;
  coat: Partial<gc.CoatGenes>;
  genes2?: Partial<gc.Genes2>;
  /** White alleles (face and leg markings). */
  white?: [number, number];
  starts?: number;
}

export const IDENTITY_HORSES: IdentityHorse[] = [
  { name: "Lamplighter", breed: "thoroughbred", seed: "identity-thoroughbred-7", coat: { extension: ["E", "E"], agouti: ["At", "a"], grey: ["n", "n"], cream: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"] }, white: [30, 30] },
  { name: "Steppe Gold", breed: "akhalTeke", seed: "identity-akhalTeke-26", coat: { extension: ["E", "e"], agouti: ["A", "A"], cream: ["Cr", "n"], grey: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"] }, white: [10, 10] },
  { name: "Brick Kiln", breed: "quarterHorse", seed: "identity-quarterHorse-5", coat: { extension: ["e", "e"], grey: ["n", "n"], cream: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"], liver: ["L", "L"] }, white: [85, 80] },
  { name: "Dark Mere", breed: "friesian", seed: "identity-friesian-8", coat: { extension: ["E", "E"], agouti: ["a", "a"], grey: ["n", "n"], cream: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"] }, genes2: { feather: ["fe", "fe"] }, white: [0, 0] },
  { name: "Seville Frost", breed: "andalusian", seed: "identity-andalusian-4", coat: { extension: ["E", "E"], agouti: ["a", "a"], grey: ["G", "n"], cream: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"] }, white: [20, 20], starts: 10 },
  { name: "Desert Star", breed: "arabian", seed: "identity-arabian-17", coat: { extension: ["e", "e"], grey: ["n", "n"], cream: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"] }, white: [70, 60] },
  { name: "Sagebrush", breed: "mustang", seed: "identity-mustang-14", coat: { extension: ["E", "E"], agouti: ["A", "a"], grey: ["n", "n"], cream: ["n", "n"], dun: ["D", "n"], roan: ["n", "n"] }, genes2: { tobiano: ["TO", "n"] }, white: [20, 10] },
  { name: "Spotted Owl", breed: "appaloosa", seed: "identity-appaloosa-21", coat: { extension: ["e", "e"], grey: ["n", "n"], cream: ["n", "n"], dun: ["n", "n"], roan: ["n", "n"] }, genes2: { leopard: ["LP", "n"], patn1: ["PATN1", "n"] }, white: [30, 20] },
];

export const IDENTITY_SILKS: Silks[] = [
  { primary: "#1f4d8a", secondary: "#f2d64b", cap: "#f2d64b", pattern: "hoops" },
  { primary: "#b0392e", secondary: "#f3e7c9", cap: "#b0392e", pattern: "sash" },
  { primary: "#2f6b3a", secondary: "#f3e7c9", cap: "#2f6b3a", pattern: "quartered" },
  { primary: "#6b2b8a", secondary: "#e0a030", cap: "#e0a030", pattern: "stars" },
  { primary: "#111111", secondary: "#e8e8e8", cap: "#e8e8e8", pattern: "stripes" },
  { primary: "#d06a20", secondary: "#203060", cap: "#203060", pattern: "diamonds" },
  { primary: "#f3e7c9", secondary: "#7a1f1f", cap: "#7a1f1f", pattern: "chevron" },
  { primary: "#3a8ab0", secondary: "#ffffff", cap: "#3a8ab0", pattern: "solid" },
];

/** The identity horse's genome (its breed's foundation genome with the chosen coat). */
export function identityGenome(h: IdentityHorse): gc.Genome {
  const g = gc.generateFoundationGenome(h.seed, { season: 1, breed: h.breed });
  return { ...g, coat: { ...g.coat, ...h.coat }, genes2: { ...g.genes2, ...(h.genes2 ?? {}) }, white: h.white ?? g.white };
}

/** The identity horse's look (adult, racing), with silks. */
export function identityAppearance(h: IdentityHorse, i: number): HorseAppearance {
  return gc.appearanceOf(identityGenome(h), { racingAge: true, starts: h.starts ?? 4, retired: false }, IDENTITY_SILKS[i % IDENTITY_SILKS.length]!);
}
