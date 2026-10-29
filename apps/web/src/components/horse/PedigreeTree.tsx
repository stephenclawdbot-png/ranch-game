"use client";

/**
 * Interactive pedigree (REDESIGN §4.6): the horse and three generations above it as a stud-book
 * bracket. Sires above, dams below; every ancestor is a link to its own page with its 3/4
 * portrait, registration number and record. Ancestors that appear more than once (the source of
 * inbreeding) carry a numbered badge, and hovering or focusing one lights up every copy.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { PedigreeNode } from "@/lib/types";
import { HorsePortrait } from "../HorsePortrait";

type Slot = { node: PedigreeNode | null; gen: number; row: number; span: number; role: "Sire" | "Dam" | null };

/** Deepest generation with a known ancestor (0 = foundation stock). */
function knownDepth(n: PedigreeNode | null, gen = 0): number {
  if (!n) return gen - 1;
  return Math.max(gen, knownDepth(n.sire, gen + 1), knownDepth(n.dam, gen + 1));
}

/** Bracket slots: generation g has 2^g slots, each spanning 2^depth / 2^g grid rows. */
function slots(root: PedigreeNode, depth: number): Slot[] {
  const out: Slot[] = [];
  const rows = 2 ** depth;
  const walk = (n: PedigreeNode | null, gen: number, index: number, role: Slot["role"]) => {
    const span = rows / 2 ** gen;
    out.push({ node: n, gen, row: index * span + 1, span, role });
    if (gen < depth) {
      walk(n?.sire ?? null, gen + 1, index * 2, "Sire");
      walk(n?.dam ?? null, gen + 1, index * 2 + 1, "Dam");
    }
  };
  walk(root, 0, 0, null);
  return out;
}

export function PedigreeTree({ root, coiText }: { root: PedigreeNode; coiText: string | null }) {
  // one generation of "Foundation stock" past the deepest known ancestor, three at most
  const depth = Math.min(3, Math.max(1, knownDepth(root) + 1));
  const all = useMemo(() => slots(root, depth), [root, depth]);
  const [hot, setHot] = useState<string | null>(null);
  // repeated ancestors (above the horse itself): numbered in the order they first appear
  const repeats = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of all) if (s.gen > 0 && s.node) count.set(s.node.id, (count.get(s.node.id) ?? 0) + 1);
    const ids = [...count].filter(([, n]) => n > 1).map(([id]) => id);
    return new Map(ids.map((id, i) => [id, i + 1]));
  }, [all]);
  const repeatNames = [...repeats.keys()].map((id) => all.find((s) => s.node?.id === id)!.node!.name);

  return (
    <div className="grid gap-3">
      <div className="ped-scroll">
        <ol
          className="ped-bracket"
          aria-label={`Pedigree of ${root.name}`}
          style={{ gridTemplateColumns: `repeat(${depth + 1}, minmax(200px, 1fr))`, gridTemplateRows: `repeat(${2 ** depth}, minmax(76px, auto))`, minWidth: depth === 3 ? 880 : depth === 2 ? 660 : undefined }}
        >
          {all.map((s, i) => {
            const n = s.node;
            const rep = n ? repeats.get(n.id) : undefined;
            const lit = !!n && hot === n.id;
            return (
              <li
                key={i}
                className={`ped-slot gen-${s.gen} ${s.role === "Dam" ? "is-dam" : s.role === "Sire" ? "is-sire" : ""} ${rep ? "is-repeat" : ""} ${lit ? "is-lit" : ""}`}
                style={{ gridColumn: s.gen + 1, gridRow: `${s.row} / span ${s.span}` }}
              >
                {n ? (
                  <Link
                    href={`/horse/${n.id}`}
                    className="ped-node"
                    onMouseEnter={() => setHot(n.id)}
                    onMouseLeave={() => setHot(null)}
                    onFocus={() => setHot(n.id)}
                    onBlur={() => setHot(null)}
                    aria-current={s.gen === 0 ? "page" : undefined}
                    data-testid={`ped-${s.gen}`}
                  >
                    <span className="ped-portrait">
                      <HorsePortrait appearance={n.appearance} scale="thumb" />
                    </span>
                    <span className="min-w-0">
                      <span className="ped-role">
                        {s.role ?? `Gen ${n.generation}`}
                        {rep && (
                          <b className="ped-rep" title={`Appears more than once in this pedigree`}>
                            {rep}
                          </b>
                        )}
                      </span>
                      <span className="ped-name">{n.name}</span>
                      <span className="ped-meta">
                        {n.regNo} · {n.starts ? `${n.wins}/${n.starts}` : "unraced"}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <span className="ped-node is-unknown">
                    <span className="ped-role">{s.role}</span>
                    <span className="ped-meta">Foundation stock</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="t-meta" data-testid="ped-summary">
        Inbreeding: <span className="font-extrabold text-cream">{coiText ?? "None"}</span>
        {repeatNames.length > 0 ? ` · repeated: ${repeatNames.join(", ")}` : " · no ancestor appears twice in three generations"}
      </p>
    </div>
  );
}
