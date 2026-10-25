# Design Research: Game-First Web UX for Project Thoroughbred

> Status: research input for the full site redesign. Author: UX research lead. Date: 2026-10-25.
> Scope: management/sim UI, browser-game UX, game websites, pixel-art UI craft, mobile layout,
> race broadcast UX, retention/fairness, accessibility. It ends with a redesign spec and a
> "do now / later" list.
>
> How to read the sources: links are at the end of each section. Many game-design sources are
> reviews, community wikis or interviews rather than controlled studies, and this document says
> so where it matters. Where a recommendation comes from first-hand knowledge of a game rather
> than a cited source, it is marked *(observed)*.

---

## 0. Executive summary: the 18 principles, ranked

1. **The race is the product. Put it within 3 taps and 60 seconds of a first visit.** Zed Run's
   core loop was "pick entries, then watch the server decide", and analysts flagged the long
   path to that payoff and the onboarding friction as key weaknesses. Our first-session goal:
   a new player watches *their own* horse run inside 60 s. Today the path takes about 7 taps,
   2 forms and 3 pages.
2. **Every screen has one primary action, and it lives in the thumb zone.** A sticky action bar
   sits above the tab bar: *Race Lucky Mirage*, *Watch live*, *Collect*. Hoober observed 49% of
   people using phones one-handed, and the easy-reach zone is the bottom third of the screen.
3. **Overview first, detail on demand, never more than 2 levels deep.** FM26 promised "tile and
   card" efficiency and shipped "too many clicks". NN/g finds that more than 2 disclosure levels
   "typically have low usability". The roster is a dense list, the horse is a card, and stats
   expand in place.
4. **Explain every result.** Sid Meier's GDC talk showed that players read lost favourable odds
   as unfairness. After every race, show *why*: trip fit, surface/going fit, pace and tactic
   matchup, sectionals. Fairness is felt through explanation more than through hashes.
5. **HD-2D means pixel worlds with crisp, readable text.** Keep pixel art for the world,
   portraits, icons and frames. Use pixel fonts only for display text (titles, big numbers,
   scoreboard). Everything you have to *read* (body, stats, tables, labels) uses a legible sans
   at 14–16 px or more. Today we load **4 pixel faces** and set the caps-only Silkscreen at
   10 px, which is off its 8 px grid.
6. **One pixel density per plane.** No mixels. Portraits, icons, frames and scene art each need
   an integer scale relationship to a shared "art pixel" (`--u`). Today a portrait pixel covers
   about 10 screen px while icons cover about 2 px, in the same card.
7. **Brass means "act" or "yours". Nothing else is brass.** Today brass is on every panel
   border, every nav state, chips, countdowns and CTAs, so nothing stands out. Use three
   surface tiers, and give a screen at most one brass-framed hero.
8. **Broadcast grammar for the race:** a running-order strip (saddlecloth "chiclets"),
   distance-to-go, a clock, your horse always locatable, and director-style cuts timed to the
   tension curve. NBC's director describes the job as "defining views of critical moments".
9. **Make the pre-race 10 seconds work.** Use them for the parade/paddock: your horse's fit
   check, odds-free "pundit marks" and gate loading. Preload the race assets in the same window.
10. **Results are a staged reveal, not a table dump.** Finish, then photo (if close), then a
    podium plus your horse, then rewards (counters), then the "why" analysis, then the next
    action. Show the full table on demand.
11. **Daily ritual without dark patterns:** one shared-seed "Daily Cup" per day (Wordle,
    Spelunky daily). One entry, a shareable result card, no punitive streaks, no withering.
12. **Respect time: sessions of 3–8 minutes with a natural stopping point.** Wordle aimed at
    "three minutes a day". Kairosoft keeps each decision turn around 5 minutes. End sessions
    with a "come back for…" hook, not a guilt trip.
13. **Welcome-back recap before anything else.** Show what happened while you were away
    (results, credits, horse condition), then the single next best action. Never open with an
    offer.
14. **Fairness proof is a quiet seal, not a casino banner.** "Provably fair" is crypto-casino
    language and wrong for a no-gambling game. Show a small *Sealed ✓* badge. Plain-language
    steps and hashes sit one tap away, and *Verified ✓* appears after the finish.
15. **Colour is never the only cue.** Saddlecloth numbers plus silks pattern plus position
    number. Your horse gets a brass caret and a "YOU" tag. Text contrast at least 4.5:1, UI
    boundaries at least 3:1.
16. **Motion is earned and one-shot.** No infinite bobbing or tilt on list items. Celebrations
    scale with significance and can be skipped. A full `prefers-reduced-motion` path includes a
    static-camera race and a text-only "radio" race mode.
17. **Wallet and token stay invisible until wanted.** Surveys show strong gamer hostility to
    NFTs. Zed Run's horses did not survive its relaunch. Nothing on the core path mentions
    crypto: no paid randomness and no entry-fee prize pools in a token.
18. **Fast on a mid-range phone.** Non-race routes stay under about 150 KB of JS (gzip). Lazy-load
    Three.js only on `/race`. Adapt quality and hold 60 fps, falling back to 30. Pause rendering
    in hidden tabs. Core Web Vitals targets: LCP ≤ 2.5 s, INP ≤ 200 ms.

---

## 1. Current-state audit (what the redesign must fix)

Grounded in `apps/web/app/**`, `apps/web/src/components/**`, `apps/web/app/globals.css`, the
viewer HUD (`packages/race-viewer/src/hud`) and the 20 screenshots in `scratchpad/design/`.

**What's good and should be kept**
- The racing-club palette, the crest and the "membership application" framing for onboarding
  all have personality. The suggested stable name and the dice button are good low-friction
  touches.
- Panels are a real 9-slice system (`border-image` with a shared `--u` art unit), so the
  craft foundation is right.
- The race is deterministic and synced to post time, with a seed commitment. That makes
  shared-seed dailies, replays and share links essentially free.
- Saddlecloth numbers are already coloured by post position, and there are camera modes
  (Leader / My horse / Wide), a commentary ticker, and a PHOTO stamp. These are the right
  primitives.
- Focus-visible outlines exist. Most text-on-surface pairs pass contrast: cream on racing
  green is 12.5:1 and brass on green is 6.8:1.

**Biggest problems, by severity**

| # | Problem | Evidence | Fix (see §11) |
|---|---|---|---|
| P1 | **Time to first own race is too long.** Register (3-step form, 48 colour swatches), then the welcome page (6 horses at once), then "Walk into the stable", then find "Race", then the Races page (choose runner, choose riding plan), then Enter, then a 10 s countdown. That is about 7 taps across 4 screens, and the player has to make two decisions they cannot judge yet. | `play/page.tsx`, `QuickRacePanel.tsx`, mobile-play.png | One-tap register with pre-rolled name and silks. Then "Your first race is ready: Lucky Mirage, front-runner, 1,000 m turf" with a single **Race now** button. The tactic is preselected to the horse's natural style. |
| P2 | **The home page's primary CTA is spectating someone else's race.** "Watch live" on an NPC handicap outranks *your* stable for a returning player. "Paddock" is also the wrong name for home: in racing, the paddock is the pre-parade ring. | `app/page.tsx`, mobile-paddock.png | The home page leads with "your next action" (race, result to watch, horse to tend). Live spectating is secondary. Rename the tab to Home (or "Yard"). |
| P3 | **No visual hierarchy: everything is a brass-bordered panel.** Every block, chip, nav tab and CTA uses brass or a framed panel, the backgrounds are dithered, and icons bob. The eye has no resting place. This is "frame fatigue". | all screenshots | Three surface tiers, brass reserved for action/"yours", at most one hero frame per screen. |
| P4 | **Typography soup and illegible micro-text.** Five web fonts (Pixelify Sans, Silkscreen, VT323, Jersey 10, Nunito). Silkscreen is used at 8/9/10 px for eyebrows and labels, but it is designed for 8 px multiples with anti-aliasing off. Body text is 15 px. Labels are all caps with wide tracking. | `layout.tsx`, `globals.css` (`.eyebrow`, `.label` 10 px), 21 uses of 8–10 px or `text-xs` | Cut to 3 faces. Pixel display ≥ 24 px only. Body 16 px. Labels in sans at 12–13 px semibold, sentence or small caps. |
| P5 | **Stable page is 8,300 px tall on mobile.** Six full cards, each with a large portrait, 6 stat bars and a record, with the "Race" button at the very bottom of each card. You cannot compare horses. | mobile-stable.png | A dense roster list (FM-style squad table), sortable, with one row per horse and a thumbnail, fit chips and a Race action. Cards only on the detail page. |
| P6 | **Mixed pixel densities.** Portrait pixels about 10 screen px, scene hero about 3–4 px, icons about 2 px, silks about 4 px, all side by side. The portraits are one bust pose recoloured, scaled huge. | mobile-stable/horse/welcome.png | Lock a UI art scale (e.g. 2× or 3× of `--u`) and author portraits at 64 or 96 px native, shown at the same multiple as icons. |
| P7 | **Race page on a phone: the stage is small and starts below the fold area.** The header plus chips use about 300 px before the stage. The race name appears 3 times (page H1, LED plate, in-canvas HUD title). The standings ribbon shows only about 2 horses. The field list and a large "Provably Fair" panel with a raw hash dominate the page. | mobile-race-live.png, desktop-race-live.png, `RaceExperience.tsx`, `Hud.tsx` | Stage first and full-bleed. The race title collapses into the stage plate. A chiclet running-order strip under the stage. A landscape "theatre" mode. Fairness becomes a badge plus a sheet. |
| P8 | **Results are duplicated and flat.** An in-canvas results overlay, a page results table, and a settlement banner above the stage all show at once. There is no "why" analysis and no staged reward moment, so "+216 credits" is just text. | desktop-race-result.png | Staged results sequence (§11.8) with counter roll-ups, a form/analysis card and next actions. |
| P9 | **Stat presentation encodes everything three times** (letter grade + number + 20-segment bar), with grade colours that form a rainbow (pink S, yellow A, green B, blue C…). Tiles truncate on mobile ("Fron…", "1,000…", "Foundation st…"). There is no link between stats and today's race. | mobile-horse.png, `StatBars.tsx` | Grade letter plus bar on the list. Exact numbers only on detail. A neutral grade ramp. Add *suitability* (A–E per trip, surface, going, style) as the key decision aid, as Umamusume does with aptitudes. |
| P10 | **Perpetual motion.** Bobbing active-tab icons, tilt and parallax on every horse card, sheen sweeps, infinite confetti loop. | `SiteNav.tsx`, `HorseCard.tsx`, `useTilt` (29 uses of bob/tilt/sheen) | One-shot, event-driven motion only. Remove tilt from lists. Respect reduced motion everywhere. |
| P11 | **Nav uses the same filled-brass button style as primary CTAs.** On mobile the active tab is a brass button identical to "Watch live", and the tab bar is 3 chunky buttons about 58 px tall plus a trim. | `SiteNav.tsx` | Flat tab bar: icon plus label, brass icon and notch for the active tab, 56 px plus safe area. |
| P12 | **Fairness copy is casino-coded and front-loaded.** "Provably Fair" plus a 64-char hash shows pre-race on every race page. | `FairnessPanel.tsx` | §8 fairness pattern. |
| P13 | **Persistence is invisible.** The player lives in `localStorage` with no warning that clearing the browser loses the stable. | `lib/player.ts` | After the first win, a gentle "Save your stable" (passkey or email link). Never before the first race. |

