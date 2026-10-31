#!/usr/bin/env python3
"""
Mixes the sample race calls (samples.report.ts plans) to MP3s the way the browser player
(race-viewer call/voice/player.ts) plays them at 1x: each clip at its planned race time, a
key call cutting the previous line, the crowd beds following the cues with the same gain
ramps, cheers, the radio static, and a limiter on the master. Then prints the levels: the
start of the race vs the finish, the peak, and the length against the race.

  python3 tools/commentary/mix_samples.py <samples dir> [<out dir>]
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from levels import volume  # noqa: E402

SR = 22050
PRE_ROLL = 6.0  # seconds of crowd before the off
TAIL = 6.0

_cache: dict[str, np.ndarray] = {}


def decode(path: str) -> np.ndarray:
    if path not in _cache:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], check=True, capture_output=True).stdout
        _cache[path] = np.frombuffer(raw, dtype=np.float32).copy()
    return _cache[path]


def mix(plan: dict, out_mp3: str) -> dict:
    t0 = -PRE_ROLL
    last = max([l["end"] for l in plan["lines"]] + [plan["raceEnd"]])
    n = int((last + TAIL - t0) * SR)
    idx = lambda t: int(round((t - t0) * SR))  # noqa: E731
    voice = np.zeros(n, np.float32)
    for line in plan["lines"]:
        stop = idx(line["cut"]) if line.get("cut") is not None else n
        for c in line["clips"]:
            a = decode(c["file"])
            s = idx(line["start"] + c["at"])
            e = min(n, s + len(a), stop)
            if e > s:
                voice[s:e] += a[: e - s]
    mixv = plan["mix"]
    # Crowd: the bed the cues name, with setTargetAtTime-style ramps (tau = fade / 3).
    cues = plan["cues"]
    t = t0 + np.arange(n) / SR
    crowd = np.zeros(n, np.float32)
    tau = mixv["crowdFadeSec"] / 3
    k = 1 - math.exp(-1 / (tau * SR))
    for bed in ("murmur", "building", "roar", "hush"):
        target = np.zeros(n, np.float32)
        cur = "murmur"
        bounds = [(c["at"], c["bed"]) for c in cues if c.get("bed")]
        seg_start = 0
        for at, b in bounds + [(1e9, None)]:
            i = max(0, min(n, idx(at))) if at > -1e8 else 0
            if i > seg_start:
                target[seg_start:i] = mixv["beds"][bed] if cur == bed else 0
            if b is not None:
                cur = b
            seg_start = max(seg_start, i)
        target[t < 0] *= mixv["preOffCrowd"]
        # one-pole smoothing, starting from silence like the player
        g = np.empty(n, np.float32)
        acc = 0.0
        for j in range(0, n, 64):  # per 64-sample block is plenty for a ramp
            acc += (float(target[j]) - acc) * (1 - (1 - k) ** 64)
            g[j : j + 64] = acc
        loop = decode(plan["beds"][bed])
        reps = int(math.ceil(n / len(loop)))
        crowd += np.tile(loop, reps)[:n] * g
    cheer = decode(plan["beds"]["cheer"])
    for c in cues:
        if c.get("cheer"):
            s = idx(c["at"])
            e = min(n, s + len(cheer))
            crowd[s:e] += cheer[: e - s] * mixv["cheer"]
    static = decode(plan["beds"]["static"])
    stat = np.tile(static, int(math.ceil(n / len(static))))[:n] * mixv["static"]
    out = voice * mixv["voice"] + crowd + stat
    wav = out_mp3[:-4] + ".wav"
    import soundfile as sf

    sf.write(wav, out.astype(np.float32), SR, subtype="FLOAT")
    # The player's master limiter (DynamicsCompressor at -2 dB, ratio 20).
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-af", "alimiter=limit=0.794:level=disabled:attack=2:release=120", "-ac", "1", "-ar", str(SR), "-c:a", "libmp3lame", "-b:a", "64k", out_mp3], check=True)
    os.remove(wav)
    off = -t0
    start = volume(out_mp3, off + 0.5, 12)
    finish = volume(out_mp3, off + plan["winnerSec"] - 10, 12)
    whole = volume(out_mp3)
    dur = n / SR
    return {"file": out_mp3, "duration": round(dur, 1), "race": round(plan["raceEnd"], 1), "winnerSec": round(plan["winnerSec"], 1), "start_mean": start.get("mean_volume"), "finish_mean": finish.get("mean_volume"), "max": whole.get("max_volume"), "mean": whole.get("mean_volume")}


def main() -> None:
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src
    os.makedirs(out, exist_ok=True)
    for kind in ("easy", "comeback", "photo"):
        p = os.path.join(src, f"plan-{kind}.json")
        if not os.path.exists(p):
            continue
        plan = json.load(open(p))
        name = f"{kind}-{plan['caster'].split('_')[1]}.mp3"
        r = mix(plan, os.path.join(out, name))
        with open(os.path.join(out, name[:-4] + ".txt"), "w") as f:
            f.write(f"{plan['kind']} - {plan['course']}, {plan['distanceM']} m, caster {plan['caster']}, winner {plan['winner']}\n")
            f.write(f"audio starts {PRE_ROLL:.0f} s before the off\n\n")
            f.write("\n".join(plan["text"]) + "\n")
        print(json.dumps(r))


if __name__ == "__main__":
    main()
