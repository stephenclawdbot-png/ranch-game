"""Fit raceRating weights: Plackett-Luce (top-3) logit on tools/balance/out/fit-data.json.

    python3 tools/balance/fit_rating.py

Prints each feature's weight in "speed points" (the cruise coefficient is 1.05 mm/s per point), plus
how often the top-rated horse wins with the fitted and the current weights.
"""
import json
import pathlib
import numpy as np

rows = json.loads((pathlib.Path(__file__).parent / "out" / "fit-data.json").read_text())
names = ["cruise_mm_s", "drain_permille", "burst", "burst_x_(D-1600)/1000", "temperament", "durability"]
races = {}
for r in rows:
    races.setdefault(r["race"], []).append(r)
X = [np.array([e["f"] for e in rs], dtype=float) for rs in races.values()]
P = [np.array([e["pos"] for e in rs]) for rs in races.values()]
scale = np.array([100, 100, 100, 100, 100, 100], dtype=float)
Xs = [x / scale for x in X]


def nll_grad(w):
    nll = 0.0
    g = np.zeros_like(w)
    for x, p in zip(Xs, P):
        u = x @ w
        alive = np.ones(len(p), dtype=bool)
        for k in (1, 2, 3):
            i = int(np.where(p == k)[0][0])
            ua = u[alive]
            m = ua.max()
            ex = np.exp(ua - m)
            Z = ex.sum()
            nll -= u[i] - (m + np.log(Z))
            g -= x[i] - (ex[:, None] * x[alive]).sum(0) / Z
            alive[i] = False
    return nll, g


w = np.zeros(len(names))
lr = 0.5
for it in range(400):
    nll, g = nll_grad(w)
    w -= lr * g / len(Xs)
coef = w / scale
pts = coef / (coef[0] * 1.05)  # weight per unit, in speed points
print(f"NLL {nll:.1f}")
for n, c in zip(names, pts):
    print(f"{n:28s} {c:+.4f} speed points per unit")


def fav_rate(weights):
    hits = 0
    for x, p in zip(X, P):
        hits += p[int(np.argmax(x @ weights))] == 1
    return hits / len(X)


current = np.array([1 / 1.05, -0.75, 0.4 - 0.6 / 7, -1 / 7, 0.22, 0.0])  # burst weight at 1600 + slope
print(f"favourite wins: fitted {fav_rate(coef):.3f}, current weights {fav_rate(current):.3f}")
