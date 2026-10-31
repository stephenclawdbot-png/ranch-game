#!/usr/bin/env python3
"""
Levels of audio files (ffmpeg volumedetect): mean and max volume, duration; with --windows,
the mean volume of the first and last N seconds (the start vs finish of a race call).
  python3 tools/commentary/levels.py a.mp3 b.mp3 [--windows 10]
"""
import argparse
import re
import subprocess


def volume(path: str, start: float | None = None, dur: float | None = None) -> dict:
    cmd = ["ffmpeg", "-hide_banner"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-i", path, "-af", "volumedetect", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    out = {k: float(v) for k, v in re.findall(r"(mean_volume|max_volume): (-?[\d.]+|-inf) dB", err) if v != "-inf"}
    return out


def duration(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], capture_output=True, text=True).stdout
    return float(out.strip())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--windows", type=float, default=0)
    a = ap.parse_args()
    for f in a.files:
        d = duration(f)
        v = volume(f)
        line = f"{f}: {d:.1f}s mean {v.get('mean_volume')} dB max {v.get('max_volume')} dB"
        if a.windows:
            s = volume(f, 0, a.windows)
            e = volume(f, max(0, d - a.windows), a.windows)
            line += f" | first {a.windows:g}s mean {s.get('mean_volume')} max {s.get('max_volume')} | last {a.windows:g}s mean {e.get('mean_volume')} max {e.get('max_volume')}"
        print(line)


if __name__ == "__main__":
    main()