*(The black "N" circle in screenshots is the Next.js dev indicator, so it is not a design
issue. The mobile tab bar appearing mid-page is a full-page screenshot artefact of
`position: fixed`.)*

---

## 2. Management / sim game UI

### 2.1 Patterns worth stealing

- **Hub, card, detail with layered information (Football Manager).** FM26's stated principles
  were *efficiency* (fewer clicks), *familiarity* and *predictability*. Overview screens give
  "key general information early and often" and tiles open into cards for detail. A global
  search plus "FMPedia" glossary, and user bookmarks (6 preset, 24 total), let experts jump
  straight to a screen. **The cautionary half is the more important part:** the launch was
  widely panned as "clunky", with "too many clicks", visual noise and a lack of flow. Miles
  Jacobson admitted the front end "just wasn't fun", and SI's designer said the tile system
  "created more issues than expected regarding usability and accessibility". **Lesson:** tiles
  and cards are fine for *overview*, but the *frequent* tasks (roster comparison, entering a
  race) need dense, direct, one-screen UIs. Count taps for the top 5 tasks and keep each at 3
  or fewer.
- **One "Continue" verb drives the loop (FM)** *(observed)*. FM's persistent Continue button in
  the top bar advances time and surfaces the next decision. Our equivalent is a persistent
  primary action bar whose label is the next best action: "Race Sable Verdict", "Watch your
  race (0:42)", "See result".
- **Short decision turns with hidden depth (Kairosoft, Game Dev Story).** Reviewers describe a
  loop that is "fast, rewarding, and easy to repeat". Each turn's decisions take about 5 real
  minutes. Strategic depth is layered *on top of* the basic loop rather than added as extra
  steps. Attachment to named staff raises the stakes. **Lesson:** a quick race should take
  about 1 minute of decisions plus about 1 minute of watching. Depth (training, breeding)
  lives beside it, not in front of it.
- **Calendar, goals and aptitude (Umamusume Pretty Derby).** The career screen shows the current
  turn as a date, a *goal box* ("current goal" plus a calendar icon with turns remaining), an
  energy bar and a mood indicator, and five stats at the bottom. Race lists flag races as
  **recommended** based on the trainee's *track and distance aptitude* *(observed: aptitudes are
  letter grades per surface, distance band and running style)*. The pre-race screen shows your
  runner and the field's stats and skills, and the only input is changing running style. The
  camera's "dynamic" mode starts wide at the gates and "switches between the foremost
  contenders" in the last spurt. **Lessons:** (a) letter-grade *aptitudes* tied to race
  conditions are the most useful stat view for a horse game; (b) always show the next goal and
  how far away it is; (c) recommend races, don't make players filter.
- **Watch, don't control (Derby Stallion).** Creator Hiroyuki Sonobe deliberately did not
  make the game "mainly about statistics": players don't control horses during races and
  enjoy *watching* computer-controlled races "like a baseball game". He cites the cinematic,
  play-by-play style of *Captain Tsubasa* as an inspiration. That is our model too: the
  management happens before the race, and the race is drama.
- **Race HUD plus pit-wall decisions (Motorsport Manager).** A tilt-shift 3D race view (very
  close to our HD-2D look) with a 2D fallback mode for low-end machines, and a minimalist UI
  that "swishes about with playful animations". Players asked for a bigger position tracker
  and more overlays. **Lessons:** ship a low-power 2D/"radio" race mode, and make the
  running order prominent.
- **Readable at a distance, compact, sub-menus for detail (Two Point Hospital).** Praised as
  compact with detail in sub-menus, but criticised on console for "tiny font-itis" and no
  text scaling. **Lesson:** a text-size setting is cheap and expected.
- **Stardew Valley.** UI scale and world zoom are separate settings, and players still find the
  stack counts too small even at max UI scale. **Lesson:** numbers on icons (counts, grades)
  need their own minimum size, not just whatever the art scale gives them.
- **Pokémon party and summary** *(observed)*. A party list where each row shows sprite, name,
  level and an HP bar (state at a glance), then a multi-page summary with stats. Six slots are
  a natural roster size. **Lesson:** our six-horse string fits one phone screen as rows, so
  don't paginate cards.
- **HD-2D UI (Octopath Traveler I/II, Triangle Strategy, DQ III HD-2D)** *(observed)*. HD-2D is
  defined by pixel sprites in a 3D world with lighting, depth of field and tilt-shift. The *UI*
  in these games is generally crisp and high-resolution: smooth typography and thin ornamental
  frames over semi-transparent dark plates, *not* pixel fonts. Triangle Strategy's UI drew
  criticism ("irritating" menus). Demo players couldn't tell blue "safe" tiles from purple
  "danger" tiles, and sprites lacked contrast against detailed backgrounds. **Lesson:** our
  silks, markers and overlays must read against a busy, DOF-blurred grandstand. Use plates,
  outlines and shape cues.

### 2.2 Horse-racing specific

- **Rival Stars Horse Racing (PikPok):** the most polished mainstream horse game. Everything
  except racing happens through the UI. The first minutes are praised as "well tutorialized and
  easy to grasp". Training timers of 5 minutes to 4 hours "pull you away", which some players
  like. Breeding uses real genetics. **Lessons:** gorgeous horses carry a lot; timers are
  acceptable when framed as rest rather than gates.
- **Horse Racing Manager (Steam, solo dev, pixel art):** pitched as "Football Manager meets
  Starters Orders". 87–88% positive, but the UI "feels clunky" and "more like a website or
  software". It is described as slow and not for casual players. **Lesson:** this is exactly our
  risk. Pixel art on the outside, spreadsheets on the inside. The sim depth must be presented
  with game feel.
- **Zed Run (web3, 2019–2025):** see §8.4 for the full teardown.

