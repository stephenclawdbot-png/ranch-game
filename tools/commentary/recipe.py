"""
The POST TIME radio commentary voice: the approved "version 2" 1960s radio recipe as one shared
module, used by the phrase library (render_library.py), the horse-name clips (render_names.py,
run hourly by .github/workflows/commentary-names.yml) and the sample mixes (mix_samples.py).

Per clip:  Kokoro (open-source TTS, kokoro-onnx) at the intensity's speed
        -> trim the silence at both ends
        -> rubberband pitch (semitones), gain (dB)          [the per-line build-up]
        -> the radio chain: 300-3200 Hz band, gentle compressor, slow wow (vibrato),
           drive into a tanh soft clipper, a short slap echo, +3 dB, limiter at 0.89
        -> 22.05 kHz mono MP3 at 32 kbps (the radio band needs no more).
No loudness normalisation: the intensities keep their level differences, so the finish is
louder than the start. Hiss and crackle are a shared loop mixed under everything at playback.

Change anything here and RECIPE_VERSION must go up: name clips carry it, and the library's
manifest records it (re-render both; see docs/commentary.md).
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

RECIPE_VERSION = 1
CASTERS = ("bm_george", "bm_lewis", "bm_daniel")
INTENSITIES = ("calm", "building", "climax")
LANG = "en-gb"
KOKORO_SR = 24000
OUT_SR = 22050
OUT_BITRATE = "32k"

# Per intensity: Kokoro speed, pitch in semitones, gain in dB (the call3.py build-up:
# calm ~ the early race, building ~ round the turn, climax ~ the final furlong and the line).
INTENSITY = {
    "calm": {"speed": 1.04, "semi": 0.0, "gain": -1.0},
    "building": {"speed": 1.14, "semi": 1.0, "gain": 2.0},
    "climax": {"speed": 1.26, "semi": 2.5, "gain": 5.5},
}

# Trim both ends, soften the edges (no clicks), and lead in with 25 ms of silence so the
# filters and the limiter's look-ahead settle before the first word.
TRIM = (
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,"
    "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,afade=t=in:d=0.02,areverse,"
    "afade=t=in:d=0.012,adelay=25"
)
# The radio chain, as ffmpeg runs it on the approved mix:
#   highpass=f=300,lowpass=f=3200,acompressor=threshold=-12dB:ratio=2:attack=5:release=120,
#   vibrato=f=0.6:d=0.003,volume=1.5,asoftclip=type=tanh,aecho=0.9:0.9:18:0.1
# split around the vibrato, which runs in numpy here (ffmpeg's vibrato emits garbage samples at
# the start of a stream: a click on every short clip).
RADIO_PRE = "highpass=f=300,lowpass=f=3200,acompressor=threshold=-12dB:ratio=2:attack=5:release=120"
VIBRATO = {"f": 0.6, "d": 0.003}
RADIO_POST = "volume=1.5,asoftclip=type=tanh,aecho=0.9:0.9:18:0.1"
MASTER = "volume=3dB,alimiter=limit=0.89:level=disabled"


def text_for(text: str, intensity: str) -> str:
    """The text as the caster says it at this intensity: a climax line ends on a shout."""
    t = text.strip()
    if intensity == "climax" and t.endswith("."):
        t = t[:-1] + "!"
    return t


def name_text(name: str, intensity: str) -> str:
    """A horse name on its own: called plainly, then with rising excitement."""
    return name.strip() + ("." if intensity == "calm" else "!")


def clip_hash(text: str, caster: str, intensity: str) -> str:
    chain = f"{INTENSITY[intensity]}|{TRIM}|{RADIO_PRE}|{VIBRATO}|{RADIO_POST}|{MASTER}|{OUT_SR}|{OUT_BITRATE}"
    h = hashlib.sha256(f"{RECIPE_VERSION}|{caster}|{intensity}|{text}|{chain}".encode()).hexdigest()
    return h[:16]


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Voice:
    """Kokoro, one inference thread with spinning off (fast under load, safe in parallel)."""

    def __init__(self, model: str, voices: str, threads: int = 1):
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        so.add_session_config_entry("session.intra_op.allow_spinning", "0")
        session = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
        self.k = Kokoro.from_session(session, voices)

    def raw(self, text: str, caster: str, intensity: str) -> np.ndarray:
        a, sr = self.k.create(text, voice=caster, speed=INTENSITY[intensity]["speed"], lang=LANG)
        assert sr == KOKORO_SR
        return np.asarray(a, dtype=np.float32)

    def clip(self, text: str, caster: str, intensity: str, out_mp3: str) -> float:
        """Renders one clip to `out_mp3`; returns its duration in seconds."""
        audio = self.raw(text, caster, intensity)
        return process(audio, intensity, out_mp3)


def process(audio: np.ndarray, intensity: str, out_mp3: str) -> float:
    """Trim, pitch and gain for the intensity, then the radio chain; writes the MP3."""
    p = INTENSITY[intensity]
    ratio = 2 ** (p["semi"] / 12)
    with tempfile.TemporaryDirectory() as d:
        x = ffilter(audio, KOKORO_SR, f"{TRIM},rubberband=pitch={ratio:.4f},volume={p['gain']}dB", d)
        radio_encode(x, KOKORO_SR, out_mp3, d)
    return mp3_duration(out_mp3)


def ffilter(x: np.ndarray, sr: int, af: str, d: str) -> np.ndarray:
    """Runs an ffmpeg audio filter chain over float samples."""
    a, b = os.path.join(d, "ff-in.wav"), os.path.join(d, "ff-out.wav")
    sf.write(a, x.astype(np.float32), sr, subtype="FLOAT")
    _run(["ffmpeg", "-y", "-i", a, "-af", af, "-c:a", "pcm_f32le", b])
    out, _ = sf.read(b, dtype="float32")
    return out


def vibrato(x: np.ndarray, sr: int) -> np.ndarray:
    """A slow wow (ffmpeg vibrato's delay modulation: up to depth x 5 ms at f Hz)."""
    n = np.arange(len(x), dtype=np.float64)
    delay = VIBRATO["d"] * sr * 0.005 * (1 + np.sin(2 * np.pi * VIBRATO["f"] * n / sr))
    return np.interp(n - delay, n, x).astype(np.float32)


def radio_encode(x: np.ndarray, sr: int, out_mp3: str, d: str) -> None:
    """The radio chain (band, compressor, wow, drive, slap echo, limiter), then 22 kHz mono MP3."""
    y = vibrato(ffilter(x, sr, RADIO_PRE, d), sr)
    _encode(y, sr, out_mp3, d, f"{RADIO_POST},{MASTER}")


def mp3_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return round(float(out), 3)


# ---- beds: the crowd and the radio static (rendered once, shared by every caster) ----------

def _band(noise: np.ndarray, af: str, d: str, sr: int) -> np.ndarray:
    a, b = os.path.join(d, "n.wav"), os.path.join(d, "f.wav")
    sf.write(a, noise.astype(np.float32), sr)
    _run(["ffmpeg", "-y", "-i", a, "-af", af, b])
    out, _ = sf.read(b, dtype="float32")
    return out


def _loopable(x: np.ndarray, sr: int, fade: float = 0.5) -> np.ndarray:
    """Crossfades the tail into the head so the loop has no seam."""
    n = int(sr * fade)
    head, body, tail = x[:n], x[n:-n] if n else x, x[-n:]
    ramp = np.linspace(0, 1, n, dtype=np.float32)
    joined = tail * (1 - ramp) + head * ramp
    return np.concatenate([body, joined])


def render_beds(out_dir: str, seconds: float = 8.0) -> dict:
    """Crowd beds (murmur, building, roar, hush loops; a one-shot cheer) and the static loop."""
    sr = KOKORO_SR
    rng = np.random.default_rng(7)
    n = int(sr * (seconds + 0.5))
    beds = {}
    with tempfile.TemporaryDirectory() as d:

        def crowd(lo: int, hi: int, eq_gain: float, breathe_hz: float, depth: float, level: float) -> np.ndarray:
            x = _band(rng.standard_normal(n) * 0.2, f"highpass=f={lo},lowpass=f={hi},equalizer=f=900:t=q:w=1:g={eq_gain}", d, sr)
            step = max(1, int(sr / breathe_hz))
            pts = np.arange(0, n + step, step)
            env = np.interp(np.arange(n), pts, (1 - depth) + depth * rng.random(len(pts))).astype(np.float32)
            return x[:n] * env * level

        specs = {
            "murmur": crowd(250, 2000, 6, 3, 0.35, 1.0),
            "building": crowd(250, 2200, 6, 4, 0.30, 1.0),
            "roar": crowd(220, 2600, 7, 5, 0.25, 1.0),
            "hush": crowd(200, 1200, 3, 1.5, 0.6, 0.6),
        }
        for name, x in specs.items():
            x = _loopable(x, sr)
            path = os.path.join(out_dir, f"crowd-{name}.mp3")
            _write_bed(x, sr, path, d)
            beds[name] = {"file": f"crowd-{name}.mp3", "duration": mp3_duration(path), "loop": True}
        # The cheer after the line: a swell and a long fade, played once.
        m = int(sr * 5.0)
        x = _band(rng.standard_normal(m) * 0.2, "highpass=f=220,lowpass=f=2800,equalizer=f=1000:t=q:w=1:g=8", d, sr)
        t = np.linspace(0, 5.0, m, dtype=np.float32)
        env = np.minimum(1.0, t / 0.4) * np.exp(-np.maximum(0, t - 1.2) / 1.6)
        path = os.path.join(out_dir, "crowd-cheer.mp3")
        _write_bed(x[:m] * env * 1.3, sr, path, d)
        beds["cheer"] = {"file": "crowd-cheer.mp3", "duration": mp3_duration(path), "loop": False}
        # Radio static: faint pink hiss in the 400-3000 Hz band with sparse crackle.
        hp = os.path.join(d, "hiss.wav")
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"anoisesrc=color=pink:amplitude=0.008:seed=7:sample_rate={sr}:duration={n / sr:.3f}", "-af", "highpass=f=400,lowpass=f=3000,volume=3dB", hp])
        hiss, _ = sf.read(hp, dtype="float32")
        hiss = np.pad(hiss, (0, max(0, n - len(hiss))))[:n]
        crackle = np.zeros(n, dtype=np.float32)
        for _ in range(int(seconds * 3)):
            i = int(rng.integers(0, n - 40))
            crackle[i : i + 3] += rng.uniform(-0.05, 0.05)
        x = _loopable((hiss + crackle).astype(np.float32), sr)
        path = os.path.join(out_dir, "static.mp3")
        _encode(x, sr, path, d, "highpass=f=300,lowpass=f=3200")
        beds["static"] = {"file": "static.mp3", "duration": mp3_duration(path), "loop": True}
    return beds


def _write_bed(x: np.ndarray, sr: int, path: str, d: str) -> None:
    # The crowd goes through the same radio chain (the listener hears it through the set too).
    radio_encode(x, sr, path, d)


def _encode(x: np.ndarray, sr: int, path: str, d: str, af: str) -> None:
    src = os.path.join(d, "enc.wav")
    sf.write(src, x.astype(np.float32), sr, subtype="FLOAT")
    _run(["ffmpeg", "-y", "-i", src, "-af", f"{af},aresample={OUT_SR}", "-ac", "1", "-ar", str(OUT_SR), "-c:a", "libmp3lame", "-b:a", OUT_BITRATE, path])
