# Radio commentary

A spoken race call in the style of a 1960s radio broadcast: a British caster over a crowd that
swells with the race, through a narrow, slightly driven radio band with faint hiss and crackle.
Owner decisions (2026-10-31): the "version 2" sound, three casters with one per race, **off by
default** behind a "Radio" toggle on the race screen (remembered per browser), real excitement
on comebacks, duels and photo finishes, and no time-stretched shouting.

It costs nothing to run: every phrase is a small pre-rendered clip served as a static file, every
horse name is voiced once (by a free GitHub Actions job) and cached for good, and the browser
assembles the call itself. The servers do no audio work per race.

## How it works

```
race replay / live frames ──> buildVoicedRaceCall (race-viewer, pure)
                                 text line (unchanged)  +  speech: [phrase ids, horse names, numbers...] + intensity
                                                │
            phrase library (static MP3s) ───────┤
            name clips (/api/commentary/names) ─┤
                                                ▼
                         planSpeech + crowdCues (schedule.ts, pure)
                                                ▼
                         RadioPlayer (Web Audio, player.ts), synced to the race clock
```

1. **The call as tokens.** `packages/race-viewer/src/call/buildRaceCall.ts` already writes the
   text call from real race events, one forward pass over the frames. `buildVoicedRaceCall` runs
   the same pass and gives each line a `speech`: a sequence of clip ids (`voice/speech.ts`
   `SPOKEN`: a shorter, radio-shaped wording per beat) and slots (horse names, saddle-cloth
   numbers, margins, ordinals, courses, going, lanes), plus an **intensity**:
   - **calm**: the early race, routine position calls, an easy result;
   - **building**: the off, from 60% of the trip, the turn for home, moves and challenges;
   - **climax**: two or more horses within a length in the final furlong (a duel, shouted as
     "Quiet Riot! Silver Bramble! Quiet Riot! Silver Bramble!"), a late lead change, a comeback
     (a horse in the back half at halfway in the first two inside the last three furlongs; a
     three-place gain from the back half after 60% is called "But look at this!"), a photo, a
     close finish or a comeback winner, and the verdict of a photograph ("Here's the result of
     the photograph... First, number six, Silver Bramble! By a nose!");
   - an **easy winner** (clear by more than three lengths late) is capped at building and the
     result is read calmly.

   The text call is byte-identical (`buildRaceCall` is `buildVoicedRaceCall` without the speech;
   the snapshot tests hold it). Split times are not voiced. Deterministic: same race, same call.
2. **Phrase library.** Every clip id (`VOCABULARY`, 190 phrases including numbers 1-24 as
   "number six", ordinals, every margin, the six courses, going and lanes) x 3 casters x 3
   intensities = 1,710 MP3s under `apps/web/public/audio/commentary/<caster>/<intensity>/`, with
   `manifest.json` (durations, render hashes) and the shared beds in `beds/` (crowd murmur,
   building, roar, photo hush, a one-shot cheer, radio static).
3. **Names.** Each horse name is voiced once per caster and intensity and stored for good in the
   `commentary_names` table (bytea: a third smaller than base64 and served as is; keyed by the
   normalised name, never a race or horse id). Until a name has a clip the caster says the
   saddle-cloth number ("number six").
4. **Playback.** With the toggle on, the viewer fetches only this race's clips: the lines it
   holds (a replay: the whole call; live: the lines so far, as they arrive), the runners' names
   for this race's caster, and the beds. Every frame the player maps the speech plan onto the
   AudioContext clock: lines due in the next 0.25 s start on time; a seek, a restart or joining
   mid-race starts the line in progress part-way through; pause suspends the audio; a speed
   change resyncs. A line still talking delays the next by up to 1.6 s, a later routine line is
   dropped, and a key call (priority 75+: the final furlong, the finish, the photo, the result)
   cuts the previous line short (the opening order never is: its second half waits). Position lines are spoken shorter than the text (no fourth horse). The crowd bed follows the intensity, hushes after "Photograph!"
   until the verdict, cheers the winner, then settles. A fast limiter on the master keeps voice
   plus crowd from clipping. Loads never block the race: a clip not ready in time is skipped.
   Both views (Trackside and 3D) use the same clock, so both are covered.
5. **Speeds (owner choice taken here):** at 2x, 4x and 0.5x only the key calls (finish,
   photograph, result) are spoken, in real time from their start; the crowd keeps following the
   race. Back at 1x the call resyncs from the current line.
6. **Every race mode:** the toggle is part of `RaceViewer` itself, so Live, Story, career, Cup,
   feature and claiming races and their replays (`RaceExperience`), quick races (match, ghost,
   daily challenge: `QuickReplay`), what-if re-runs and Cup runs all have it. The caster is picked
   from the race id (or the quick race's id): `pickCaster` in `voice/casters.ts`, so every viewer
   of a race hears the same voice. Ghost runners are real horses: their names use the same clips.

### No spoilers

The call is built in the browser from the frames the client already holds, exactly like the
ticker: a live client has frames only up to the live edge and the call never reads
`replay.result`, so the spoken lines up to time T never change when more data arrives (tested
for the speech too). The phrase library is the same static files for every race, and a name clip
is keyed by the name alone: fetching either reveals nothing about any race. Nothing new is sent
before the off.

## The voice and the recipe

Open-source voice: **Kokoro** via the `kokoro-onnx` Python package (model files
`kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx GitHub release `model-files-v1.0`;
never committed). Casters `bm_george`, `bm_lewis`, `bm_daniel` (British English).

`tools/commentary/recipe.py` holds the approved "version 2" chain, shared by the library, the
names job and the samples: Kokoro at the intensity's speed, trim, rubberband pitch, gain, then
`highpass=300, lowpass=3200, acompressor (-12 dB, 2:1), vibrato 0.6 Hz, volume 1.5, tanh soft
clip, 18 ms slap echo, +3 dB, limiter 0.89`, 22.05 kHz mono MP3 at 32 kbps. No loudness
normalisation: calm, building and climax keep about 5 dB between them, and the crowd adds more,
so the finish is louder than the start. Hiss (pink noise, amplitude 0.008, 400-3000 Hz) and
sparse crackle are one shared loop. (ffmpeg's vibrato emits garbage samples at the start of a
stream, a click on every short clip, so the recipe runs the same delay modulation in numpy.)

Change the recipe (or `INTENSITY`) and bump `RECIPE_VERSION` in `recipe.py` **and**
`COMMENTARY_RECIPE` in `packages/db/src/services/commentary.ts`, then re-render the library and
let the job re-voice the names (old clips stop being served).

### Re-rendering the library

```sh
pip install -r tools/commentary/requirements.txt          # plus ffmpeg built with rubberband
# after editing SPOKEN in packages/race-viewer/src/call/voice/speech.ts:
npx vitest run --config tools/commentary/vitest.config.ts export     # writes tools/commentary/phrases.json
python3 tools/commentary/render_library.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin --jobs 3
```

Incremental: only clips whose text or recipe changed are rendered (about 2.5 s per clip per
core). `apps/web/src/components/race/commentary.test.ts` fails until `phrases.json` matches the
viewer's vocabulary and every phrase x caster x intensity has a clip.

### Sample calls

```sh
SAMPLES_DIR=/tmp/samples npx vitest run --config tools/commentary/vitest.config.ts samples
python3 tools/commentary/render_names.py --model ... --voices ... --names "$(cat /tmp/samples/names.txt)" --out /tmp/samples/names
SAMPLES_DIR=/tmp/samples npx vitest run --config tools/commentary/vitest.config.ts samples
python3 tools/commentary/mix_samples.py /tmp/samples /tmp/samples/out
```

Three real engine races (an easy win, a comeback, a photo finish), one per caster, mixed the way
the browser plays them; `tools/commentary/levels.py` prints the levels.

## Names: the GitHub job and the secrets to add

`.github/workflows/commentary-names.yml` runs every hour (at :23) and on demand. It installs
ffmpeg and kokoro-onnx, downloads and caches the Kokoro model files from the kokoro-onnx release,
asks the site for names without clips (`GET /api/commentary/names/missing`), renders each for
the casters missing it at the three intensities, and uploads them (`POST /api/commentary/names`).
Up to 150 names and 40 minutes per run. Horses that can race, and horses that raced in the last
30 days (ghost races replay them), most recently entered first.

**One-time setup by the owner** (until then the job skips itself with a warning and every horse
is called by its number):

1. Make a long random secret, e.g. run `openssl rand -hex 32` (or use a password manager).
2. **Vercel:** project `ranch-game` -> Settings -> Environment Variables -> add
   `COMMENTARY_UPLOAD_SECRET` with that value for Production (and Preview if wanted), then
   redeploy so it takes effect.
3. **GitHub:** the repository -> **Settings** -> **Secrets and variables** -> **Actions** ->
   **New repository secret**, twice:
   - Name `COMMENTARY_UPLOAD_SECRET`, Secret: the same value as on Vercel.
   - Name `POST_TIME_URL`, Secret: the site's address, e.g. `https://ranch-game.vercel.app`
     (no trailing slash).
4. **Actions** tab -> **Commentary names** -> **Run workflow** to voice the first batch now.
   (GitHub runs scheduled workflows from the default branch only, so the hourly runs start once
   this workflow is on `main`.)

The endpoints:

| Route | Auth | What |
|---|---|---|
| `GET /api/commentary/names/<recipe>/<caster>/<intensity>/<name key>` | public | The clip (audio/mpeg), `Cache-Control: public, max-age=31536000, immutable`; 204 No Content (cached 10 minutes) until voiced |
| `GET /api/commentary/names/missing?limit=N` | `Authorization: Bearer $COMMENTARY_UPLOAD_SECRET` | Names to voice, with the casters missing |
| `POST /api/commentary/names` | same | `{ name, caster, recipe, clips: { calm, building, climax } }` (base64 MP3) |

The secret is compared in constant time; without `COMMENTARY_UPLOAD_SECRET` set both answer 503.
Uploads are limited to 160 KB per request and 200 B - 32 KB per clip, must look like MP3, must
be the current recipe and a known caster, and must name a horse that exists.

## Sizes and costs

- **Library:** 1,710 phrase clips + 6 beds, about 8 MB in the repo, served as static files
  (cached a day by the browser and the CDN).
- **Per race:** a replay fetches its own clips only, typically 80-150 phrase clips plus the
  runners' names (about 4 KB each): roughly 0.5-0.8 MB, once, and cached.
- **Names:** about 12 KB per name per caster (three intensities), 36 KB per name for all three
  casters. 10,000 horses would be about 360 MB, so only horses that race are voiced.
- **Costs: zero.** Kokoro is open source and runs on GitHub's free Actions minutes. A public
  repository's are unlimited. On a private repository (2,000 free minutes a month on the Free
  plan) an idle hourly run stops after one request (billed as one minute: about 720 minutes a
  month), and voicing takes about 25 s per name for all three casters, so the free minutes also
  cover a few thousand new names a month. The clips are static files or one cached database
  read each; no paid API is called and no audio is generated per race.

## Files

| Path | What |
|---|---|
| `packages/race-viewer/src/call/voice/speech.ts` | Spoken templates, vocabulary, tokens, intensities |
| `packages/race-viewer/src/call/voice/casters.ts` | The casters and the per-race pick |
| `packages/race-viewer/src/call/voice/schedule.ts` | Speech plan, joining, crowd cues (pure, tested) |
| `packages/race-viewer/src/call/voice/library.ts` | Clip URLs, keys, the token resolver, mixer levels |
| `packages/race-viewer/src/call/voice/player.ts` | The Web Audio player |
| `packages/db/src/services/commentary.ts` | Name clip storage, missing names |
| `apps/web/src/server/commentary.ts` + `app/api/commentary/names/**` | The three routes |
| `tools/commentary/` | Recipe, library and name renderers, sample mixer, levels |
| `.github/workflows/commentary-names.yml` | The hourly names job |

Tunables are in [KNOBS §19](foundation/KNOBS.md#19-radio-commentary-new-2026-10-31).