Sources: [FM26 UI](https://www.footballmanager.com/features/total-football-total-control-fm26s-reimagined-user-interface),
[Inven interview](https://www.invenglobal.com/articles/23673/fm26-developer-why-we-had-to-change-the-ui),
[FM26 damage control](https://fmslovakia.com/from-new-era-to-damage-control/),
[FRVR on FM26 launch](https://frvr.com/blog/news/football-manager-26-is-already-one-of-the-worst-games-ever-rated-on-steam-following-its-truly-disastrous-launch),
[PC Gamer on Kairosoft](https://www.pcgamer.com/uk/game-dev-story-leads-kairosofts-irresistible-sim-lite-games-onto-steam),
[Game Developer: Game Dev Story](https://www.gamedeveloper.com/game-platforms/analysis-narrative-exoskeletons-i-game-dev-story-i-),
[Umamusume wiki: Career Mode](https://umamusu.wiki/Game:Career_Mode),
[Goonhammer: Umamusume](https://www.goonhammer.com/getting-started-how-to-understand-career-mode-in-umamusume-pretty-derby),
[Umamusume camera modes](https://deltiasgaming.com/?p=300925),
[Derby Stallion](https://en.wikipedia.org/wiki/Derby_Stallion),
[Motorsport Manager 2D mode](https://gamingonlinux.com/2016/12/motorsport-manager-updated-with-a-2d-race-mode-for-lower-end-computers),
[Empire: Two Point Hospital](https://empireonline.com/gaming/reviews/two-point-hospital),
[Stardew UI scale thread](https://steamcommunity.com/app/413150/discussions/0/5283252978685636205),
[HD-2D](https://en.wikipedia.org/wiki/HD-2D),
[Unreal: Octopath HD-2D](https://www.unrealengine.com/spotlights/octopath-traveler-s-hd-2d-art-style-and-story-make-for-a-jrpg-dream-come-true),
[Tom's Guide: Triangle Strategy](https://www.tomsguide.com/reviews/triangle-strategy),
[RPGFan demo impressions](https://www.rpgfan.com/2021/02/20/project-triangle-strategy-demo-impressions/),
[Rival Stars review](https://themanequest.com/blog/2020/6/21/review-rival-stars-horse-racing-desktop-edition-gorgeous-graphics-and-forgivable-flaws),
[Rival Stars iOS review](https://equineonthemind.com/quite-possibly-the-best-horse-game-a-rival-stars-horse-racing-review-ios-version/),
[Horse Racing Manager preview](https://www.themanequest.com/blog/2024/3/31/game-announcement-horse-racing-manager-a-2d-horse-racing-simulation-game),
[Horse Racing Manager reviews](https://gamegeeker.com/games/horse-racing-manager-2740170),
[Game UI Database](https://www.gameuidatabase.com/about.php) (a reference library to browse by genre for any screen type below).

---

## 3. Web / browser game UX

### 3.1 Patterns

- **Play before paperwork.** A publisher's split test of "play first, register later" cut
  bounce sharply and got more people through the opening scenes. Raw sign-ups fell, but the
  register-first accounts were largely low quality. Roblox's onboarding guidance boils down
  to three goals: teach the essentials, "get to the fun quickly", and leave players wanting
  more. End onboarding with a designed "moment of joy". Unity notes that every game, good or
  bad, suffers its biggest loss on Day 1. Lichess lets you play anonymously and makes quick
  pairing the first thing you see. **For us:** a visitor can watch a live race with zero setup
  (we already do this). Founding a stable is one tap. An account and wallet come only after
  value.
- **Daily scarcity and shareability (Wordle).** One puzzle a day was deliberate: it created
  anticipation. Wardle wanted "three minutes a day", with no notifications, ads or pop-ups. The
  emoji share grid packs "a huge amount of information and drama" into a tiny graphic, and
  everyone solving the *same* puzzle builds community. **Spelunky's Daily Challenge** works the
  same way: one shared seed, one attempt, its own leaderboard, and randomness that could skew
  results (gambling wheels) locked off. **For us:** the deterministic, seeded engine makes a
  *Daily Cup* trivial. Everyone gets the same conditions and enters one horse with one plan;
  ranks are compared; the result card is shareable.
- **Daily allotments with rollover (Kingdom of Loathing).** 40 adventures per day, banked up to
  a cap of 200, and "rollover" as a shared daily event. A daily *allotment* respects time
  better than an energy bar that nags. **For us (later):** "training sessions" that refill
  daily, can be banked up to about 3 days, and are never lost on a missed day.
- **Long-lived pet and breeding sites (Neopets, Flight Rising).** Players stay for *collection,
  expertise and community*. Neopets' revival leans on nostalgia, consistency and "feeling like
  a competent expert". Flight Rising's economy is player-driven, and fan breeding *calculators*
  show demand for predictable genetics previews. Flight Rising's responsive rewrite removes the
  sidebars on phones and moves navigation into large bottom buttons. It keeps feature parity
  across layouts, lets players force desktop or mobile view, and converts the site page by page
  over more than a year. Neopets' mobile beta existed because the desktop site needed "a lot of
  zooming and quick tapping" on phones. **For us:** genetics *previews* (offspring ranges) are a
  must for the breeding milestone. Design mobile-first now so we never need that rewrite.
- **Persistent text-world MMOs (Torn).** Players watch regenerating meters (energy, nerve)
  closely enough to write HUD userscripts for cooldowns. **Lesson:** if we add regenerating
  resources, show *when they're full* (a clock time, not just a bar) so players can plan
  visits.
- **Farmville-era appointment mechanics: avoid.** Withering crops were widely read as
  "designed to force you to check up on your farms". Zynga's own VP framed timed crops as
  schedule-fitting and chose "animals run away" over animals dying. **For us:** no decay as a
  punishment for absence. Horses rest; they don't wilt.

### 3.2 Notifications without push

| Channel | When | Notes |
|---|---|---|
| Tab title plus favicon badge | Race starting, result ready | `(1) Off in 0:09 · Thoroughbred`. Favicon dot via canvas. Trello and Facebook use this pattern. No permission needed. |
| In-app toasts | User is on another route when their race goes off | "Your race is off. Watch ›" (sticky until dismissed). |
| Add to Calendar (.ics) | Scheduled feature races (later) | Zero-permission "appointment". |
| Web Push | Only after install (PWA) and only after an explicit tap | iOS supports web push **only for Home Screen web apps** (iOS 16.4+). The permission prompt must follow a user gesture. Never prompt on first visit. |
| Email digest | Opt-in, weekly | "Your stable this week". Later, with accounts. |

Sources: [Roblox onboarding](https://create.roblox.com/docs/production/game-design/onboarding),
[Unity retention](https://unity.com/how-to/improve-retention-every-stage-player-lifecycle),
[guest-play split test](https://www.tribality.com/?p=36084),
[Lichess anonymous play](https://lichess.org/forum/lichess-feedback/how-to-change-preferences-when-playing-without-an-account),
[Northeastern on Wordle](https://news.northeastern.edu/2022/01/21/what-makes-wordle-so-g-r-e-a-t/),
[Wardle on Wordle](https://www.thumbsticks.com/wardle-on-wordle-simple-word-game-global-phenomenon/),
[Spelunky Daily Challenge](https://spelunky.fandom.com/wiki/Daily_Challenge_Mode_(HD)),
[Kingdom of Loathing](https://en.wikipedia.org/wiki/Kingdom_of_Loathing),
[Neopets revival](https://www.screenhub.com.au/news/features/neopets-revival-sxsw-sydney-2025-2683434/),
[Neopets mobile beta](https://thedailyneopets.com/articles/mobile-site),
[Flight Rising responsive plan](https://www1.flightrising.com/forums/ann/3462249),
[Flight Rising review](https://www.virtualpetlist.com/threads/flight-rising-review.686/),
[Torn](https://www.torn.com/about),
[Torn cooldown script](https://greasyfork.org/cs/scripts/584904-torn-cooldown-tracker),
[Engadget on FarmVille withering](https://www.engadget.com/2010-03-22-the-fringe-farming-games.html),
[Skaggs on time-based gameplay](https://www.aol.com/amphtml/2010-06-01-farmville-vp-of-product-development-mark-skaggs-on-time-based-ga.html),
[Tab/favicon notifications](https://webdesign.tutsplus.com/how-to-display-update-notifications-in-the-browser-tab--cms-23458t),
[WebKit: Web Push on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[9to5Mac iOS 16.4 web apps](https://9to5mac.com/2023/02/16/iphone-web-app-new-features-ios-16-4/).

---

## 4. Game websites and landing patterns, done "game-first"

The user explicitly does **not** want a marketing page in front of the game. What transfers
from store pages:

- **Steam page conventions** (Zukowski via Unity and presskit.gg): say *what kind of game this
  is* at a glance; capsule art readable at tiny sizes (about 120×45); lead screenshots with
  *core gameplay, not title screens*; name the genre early in the short description.
- **itch.io:** a playable-in-browser build is the highest-leverage page change (one guide claims
  about 3× engagement, an unverified analyst figure). The "Run game" embed sits at the top.
  Covers must survive a centre crop.
- **Game-first sites (Lichess, Wordle, .io games):** the *game surface is the homepage*. The
  first viewport contains the playable or watchable thing plus one verb.

**Our pattern, "the live race is the landing page":**
- **Signed-out `/`:** the top half is the *actual next live race* (a countdown, then the live
  stage) as an embedded watch surface. Below it: **Found your stable (free, 10 seconds)** as
  the single CTA, then a 3-tile "what you do" strip (Own · Train · Race) made of real UI
  screenshots or real components, then recent results as social proof. No hero copy longer
  than 12 words. No "Connect wallet".
- **Signed-in `/`:** the stable hub (§11.10). The marketing strip disappears.
- **Share surfaces:** `/race/[id]` and `/horse/[id]` are public, with OG images (silks, horse
  portrait, result). Every shared link drops the visitor into a *watchable replay*, which is the
  real landing page.
- **Meta and branding:** the title format `Race name · Thoroughbred`. An OG image per race
  result ("Saint Hilda 1st by a neck · Wrenfield Stayers' Handicap"). A press-kit page at
  `/about` (later), linked from the footer only.

Sources: [Unity: Zukowski interview](https://unity.com/blog/tips-strategies-for-marketing-indie-games),
[presskit.gg Steam guide](https://presskit.gg/field-guides/steam-page-optimization-guide),
[itch.io launch guide](https://app.cinevva.com/guides/itch-io-launch-guide),
[Lichess forum on quick pairing](https://lichess.org/forum/general-chess-discussion/is-there-a-tutorial-on-how-to-use-lichess?page=2),
[homepage lobbies](https://marvelsnapzone.com/how-homepage-game-lobbies-shape-first-impressions-for-players/).

---

## 5. Pixel-art UI craft

### 5.1 Rules

1. **One art-pixel unit (`--u`) per plane, integer multiples only.** Mixels (pixels on
   different grids) "look messy" and break pixel-art convention. They usually come from scaling
   art up in-game. The fix is to pick one resolution and redraw rather than scale. For the web,
   that means a UI art scale of **2× on phones and 3× on desktop**, applied to all frames,
   icons, silks and portraits in a given screen. Portraits authored at 64×64 native show at
   128 or 192 px, the same scale as icons. A big hero portrait may use the scene scale, but
   never inside a card next to 2× icons.
2. **Fractional devicePixelRatio breaks integer scaling.** At DPR 1.75, a 22 px element lands
   on 38.5 device px and softens. Snap rendered sizes to whole device pixels (use
   `devicePixelContentBox` for canvases) and keep `image-rendering: pixelated`.
3. **9-slice frames via `border-image`** (we already do this). Use `round` or `repeat` for
   patterned edges, never `stretch` on detailed edges. Keep corner slices at least 4 art px so
   rounding reads at 2×. Make three frame weights: *hero* (ornate brass, one per screen),
   *panel* (ink plus a green bevel), *inset* (sunken, for inputs and wells).
4. **Pixel fonts at their native grid only.** Silkscreen "should be used at 8pt multiples (8, 16,
   24…) with anti-aliasing turned off". Most of its glyphs are 4×5 px. Bitmap fonts "need fixed
   1:1 mapping to be pixel perfect". Fractional scales thicken every 5th row. Font authors report
   capitals and digits being "hard to read" until redesigned. **Rule:** pixel faces only for
   display (≥ 24 px) and big numerals. Small and body text uses a vector sans.
5. **Readable body font.** HD-2D games pair pixel worlds with crisp UI text *(observed)*. Xbox
   Accessibility Guideline 101 asks for at least one sans-serif option, a non-stylised
   alternative to any stylised font, sentence case rather than all caps for anything longer than
   1–2 words, and left alignment. Keep **Nunito** (warm, rounded, already loaded) for body and
   data. Offer **Atkinson Hyperlegible** as a "Readable font" setting.
6. **Icons:** draw on a 16 px grid for inline use and 24 px for buttons and nav, shown at 1× or
   2× of `--u` *only*. One silhouette per meaning. No icon carries meaning alone: label it, or
   give it a tooltip plus `aria-label`.
7. **Colour in pixel UI:** a limited ramp per material (brass: 3 tones; green: 5; cream: 3).
   Outlines one art-px darker than the neighbouring ramp, not pure black (matches
   `art-direction.md`). Dithering is fine for scene backgrounds and wrong behind text: dithered
   page backgrounds (`repeating-conic-gradient` checker) cost contrast and add visual noise.
   Keep them for empty space only.
8. **Juice (Jonasson and Purho, "Juice it or lose it"):** "maximum output for minimum input".
   Tweening, squash, small particles and sound make a functional UI feel alive. Folmer Kelly's
   counterpoint, "Don't juice it or lose it": juice can erode clarity, so use it on *outcomes*
   (win, reward, level-up), not on static chrome.

### 5.2 HD-2D UI conventions to adopt
- Crisp text on **semi-opaque ink plates** (ink at 80–88%) with a 1 art-px brass hairline, over
  the 3D scene. No full panels covering the action.
- Pixel ornaments (corner brackets, rosettes, horseshoes) as *accents* on frames, not as frames
  everywhere.
- Gentle bloom and DOF stay in the canvas. UI layers above are never blurred.

Sources: [mixels rant](https://community.flowlab.io/t/mini-rant-stop-using-mixels/38287),
[pixel-perfect tail devlog](https://squeakypig.itch.io/unicopia/devlog/787703/a-tale-about-chasing-a-pixel-perfect-tail),
[KDE fractional DPR fix](https://invent.kde.org/frameworks/kirigami/-/merge_requests/2127),
[web.dev devicePixelContentBox](https://web.dev/articles/device-pixel-content-box?hl=en),
[MDN border-image-slice](https://developer.mozilla.org/docs/Web/CSS/border-image-slice),
[Pixel Art 9-Slicer 4-CSS](https://alanrobinsondev.itch.io/9slice-pixel-art-4css),
[Silkscreen sizing](https://fedoraproject.org/wiki/Fonts/Silkscreen),
[Kottke: Silkscreen](https://kottke.org/plus/type/silkscreen/),
[pixel font scaling](https://opengameart.org/node/48712),
[gamedev.net UI scaling](https://gamedev.net/forums/topic/719580-ui-scaling-problem/5472784/),
[4x3pixels readability devlog](https://rookgameproductions.itch.io/4x3pixels/devlog/762131/small-redesign-to-improve-readability),
[XAG 101 text display](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-101-text-display.md),
[Juice it or lose it](https://www.gamedeveloper.com/design/video-is-your-game-juicy-enough-),
[juice summary](https://roblog.co.uk/2024/03/juicy-games/).

---

## 6. Mobile-first navigation and layout

- **Grip and reach:** Hoober's field study of more than 1,300 people found 49% one-handed, 36%
  cradled and 15% two-handed. Only about a third of the screen is effortless (bottom,
  opposite side). → Primary actions sit at the bottom. Top-of-screen controls are for
  rare actions only (settings, credits detail).
- **Visible beats hidden navigation:** NN/g (179 participants) found hidden (hamburger) nav
  less discoverable and slower (15% slower on mobile, 39% on desktop). → A **bottom tab bar
  with at most 5 destinations**, always visible except in the race theatre mode.
- **Tap targets:** WCAG 2.2 SC 2.5.8 requires at least 24×24 CSS px (AA); Apple asks for 44 pt
  and Material for 48 dp. → **Our floor is 44×44 px**, with at least 8 px gaps between adjacent
  targets. Silks swatches (currently about 40 px with 6 px gaps) meet this only if the hit area
  is padded.
- **Portrait for management, landscape optional for watching.** Portrait suits one-handed,
  menu-driven play; landscape gives "twice as much" room for dense, active views. Several
  mobile games support both by re-laying out the same information. → Manage in portrait. The
  race stage is 16:9 full-bleed in portrait, with an optional **theatre mode** when the phone
  is rotated.
- **iOS constraints:** `screen.orientation.lock()` isn't available on iPhone Safari, and element
  fullscreen on iPhone is limited or new. → Theatre mode is CSS-driven
  (`position: fixed; inset: 0; height: 100dvh`) and triggered by the rotation media query or a
  button. It hides chrome and never depends on the Fullscreen API.
- **Safe areas:** use `env(safe-area-inset-*)` on the tab bar, the sticky action bar and the
  theatre-mode HUD. Use `viewport-fit=cover`. Size heights with `dvh`, never `vh`.
- **Performance budget (mid-range Android, 4G):**
  - JS on non-race routes ≤ 150 KB gzip. Community budgets cite about 250–365 KB for the
    whole app, and about 1 s of extra main-thread time per 100 KB on low-end phones.
  - Three.js plus viewer as a **route-split chunk loaded on `/race/*` only**. Prefetch it when the
    player opens the entry sheet or a race starts within 60 s.
  - Art: sprite atlases, at most about 4 MB of decoded textures on mobile. Preload during the
    pre-race window.
  - Render: adaptive quality tiers (DOF and bloom off on low tier). Cap at 30 fps on battery
    saver or low tier. `requestAnimationFrame` paused when hidden.
  - Core Web Vitals targets at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
- `background-attachment: fixed` (used on `body`) is ignored or janky on iOS. Use a fixed
  pseudo-element.

Sources: [A List Apart: phone grips](https://alistapart.com/1-2-phone-grips-jpg/),
[Smashing: thumb zone](https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users),
[NN/g hidden navigation](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/),
[W3C: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[touch target summary](https://frontendchecklist.io/rules/accessibility/touch-targets),
[Game Developer: mobile vs desktop UI](https://www.gamedeveloper.com/design/mobile-vs-desktop-ui-how-they-differ-in-design),
[UESP: Blades in landscape and portrait](https://content1.m.uesp.net/wiki/General:Building_the_Interface_of_The_Elder_Scrolls:_Blades_in_Landscape_and_Portrait),
[WebKit orientation lock bug](https://bugs.webkit.org/show_bug.cgi?id=257695),
[Apple forum: Fullscreen API on iOS](https://developer.apple.com/forums/thread/133248),
[performance budgets](https://www.mintlify.com/addyosmani/web-quality-skills/reference/performance-budgets).

---

## 7. Spectator and broadcast UX for races

### 7.1 What real racing broadcasts show
- **Running order on screen.** Trakus showed moving saddlecloth-coloured program numbers
  ("chiclets") on TV and toteboards. The point is to keep "the order clear no matter how tight
  the director made the field". NBC's SMT leaderboard shows the top 6. TPD's in-running
  graphics show a live order of the first 10 plus the leader's speed, recent splits and a
  distance countdown. Racing TV and Coursetrack show the race clock, leader's speed, leader's
  time per furlong and distance to finish.
- **Director's grammar.** "It's our goal… to have defining views of critical moments." Racing is
  "on script for three hours and off script for two minutes", so the whole track must be covered.
  Weave every runner's storyline in, not just the favourite's.
- **Finish.** Slow-motion "Across the Line" replays are ready within 15 s. The photo finish is a
  *strip* image: the horizontal axis is time, and a vertical winning line plus a time scale
  decide by the nose. Legs vanish and bodies stretch, and the order stays exact.
- **F1 and esports overlays.** A permanent left timing tower (position, name, team mark, gap,
  tyre). Viewers complain when gaps stop updating, when numbers are illegible on black, and when
  penalties or state are hidden. Overwatch's spectator tools added team uniforms, a top-down map
  and smooth "smart" cameras because first-time viewers couldn't follow fights.

### 7.2 Our race broadcast pattern (detailed spec in §11.8)
- **Running-order strip (chiclets).** A row of saddlecloth squares *in current order*, numbered.
  12 runners × 26 px fit 360 px. Your horse gets a brass outline plus a caret. In landscape or
  desktop it becomes a **left timing tower**: pos · cloth · name · gap in lengths.
- **Persistent minimum HUD:** clock, distance to go ("600 m to go" plus a furlong-pole progress
  bar), LIVE/REPLAY state. Nothing else lives inside the canvas.
- **Commentary:** an event-to-template system with priorities. Detectors fire events (break,
  lead change, move, tiring, photo) into a priority queue. Lines are chosen from pools to avoid
  repetition, as in the Bygfoot and robot-soccer commentary systems. Show at most one line per
  about 2.5 s. Big events pre-empt.
- **Camera schedule tied to the tension curve.** Wide crane at the break, then side-on tracking
  of the lead group, then periodic cuts to *your* horse (with a "Your horse: 7th, 4 L" lower
  third), then low and tight in the final 2 furlongs, then head-on at the line, then the photo
  strip if the margin is under about 0.1 L. Umamusume's dynamic camera follows the same arc:
  wide at the gates, then switching between contenders in the last spurt.
- **Highlights options (FM):** Full / Extended / Key moments / Commentary-only. FM players
  sometimes distrust what highlights show versus the result. Our deterministic replay makes the
  visuals *the* result, so "Key moments" mode for impatient viewers is safe.
- **Odds-free stakes.** No odds, no betting language. Use pundit marks (◎ top pick, ○ danger,
  ▲ outsider to watch), a convention from Japanese racing papers that Umamusume uses
  *(observed)*. Add "form", "fit" and *your* goal ("Top 3 = 648 cr").

Sources: [Brisnet: Trakus](https://www.brisnet.com/racing/news/trakus-system-to-debut-in-europe),
[Trakus chiclets 2008](https://brooklynbackstretch.com/2008/07/22/more-from-the-preview/),
[NBC Belmont production](https://www.sportsvideo.org/2015/06/05/triple-crown-hopeful-american-pharoah-nbc-sports-race-towards-history-at-belmont/),
[SVG Europe: Racing TV live data](https://www.svgeurope.org/blog/headlines/live-timing-data-information-at-cheltenham-festival-on-racing-tv-for-first-time/),
[TPD in-running graphics](https://sbcnews.co.uk/sport-business/horseracing/2021/10/14/tpd-to-showcase-racing-live-graphics-at-4m-qipco-british-champions-day/),
[Coursetrack](https://www.broadcastnow.co.uk/broadcasting/coursetrack-brings-timing-data-to-racecourse-media-groups-live-broadcasts/5158202.article),
[RaceTech cameras](https://www.broadcastnow.co.uk/production/racetech-unveils-series-of-camera-innovations/5201212.article),
[Photo finish](https://en.wikipedia.org/wiki/Photo_finish),
[F1 timing tower complaints](https://beyondtheflag.com/formula-1-tv-coverage-severely-decreased-quality),
[UX critique of F1 graphics](https://uxdesign.cc/a-design-perspective-on-the-new-and-frustrating-formula-one-tv-graphics-ec0a35c3a761),
[Overwatch spectator tools](https://www.invenglobal.com/articles/3325/jeff-kaplan-addresses-the-spectator-issue-in-overwatch-responds-with-team-uniforms-top-down-map-and-more),
[Bygfoot commentary format](https://bygfoot.sourceforge.io/new/doc/def_howto_lgcommentary.html),
[robot soccer commentary](https://cse.iitk.ac.in/users/amit/courses/768/98/deepay/index.html),
[FM highlight modes](https://ggrecon.com/guides/football-manager-2024-change-highlights).

---

## 8. Retention, economy and fairness UX

### 8.1 Loops (ethical)
- **Core (1–3 min):** pick a horse, then the plan, then watch, then the result and the "why",
  then tweak and race again.
- **Daily (3–8 min):** welcome-back recap, then the Daily Cup (one entry, shared seed), then tend
  horses (later: allot today's training sessions), then check the Club board.
- **Weekly or seasonal (later):** season calendar with feature races, horse aging, then
  retirement, the Hall of Fame and breeding.
- Show **short-, mid- and long-term goals** in visible places (Roblox guidance): next race
  goal, this week's target, a season milestone.

### 8.2 Rewards and streaks without dark patterns
- **No punitive streaks.** Streak resets are a major source of anxiety and a reason people
  quit. If we track streaks at all: count *days raced this week* (resets weekly, never "lost"),
  include freezes or grace, and phrase breaks kindly. Ask: "does the product profit from anxiety
  it created?"
- **No variable-ratio paid rewards, no loot boxes, no paid randomness.** Breeding outcomes are
  random. If breeding ever costs token or real money, it must show explicit outcome ranges
  (Flight Rising calculators) and go through legal review, because it is close to loot boxes.
- **No entry-fee prize pools in token.** Zed Run's paid races, where entry fees fund a pot that
  the top 3 split, are gambling-shaped. Most entrants lose money. Keep prizes as non-cashable
  *credits*.
- **Rewards feel physical:** credits roll up from the prize plate into the purse in the header.
  A rosette pins onto the horse's record. Win > place > show, scaled.
- **Welcome back** (idle-game pattern): collect *before* anything else, frame it as a
  summary or gift, and never open on a modal offer.

### 8.3 Fairness and randomness
- **Perception beats maths.** Sid Meier: players accepted wins against the odds but rejected
  losses when favoured (a 3:1 advantage "should" win). Civilization Revolution changed the
  maths to match perception. We can't rig a deterministic sim, so we **explain** instead:
  - Pre-race **fit check**: trip ✓, surface ✓, going ~, draw, pace map ("3 front-runners: a
    likely hot pace that suits closers").
  - Post-race **"Why" card**: "Finished 5th. Pace was slow (early 24.1 s/f), which favoured
    the leaders. Your closer had 4 L to find in the straight. Trip ✓, surface ✗ (synthetic, not
    turf)." Add sectional bars for early, mid and late.
  - A **form line** per horse ("5-2-1") so runs feel like a story.
- **The seed commitment as a seal.** Commit-reveal is the standard "provably fair" pattern, but
  it comes from crypto gambling. Critics note that UX friction and operator-hosted verifiers
  weaken it, and that it proves *a specific round wasn't altered*, not that the system is
  balanced. Present it as:
  - Pre-race: a small **🔒 Sealed** badge next to the race title. Tap opens a sheet: "This race's
    outcome was locked when entries closed. Fingerprint: `dabe82…7f61`."
  - Post-race: **✓ Verified**. "Your browser re-checked the seal and re-ran the race: same
    result." Show "Copy seed", "Download replay" and "How it works".
  - Never the words "provably fair" in primary UI. Use "Sealed race" or "Race integrity".

### 8.4 Web3: what to learn from Zed Run, Photo Finish LIVE and Axie
- **Zed Run** (Naavik teardown): almost entirely metagame (choose entries, the server decides),
  with "little moment-to-moment interaction", hidden stats and opacity that bred distrust
  (suspected unannounced algorithm changes), breeding inflation (horses never aged or died),
  long and noisy feedback loops, and wallet/OpenSea/WETH onboarding friction. About 9k daily
  active stables (Dec 2021). Later discontinued after six years. Its successor *Zed Champions* auto-matches races (removing manual
  entry), and the old horse NFTs did **not** carry over. **Lessons:** aging and retirement as
  supply sinks (already in our architecture), transparent stats, short feedback loops, a
  free-to-play path with no wallet, announced balance changes, and never promise asset
  permanence the studio can't keep.
- **Photo Finish LIVE:** six visible attributes (Start, Speed, Stamina, Finish, Heart, Temper)
  plus surface and direction preferences with penalties. Praised for depth but "the training
  investment is heavy" and has a learning curve. A crypto wallet is required. **Lesson:**
  visible preference penalties are good. Make the learning curve optional.
- **Axie Infinity:** a token economy that relied on new demand. Most game tokens fell more than
  80%, and players' assets became worthless. **Lesson:** credits are the game economy. Any token
  stays optional, peripheral and never the reason to play.
- **Sentiment:** in 2022 polling, more than 4 in 10 gamers said they'd quit games that add NFTs
  and 84% weren't interested in buying them. → The wallet lives under *Profile → Optional:
  link wallet*, with no crypto vocabulary on core screens.

### 8.5 Social proof and new-player protection
- **Relative leaderboards over absolute ones.** In a study, relative ("near me") boards kept all
  learners equally motivated, and tiered leagues raised motivation for both high and low
  positions by "altering the field of comparison". → Club board defaults to *your league or
  tier* and *near you*. The global top 10 is a secondary tab. The Hall of Fame celebrates
  *horses* (retired legends) as well as stables.
- **New-player protection:** Novice/Maiden races open only to horses with fewer than N starts,
  or stables under X days old. Quick races fill with level-matched AI. The first 3 races
  guarantee a field where the player's best-fit horse is competitive (still honest: we choose
  the *field*, not the result).

Sources: [Smashing: streak systems](https://www.smashingmagazine.com/2026/02/designing-streak-system-ux-psychology/),
[UX Mag: hot streaks](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design),
[idle game lessons](https://dev.to/aguier/i-built-7-idle-games-in-30-days-what-i-learned-about-incremental-design-5d3f),
[Game Informer: Sid Meier](https://gameinformer.com/b/news/archive/2010/03/12/sid-meier-gamers-arent-logical),
[VentureBeat: Meier quotes](https://venturebeat.com/2010/03/12/quotes-from-sid-meiers-keynote-gdc-speech),
[HN: provably fair](https://hn.nuxt.dev/item/46895231),
[provably fair tutorial](https://dev.to/veritaschain/provably-fair-gaming-building-cryptographic-rng-verification-with-vap-gam-4527),
[Naavik: Zed Run](https://naavik.co/digest/dec-2021-zed-run/),
[Decrypt: Zed Champions](https://decrypt.co/316789/ethereum-nft-game-zed-run-reborn-base),
[Zed Run discontinued](https://www.blockchaingamer.biz/amp/news/37092/zed-run-discontinued-for-zed-champions/),
[Photo Finish LIVE review](https://egamers.io/?p=107665),
[Photo Finish attributes](https://thirdtimegames.com/?p=4762),
[WEF on the blockchain gaming bubble](https://weforum.org/agenda/2022/12/blockchain-gaming-microscope-part-2),
[The Block: Axie decline](https://www.theblock.co/article/146915/the-decline-of-axie-infinity),
[SurveyMonkey: gamers and NFTs](https://surveymonkey.com/curiosity/gaming-subscriptions-nfts-and-acquisitions),
[relative leaderboards study](https://www.emerald.com/insight/content/doi/10.1108/intr-12-2021-0897/full/html),
[tiered leaderboards dissertation](https://rex.libraries.wsu.edu/esploro/outputs/doctoral/LEVELING-THE-COMPETITION-THE-IMPACT-OF/99901221152701842).

---

## 9. Accessibility

- **Game Accessibility Guidelines (basic tier):** high contrast text and UI; readable default
  size; no essential info by colour alone; let players start without navigating several menu
  levels; interactive tutorials; simple language; separate volume controls; subtitles or
  captions for speech; settings saved.
- **XAG 101/102:** text scalable to 200% without loss, at least one sans option, sentence case,
  left alignment, and line length of 80 characters or fewer. Contrast: 4.5:1 for text, 3:1 for
  large text, 7:1 in high-contrast mode. Measure against the *least* contrasting part of a busy
  background. Offer solid backing plates.
- **Motion:** scaling or zooming and spinning motion are vestibular triggers. User-driven motion
  is generally fine. Players ask for a single "reduce camera motion" preset plus granular
  toggles (shake, smoothing, zoom). Don't assume a genre is "safe".
- **Canvas and screen readers:** mirror state into DOM text. Keep one visually hidden
  `aria-live="polite"` region present from first render. Announce *key events* (the off, each
  furlong-pole order of the top 3 plus your horse, the finish), not every frame. Reserve
  `assertive` for "Your horse won" or similar.
- **Colour-blind safety:** Okabe-Ito is the reference categorical palette (yellow is weakest on
  light backgrounds). Pair colour with shape or pattern or a label. For us: cloth number on
  every runner token; silks patterns (hoops, stripes, chevrons) as a second channel; your horse
  marked by a caret plus "YOU", never by colour alone.

Measured contrast of the current tokens (WCAG ratio):

| Pair | Ratio | Verdict |
|---|---|---|
| cream `#f3e7c9` on green `#0f2a1d` | 12.5 | ✓ |
| cream-dim `#cdbf9c` on green | 8.4 | ✓ |
| sage `#8fa592` on green / on `#163a28` | 5.8 / 4.8 | ✓ (barely on 800) |
| brass `#d9a441` on green | 6.8 | ✓ |
| ink on brass | 8.6 | ✓ |
| cream on oxblood `#7a1f1f` | 8.4 | ✓ |
| claret `#e0705f` on green | 4.9 | ✓ for ≥ 14 px |
| live red `#e5483a` on green | 3.9 | ✗ for body text; large or fill only |
| white on live red | 3.95 | ✗ small text; use `#7a1f1f` fill + cream |
| oxblood on green | 1.5 | ✗ as a boundary; needs an ink or cream outline |
| `#2c6645` border on green | 2.3 | ✗ for an input boundary (needs ≥ 3:1) |
| brass-deep `#9a6b22` on cream | 3.8 | ✗ for small text on cream plates |

Sources: [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/),
[XAG 101](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-101-text-display.md),
[XAG 102](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-102-contrast.md),
[WebKit: responsive design for motion](https://webkit.org/blog/7551/responsive-design-for-motion/),
[web.dev: motion](https://web.dev/learn/accessibility/motion?hl=en),
[player camera-motion request](https://forum.norestforthewicked.com/t/linked-camera-motion-smoothing-triggers-motion-sickness/21431),
[canvas announcements](https://bugnet.io/blog/how-to-fix-web-game-canvas-no-screen-reader-announcements),
[ARIA for web games](https://ianeress.substack.com/p/aria-for-web-games-november-13-2024),
[Okabe-Ito palette](https://rdrr.io/cran/factoextra/man/factoextra_palette.html).

---

## 10. Teardown: what to steal, what to avoid

| Reference | Steal | Avoid |
|---|---|---|
| **Football Manager (FM24/26)** | Overview, then detail. A Continue-style primary verb. Search plus glossary (FMPedia) for jargon. Bookmarks. Highlight modes. | FM26's tile and card maze (too many clicks, visual noise). Unreadable small fonts. |
| **Umamusume Pretty Derby** | Aptitude letter grades per surface, distance and style. "Recommended" races. A goal box with turns remaining. A dynamic race camera. Pre-race field review. Celebratory results. | Gacha, stamina refills for currency, opaque skill text, menu depth. |
| **Derby Stallion** | Watching AI races as drama (play-by-play). Breeding as the long game. | Statistic-heavy screens as the main experience (Sonobe's own stance). |
| **Rival Stars Horse Racing** | Beautiful horses as the emotional hook. Tutorialised first minutes. Rest timers framed as care. | Long training timers as gates. Desktop parity lagging mobile. |
| **Horse Racing Manager (Steam)** | A pixel-art horse-racing management niche exists and reviews well (~88%). | A "website/software" UI that feels clunky and slow. |
| **Zed Run** | Constant race availability. Browser-native. Horse identity and bloodline prestige. | Wallet-first onboarding. Hidden stats. Breeding inflation. Paid entry pools. Unannounced algorithm changes. Assets that don't survive. |
| **Photo Finish LIVE** | Visible attributes plus surface and direction preferences with penalties. Real-world racing partnerships later. | Heavy training investment before fun. Required crypto wallet. |
| **Motorsport Manager** | Tilt-shift race view. A 2D low-spec mode. Playful but minimal UI. | A tiny position tracker. |
| **Kairosoft (Game Dev Story)** | 5-minute decision turns. Named characters to care about. Hidden strategic depth. | Sameness across titles. A late-game grind with nothing new. |
| **Two Point Hospital / Stardew** | Compact HUD with sub-menus. Charm via small animations. | No text scaling. Counts too small at max scale. |
| **Pokémon menus** | A party list where each row shows sprite, name and state bar. Six slots fit one screen. | Deep nested menus for frequent actions. |
| **Octopath / Triangle Strategy (HD-2D)** | Crisp UI typography over pixel worlds. Thin ornamental frames. Light and DOF in the world, never on text. | Low-contrast markers on busy backgrounds. Cumbersome menus. |
| **Wordle** | One shared daily challenge. Respects time (3 min). A brilliant share artefact. No ads or nags. | (Nothing.) Don't bolt on streak guilt. |
| **Spelunky Daily** | Shared seed, one attempt, a daily board, randomness locked down for fairness. | (Nothing.) |
| **Lichess** | The homepage *is* the game. Anonymous play. Quick pairing first. | Sparse visual identity (we need charm). |
| **Neopets / Flight Rising** | Collection, expertise and community. Breeding previews (via community calculators). Bottom-nav mobile rewrite with feature parity. Page-by-page migration. | Fixed-width desktop layouts. Years of retrofitting mobile. Decaying page quality. |
| **Kingdom of Loathing / Torn** | Daily allotment with a bankable cap. A visible "full at" time. Humour. | Text walls. Opaque meters. |
| **FarmVille** | Social visits. Gifting. | Withering crops. Guilt-based appointments. Pay-to-unwither. |
| **Racing TV / NBC / TPD / Trakus** | Running-order chiclets. Leader speed and splits. Distance countdown. Slow-mo finish within 15 s. "Defining views of critical moments". | Data overload on a 6-inch screen: pick 3 metrics. |
| **F1 TV / Overwatch spectating** | A persistent timing tower. Team (silks) identity. Smart smoothed cameras. Overview map. | Frozen or illegible gaps. Hidden state (penalties). |

---

## 11. Redesign specification

### 11.1 Information architecture

| Route | Purpose | Primary action | Contents (top to bottom on mobile) |
|---|---|---|---|
| `/` (signed out) | Watch now, then join | **Found your stable** | Live or next race stage (countdown to live), field chiclets, join CTA, Own · Train · Race strip, recent results. |
| `/` (signed in), "Home" | Next best action plus pulse | Contextual: **Race {best-fit horse}** / **Watch your race** / **See result** | Welcome-back recap (if away more than 2 h), *Up next* card (your race or recommendation with fit chips), stable pulse (6 horse chips: ready / resting / racing), Daily Cup card, live-now strip, club ticker. |
| `/start` (alias of `/play`) | Found a stable in 1 tap | **Get my horses** | Pre-rolled name plus silks preview, dice to reroll, "Customise colours" (collapsed), then a reveal of 6 horses, then **Race {recommended} now**. |
| `/stable` | Compare and choose | **Race** (per row) | Sort: Ready · Best fit today · Rating. Roster rows: portrait thumbnail, name, age/sex, style icon, trip and surface fit, form figures, condition. Tap a row to open the horse. |
| `/horse/[id]` | Understand one horse | **Enter a race** (sticky) | Portrait plus identity, aptitude grid (Trip S–E per band, Surface, Going, Style), abilities (6 grade bars, numbers on expand), form and history with replays, pedigree (later), training (later). |
| `/races` | Today's card | **Enter** (sheet) | Tabs: *Today* (schedule list: time, name, class, distance, surface, field size, "fits: 2 of your horses" badge), *Results* (your races first, unwatched ones marked "▶ Watch" with no spoilers), *Daily Cup*. |
| Entry sheet (modal over any route) | Choose horse plus plan | **Enter & go to gates** | Horse picker (pre-sorted by fit), plan selector (3 styles, natural style preselected, pace-map hint), Sealed badge, entry confirm. |
| `/race/[id]` | Broadcast | Phase-dependent: *Watch* / *Skip to finish* / *Race again* | Stage, chiclets, commentary, then your-horse card, then field (pre-race) or results sequence (post), then a Sealed/Verified chip. |
| `/club` (later) | Leaderboards, Hall of Fame, seasons | View your league | Your league (near you), seasons calendar, Hall of Fame horses. |
| `/market`, `/breeding` (later) | Economy | Contextual | Listing cards, offspring range previews. |
| `/me` | Profile and settings | (none) | Stable name and silks, **Accessibility** (text size, readable font, reduced motion, race mode: full/lite/radio, captions), sound, save stable (passkey/email), optional wallet (bottom, collapsed). |
| `/race/[id]/verify` | Integrity detail | **Re-verify** | Commitment, reveal, result hash, engine version, an explainer. |

### 11.2 Navigation model
- **Mobile:** a bottom tab bar, 56 px plus safe area: **Home · Stable · Races · Club***, with
  `Me` as the silks avatar in the top bar. (*In the demo `Club` can be hidden, giving 3 tabs.)
  The active state is a brass icon, cream label and a 2-art-px brass notch on top. The
  background stays flat. Not a filled button.
- **Sticky action bar** sits directly above the tab bar on screens with a primary action. One
  brass button, full width minus 16 px gutters, 52 px tall. It hides when the keyboard is open.
- **Top bar (48 px):** crest (home), screen title (pixel display 24), credits purse (tap opens a
  ledger sheet), avatar. On `/race/*` the top bar turns into the broadcast plate.
- **Desktop (≥ 1024 px):** top nav with the same 4 destinations as text tabs. Content max width
  1200 px. Two-column layouts where they help (stable list plus horse preview pane, race stage
  plus timing tower). The action bar becomes an in-content primary button. No floating bars.
- **Theatre mode** (race, phone rotated or ⤢ button): hides all chrome. HUD: tower on the left,
  clock on the top right, ticker at the bottom, controls on tap. Exit with ✕ or by rotating back.
- **Back behaviour:** the race page's back goes to the place you came from (stable/home), not the
  races list. Use `history.back()` when the referrer is internal.

### 11.3 Component inventory (pixel UI kit)

**Surfaces:** `Frame.Hero` (ornate brass 9-slice, at most one per screen) · `Frame.Panel` (ink
plus green bevel) · `Frame.Inset` (sunken well) · `Plate.Paper` (cream "race card" paper for
programmes and certificates) · `Plate.Ink` (semi-opaque overlay plate for text on scenes).

**Actions:** `Button.Primary` (brass, 44/52 px) · `Button.Secondary` (green) ·
`Button.Ghost` (text plus underline) · `Button.Danger` (oxblood) · `IconButton` (44×44 hit
area) · `ActionBar` (sticky) · `Segmented` (camera, speed, tabs) · `Sheet` (bottom sheet with
drag handle, focus trap).

**Navigation:** `TabBar` · `TopBar` · `BroadcastPlate` · `Breadcrumb` (desktop only).

**Data:** `RosterRow` · `RaceRow` (time block, name, conditions, fit badge) · `ResultRow` ·
`StatBar` (segmented, 10 segments, grade letter) · `GradeBadge` (S–E) · `AptitudeGrid` ·
`FitChip` (✓ / ~ / ✗ plus text) · `FormFigures` ("5-2-1") · `SectionalBars` (early/mid/late) ·
`PaceMap` (dots for front/stalk/close counts) · `Ledger` (credits history) · `StatTile`
(icon, label, value; never truncates: wraps or shrinks).

**Identity:** `Silks` (sizes 16/24/32/48 art px) · `Saddlecloth` (number plus post colour) ·
`Portrait` (64 native, ×2/×3) · `HorseChip` (portrait thumbnail plus name plus state dot) ·
`Crest`.

**Race:** `Stage` · `Chiclets` · `TimingTower` · `ClockToGo` · `Ticker` · `LowerThird`
("Your horse 7th · 4 L") · `PhotoStrip` · `ResultBoard` (podium plus your row) ·
`RewardCounter` · `WhyCard` · `SealBadge` / `VerifySheet` · `ReplayControls` (scrubber with
chapter ticks: Break · Halfway · 2f · Finish).

**Feedback:** `Toast` · `Skeleton` (pixel-shimmer-free, static) · `EmptyState` · `Confetti`
(one-shot) · `Rosette` (award pin) · `Countdown`.

**Each component ships with:** sizes, all states (default/hover/pressed/focus/disabled/
loading/selected), reduced-motion behaviour, a text alternative, and a minimum-contrast check.

### 11.4 Typography scale

Three faces only:
- **Display:** Pixelify Sans 600, pixel display for titles and big numerals.
- **Scoreboard:** Jersey 10, for clocks, positions and countdowns. Used at 30, 40 or 60 px
  only, and in tabular context. (Drop VT323; use Jersey 10 for the LED plate.)
- **Text:** Nunito 400/600/800 with `tabular-nums` for data. Atkinson Hyperlegible available as
  a setting.
- **Drop Silkscreen and VT323.**

| Token | Face | Size / line | Use |
|---|---|---|---|
| `display-xl` | Pixelify 600 | 40/44 (desktop 56/60) | Screen hero title (one per screen) |
| `display-l` | Pixelify 600 | 32/36 | Race name, horse name on detail |
| `display-m` | Pixelify 600 | 24/28 | Section titles, card titles |
| `score-xl` | Jersey 10 | 60/60 | Countdown, finishing position on the result board |
| `score-l` | Jersey 10 | 40/40 | Clock in HUD, credits counter (hero) |
| `score-m` | Jersey 10 | 30/32 | Chiclet numbers on desktop, purse |
| `title` | Nunito 800 | 18/24 | List item primary (horse and race names in rows) |
| `body` | Nunito 400 | 16/24 | Paragraphs, inputs (16 px stops iOS zoom) |
| `body-strong` | Nunito 700 | 16/24 | Emphasis, button labels in sans contexts |
| `meta` | Nunito 600 | 14/20 | Secondary row text, table cells |
| `label` | Nunito 700, +0.04em, small caps | 12/16 | Field labels, eyebrows (≤ 3 words) |
| `caption` | Nunito 600 | 12/16 | Legal, hashes (monospace exception: `ui-monospace` 12) |

Rules: horse names in lists use `title` (sans), *not* pixel display, so they stay legible and
don't truncate. Pixel display text never goes below 24 px. No all-caps runs longer than 3
words. Line length is 45–75 characters. Text scales with the user setting (90/100/115/130%).

### 11.5 Colour and contrast rules

Tokens (existing values, new roles):
- `bg` `#08150e` (page) · `surface-1` `#0f2a1d` (panel) · `surface-2` `#163a28` (raised/row
  hover) · `inset` `#0b1f15` · `line` `#3f8558` (≥ 3:1 boundaries on surface-1 need `#5a9b70`
  or an ink plus a light bevel pair) · `paper` `#f3e7c9` · `ink` `#0b0f0c`
- Text: `text` cream `#f3e7c9` · `text-2` cream-dim `#cdbf9c` · `text-3` sage `#8fa592`
  (surface-1 only; not on surface-2 for small text)
- Accent: `brass` `#d9a441` (primary action fill, "yours" marker, selected state) ·
  `brass-bright` `#f2c86a` (focus ring, big numerals)
- Status: `live` oxblood `#7a1f1f` fill plus cream text (never red text on green) · `positive`
  `#9fe0a8` (gains, ✓ fit, 10:1) · `warn` `#f2c86a` (~ fit) · `negative` `#ff8a7a` (✗ fit,
  losses, 6.7:1)
- Grades: S `#f2c86a` · A `#e8b25a` · B `#cdbf9c` · C `#a9bda9` · D/E `#8fa592`. A single warm
  to cool ramp, always with the letter. Replace the current rainbow.

Rules:
1. **Brass = act or yours.** One brass-filled button per viewport. A brass outline marks *your*
   horse, row or token. Frames are not brass, except the one hero.
2. Text ≥ 4.5:1, large display ≥ 3:1, UI boundaries and focus ≥ 3:1. Text over scenes always
   sits on an `ink` plate (≥ 80% opacity) or carries a 1 art-px ink outline.
3. Never encode by colour alone: fit uses ✓ ~ ✗ plus a word; position uses a number; your horse
   uses a caret plus "YOU".
4. Silks picker: warn if primary and secondary contrast is under 2:1 ("Pattern may be hard to
   see in a race").
5. A dithered background only in empty margins (not behind text). Drop `background-attachment:
   fixed`.

### 11.6 Motion and juice rules

| Moment | Motion | Duration | Reduced motion |
|---|---|---|---|
| Button press | 2 px down, shadow off (`steps(1)`) | 60 ms | same (not vestibular) |
| Hover (desktop) | 2 px lift | 80 ms | none |
| Sheet open | slide up, 4 steps | 180 ms | fade 120 ms |
| Route change | none (instant) plus skeletons | none | none |
| Credits gain | roll-up proportional to delta, coin "hop" into purse | 400–900 ms | instant swap plus text "+216" |
| Position change in race | chiclet swap with 1-step slide; "▲2" tag on yours | 200 ms | instant reorder |
| Win | confetti burst (one shot, ≤ 1.2 s), rosette stamp, crowd swell | ≤ 1.5 s, tap to skip | rosette appears, no particles |
| Photo finish | freeze, white flash replaced by a strip wipe (no flash), stamp | 1.5–2 s suspense | static strip, no wipe |
| Countdown last 3 s | digit scale-pop 1 step | 120 ms | colour change only |

Principles: motion is triggered by events, never loops forever. (Remove: nav icon bob, card
tilt and parallax on lists, sheen on idle cards, infinite confetti.) Pixel motion uses
`steps()` and snaps to the art unit. Celebrations scale with significance (first win >
win > place). Every celebration is skippable and ends with the next action focused.

### 11.7 Onboarding flow: time-to-first-race target ≤ 60 s, ≤ 3 taps

1. **Land (`/`, signed out):** the live or next race plays or counts down at the top. CTA:
   **Found your stable (free)**.
2. **`/start`:** the silks and name are *pre-rolled* and shown on the tack-room stand.
   🎲 rerolls. "Customise colours" is an accordion (pattern plus 3 swatch rows, as today). One
   button: **Register & get my horses** (tap 1).
3. **Reveal (≈ 3 s, skippable):** 6 stall doors open in sequence. The horse that best fits the
   next quick-race conditions is flagged **"Ready to race"**. Copy: "Six horses have arrived.
   Lucky Mirage is fit and loves sprinting on turf."
4. **CTA: Race Lucky Mirage now** (tap 2) opens the entry sheet, prefilled with the natural
   style and a one-line hint ("Front-runner: she'll try to lead all the way"). **Go to the
   gates** (tap 3).
5. **Race (≈ 60–90 s):** the pre-race shows a fit check and a 1-line coach mark "Your horse wears
   the brass marker". The race plays. Result plus "why" plus **+credits**.
6. **After the first result:** a 3-card "what's next" (Try another horse · Try a different plan
   · Your stable). After the first *win* (or 3rd race): "Save your stable to keep it" (passkey
   or email). Teach other features *contextually* via empty states, never with a tour.

Metrics: funnel steps (land → register → first entry → first finish → second race → D1
return). Targets: register ≥ 40% of non-bounced visitors, first finish ≥ 85% of registrants,
median time from land to first off ≤ 60 s.

### 11.8 Race-watching experience spec

**Phases and timing (quick race; the club card is the same with a longer pre-race):**

| Phase | When | Stage | Below the stage | Audio (later) |
|---|---|---|---|---|
| **Paddock** | T−10 s (club: from T−3 min) | Your horse parading (canter loop) on the paddock/turf scene. Big countdown on an ink plate. | *Your horse* card: fit chips (Trip ✓ Surface ✓ Going ~ Draw 7), plan, goal ("Top 3 pays 648"). Field list with chiclets, silks and pundit marks ◎○▲. 🔒 Sealed badge. | Crowd murmur |
| **Gates** | T−3 s | Gate loading: stalls fill in cloth order, your stall highlighted. | Field collapses to chiclets. | Bell |
| **The off** | T = 0 | Wide crane down to the gates (2–3 s) | Chiclets live. Commentary: "They're off!" | Gates clang, crowd lift |
| **Early** | 0–25% | Side-on tracking of the leaders. Cut to your horse every ≈ 8 s (2 s lower third). | Chiclets plus clock, "1,200 m to go" | Hooves loop |
| **Middle** | 25–70% | Alternate leader / your horse / an overhead "pack view" (optional) | Commentary on positions at each furlong pole | |
| **Turn for home** | 70–85% | Camera swings low. Gaps in lengths appear on the tower. | Your lower third pinned | Crowd builds |
| **Final 2f** | 85–100% | Tight and low. Cuts between the top 3 and your horse if within 3 L. Speed lines (subtle). | Position-change tags (▲/▼) | Crowd peak |
| **Line** | Finish | Head-on finish-post cut. If margin < 0.1 L: freeze, then **PHOTO** strip reveal after 1.5–2 s. | "Result official" | |
| **Result board** | +2 s | Podium (1-2-3 silks, names, margins, time) plus *your row* if outside the top 3 | (none) | Fanfare if you placed |
| **Rewards** | +4 s | Prize plate, credits roll-up into the purse, rosette onto the horse record | (none) | Coin ticks |
| **Why & next** | then | (stage shows the replay poster) | **Why card** (pace, fit, sectionals), **Race again** (same horse/plan), **Try a new plan**, **Back to stable**, **Watch replay**, full results (collapsed), ✓ Verified | |

**HUD layout**
- *Portrait (default):* the stage is full-bleed 16:9 at the top of the page, with the broadcast
  plate as a 32 px strip above it (status, race name truncated, ⤢). In-canvas: only clock and
  to-go (top right) and your-horse caret plus "YOU" tag. Under the stage: chiclets (44 px tall,
  scrollable if more than 12), then the commentary line (sans 16, 2-line clamp), then the
  your-horse lower card. Controls appear on tap over the stage (auto-hide after 3 s): ⏯, scrub,
  speed, camera.
- *Landscape theatre / desktop:* timing tower on the left (top 8 plus you, gap in lengths,
  name 14 px sans), clock top right, ticker bottom centre, controls bottom on hover or tap.
- Remove the in-canvas race title and chips (they duplicate the page) and the horizontal name
  ribbon.

**Replay and spectator controls:** play/pause, scrub with chapter ticks, 0.5/1/2/4×, camera
(Director · Leader · My horse · Wide), "Skip to final 2f", "Watch my horse". Keyboard:
Space, ←/→ (5 s), 1–4 cameras, M (mute).

**Lite and radio modes:** *Lite* is a 2D side-scroller strip with chiclets for low-end devices or
data saver. *Radio* is commentary plus the live order list as text only, the accessibility and
background-tab mode. Both use the same replay data.

**No-spoiler rule:** your own unwatched races never reveal positions anywhere (home, results,
tab title, OG cards) until opened. They show as "▶ Result ready".

### 11.9 Home for returning players

1. **Welcome back** (if last visit was more than 2 h ago or there are unseen results): a compact
   recap. "While you were away: 2 results ready (▶ watch), +848 credits, Sable Verdict is
   rested." Dismiss collapses it to a chip.
2. **Up next (primary):** one card plus the sticky action. Priority: (a) your race running or
   starting under 2 min, then **Watch**; (b) unwatched result, then **See result**; (c) best-fit
   recommendation ("Larkhill Mile at 16:39 suits Hollow Compass: Trip ✓ Surface ✓"), then
   **Enter**.
3. **Stable pulse:** a horizontal row of 6 horse chips (portrait, name, state dot: ready /
   resting / entered).
4. **Daily Cup:** today's conditions, your entry or an **Enter** button, close time, yesterday's
   share card.
5. **Live now:** a slim strip "Running now: Blackwater Classic ▶" (spectating is secondary).
6. **Club** (later): your league position ("4th of 20 · 120 pts to 3rd").

### 11.10 Empty states (NN/g: system status, a learning cue, a direct pathway)

| Where | Copy | Action |
|---|---|---|
| Horse with no runs | "No runs yet. Her first start will show here with a replay." | **Race Lucky Mirage** |
| Results (none of yours) | "Your races and replays will appear here." | **Enter a quick race** |
| Stable (no player) | Silks stand silhouette: "Found a stable to get six horses." | **Found your stable** |
| Daily Cup closed | "Today's Cup is run. Next one opens at 00:00 (your time)." | **Watch today's Cup** |
| Club board (new) | "Race 3 times to join a league." | Progress 1/3 |
| Load error | "Couldn't reach the track. Your stable is safe on this device." | **Retry** |

Never show "No records" before data loads. Use static skeletons shaped like the content.

### 11.11 Accessibility checklist (ship gate)

- [ ] Text: 16 px body, ≥ 12 px minimum anywhere, pixel display ≥ 24 px. User text-size setting
      (90–130%), layout survives 200% browser zoom without horizontal scroll.
- [ ] Contrast: all text ≥ 4.5:1 (large ≥ 3:1), boundaries and focus ≥ 3:1. Measured on the
      worst part of scene backgrounds.
- [ ] Targets ≥ 44×44 px, spacing ≥ 8 px. Everything reachable by keyboard. Visible focus
      (brass-bright 3 px).
- [ ] Never colour alone: cloth numbers, fit ✓/~/✗, "YOU" tag, position numbers.
- [ ] `prefers-reduced-motion` *and* an in-app toggle: static or slow camera (Wide), no shake,
      no parallax or tilt, no particles, instant counters.
- [ ] Race: an `aria-live="polite"` region (present at load) announcing the off, order at each
      furlong pole (top 3 plus you), the finish. `assertive` only for your result. A DOM-text
      field list mirrors the canvas. `role="img"` plus a label on the canvas. Radio mode.
- [ ] Captions for commentary (it's already text; keep it outside the canvas so screen readers
      and zoom work).
- [ ] Separate volume: crowd, effects, music. Muted by default until the first gesture.
- [ ] Sheets trap focus, Esc closes, focus returns to the trigger.
- [ ] Language: simple, sentence case. A glossary popover (FMPedia-style) for racing terms
      (going, furlong, stalker, lengths).
- [ ] Settings persist (local now, account later).

---

## 12. Prioritised plan

### Do now (demo)
1. **Onboarding: 3 taps to the first own race.** Pre-rolled identity, collapsed customisation,
   reveal with a "Ready to race" horse, **Race now** going to a prefilled entry sheet and the
   gates. (P1)
2. **Home becomes "your next action".** Up-next card plus sticky action bar. Live spectating
   moves to a secondary strip. Rename the tab Paddock → Home. (P2)
3. **Type cleanup:** remove Silkscreen and VT323. Labels and eyebrows to Nunito 12/13 semibold.
   Body 16 px. Horse and race names in lists to sans `title`. Pixel display only ≥ 24 px. (P4)
4. **Surface hierarchy:** panels lose brass borders. One hero frame per screen. Brass only for
   the primary action, "yours" and selection. Flat tab bar with notch. (P3, P11)
5. **Stable as a roster list** with fit chips and a per-row **Race** action. Cards move to
   `/horse/[id]` only. Fix tile truncation. (P5, P9)
6. **Race page, phone-first:** stage at the top, full-bleed. Collapse the duplicated titles.
   Chiclet strip under the stage. Commentary outside the canvas. Remove the in-canvas title
   and name ribbon. (P7)
7. **Staged results:** result board, then reward roll-up, then the Why card (pace, fit,
   sectionals from existing replay data), then next actions. Collapse the full table. Remove
   the duplicate overlay or page table. (P8)
8. **Fairness as Sealed/Verified badge plus sheet.** Remove "Provably Fair" panel prominence and
   pre-race hashes from the page body. (P12)
9. **Motion diet:** remove infinite bob, list tilt, idle sheen and infinite confetti. Add a
   reduced-motion path. (P10)
10. **Pre-race paddock content** in the 10 s window: your horse's fit check, field with marks.
    Preload viewer assets.
11. **No-spoiler rule** for your own unwatched results. Tab-title countdown and "result ready"
    badge.
12. **Contrast fixes** from the §9 table (live red text, `#2c6645` boundaries, brass-deep on
    cream).

### Next milestone (B: metagame)
- Aptitude grid (S–E per trip band, surface, going, style) on horse, roster and entry sheet.
  Race "recommended" badges.
- Daily Cup (shared seed, one entry, share card, near-you board).
- Welcome-back recap. Ledger sheet for credits.
- Theatre (landscape) mode plus timing tower. Camera director schedule with lower thirds.
  Photo-strip finish.
- Lite (2D) and Radio race modes. Text-size and readable-font settings.
- Unify pixel density: re-author portraits at 64 px native, set the UI art scale, integer-snap
  canvases (`devicePixelContentBox`).
- Accounts after value: passkey or email "save your stable" after the first win.

### Later (C–F)
- Training with a daily allotment (bankable cap, no decay), condition and rest states with
  "ready at" times.
- Seasons calendar (goal box with races remaining), aging, retirement and **Hall of Fame**.
- Breeding with **offspring range previews**. Pedigree tree. Market with escrow, with an
  explicit fee breakdown.
- Club leagues (tiered, relative boards). Stable profiles. Share cards with OG images.
- PWA install, then opt-in web push (iOS home-screen only), .ics for feature races, an opt-in
  email digest.
- Optional wallet under Profile. No crypto vocabulary on core screens. No token entry pools or
  paid randomness without legal review.
- Commentary v2 (template pools by event priority, horse-specific storylines), audio mix.

---

*End of research. The redesign should treat §11 as the spec and §0 as the review checklist:
every new screen gets checked against the 18 principles before it ships.*
