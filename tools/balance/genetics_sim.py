"""Milestone B proposal check: how fast does selective breeding raise the top end under a genetic ceiling?

    python3 tools/balance/genetics_sim.py

Model (per stat, 0-1000 scale, potentials not current stats):
  * Generation 0 (starters / packs / studio releases): horse quality ~ U(470, 580), stat = quality +
    archetype-like spread (+-120) + noise, every stat capped at LAUNCH_STAT_CAP, mean capped at
    LAUNCH_MEAN_CAP.
  * Foal stat = midparent + REGRESS * (POP_MEAN - midparent) + a whole-horse "nick" (triangular
    +-NICK, shared by all six stats) + per-stat triangular mutation (+-MUT), clamped to
    <= max(sire, dam) + OVER_PARENT and <= HARD_CAP.
  * Breeders keep the top SELECT fraction of each generation (by mean potential) and pair best with
    best; every horse can breed at most BREED_LIMIT times (one foal each).
Prints the best horse and the top-1% mean per generation, plus the generation where a horse first
reaches "A" (mean >= 750) and "S" (mean >= 850).
"""
import numpy as np

rng = np.random.default_rng(7)
N0 = 2000
LAUNCH_STAT_CAP, LAUNCH_MEAN_CAP = 700, 600
REGRESS, POP_MEAN = 0.05, 560
NICK, MUT, OVER_PARENT, HARD_CAP = 80, 40, 40, 1000
SELECT, BREED_LIMIT, GENS = 0.10, 4, 10

q = rng.uniform(470, 580, N0)[:, None]
pop = q + rng.uniform(-120, 120, (N0, 6)) + rng.integers(-70, 71, (N0, 6))
pop = np.clip(pop, 80, LAUNCH_STAT_CAP)
over = pop.mean(1) > LAUNCH_MEAN_CAP
pop[over] -= (pop[over].mean(1) - LAUNCH_MEAN_CAP)[:, None]


def tri(amp, shape):
    return (rng.uniform(-amp, amp, shape) + rng.uniform(-amp, amp, shape)) / 2


first = {}
print("gen  best-mean  top1%-mean  pop-mean  best-single-stat")
for g in range(GENS + 1):
    means = pop.mean(1)
    order = np.argsort(-means)
    top1 = means[order[: max(1, len(pop) // 100)]].mean()
    print(f"{g:3d}  {means[order[0]]:9.0f}  {top1:10.0f}  {means.mean():8.0f}  {pop.max():8.0f}")
    for label, thr in (("A (mean>=750)", 750), ("S (mean>=850)", 850)):
        if label not in first and means.max() >= thr:
            first[label] = g
    parents = pop[order[: int(len(pop) * SELECT)]]
    foals = []
    for i in range(0, len(parents) - 1, 2):
        s, d = parents[i], parents[i + 1]
        mid = (s + d) / 2
        for _ in range(BREED_LIMIT):
            f = mid + REGRESS * (POP_MEAN - mid) + tri(NICK, 1) + tri(MUT, 6)
            f = np.minimum(f, np.maximum(s, d) + OVER_PARENT)
            foals.append(np.clip(f, 80, HARD_CAP))
    # Next generation: the new foals plus the unselected population (they keep racing / breeding casually).
    pop = np.vstack([np.array(foals), pop[order[int(len(pop) * SELECT):]][: N0 - len(foals)]])
print("first generation reaching:", first)
