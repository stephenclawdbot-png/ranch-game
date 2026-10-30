# POST TIME race experience research

*Research for the race-watching experience: racecourse design, broadcast craft, the photo finish, what happens after the line, comparable games, and design principles for a deterministic race that the player watches but does not control. Research only; no code was changed. Compiled 2026-10-30.*

**How to read the citations.** Each claim links its source. Sources marked *(trade press)* or *(fan/critic)* are secondary. Where a source could not be fetched, or did not say what was needed, the text says so. Notes on POST TIME's current code come from reading `packages/race-viewer/src` and `apps/web/src/components/race|results`.

---

## Executive summary

1. **Viewers find their way by landmarks, not numbers.** Real tracks place colour-coded poles counted back from the winning post (red/white quarter poles, green/white eighth poles, black/white sixteenth poles). Jockeys and race callers time their moves off those poles. A viewer should always be able to see a pole, or a label standing in for one.
2. **The main shot is a wide side-on pan with few cuts.** NBC's Derby director describes the goal as covering the race "as cleanly as possible with as few camera cuts as possible": a wide pan on the field plus a tighter shot of the battle for the first three or four places. POST TIME's continuous side-on director already follows this model.
3. **The most common viewer complaint is horses missing from the shot.** Racing Post writers and DRF columnists attack close-ups that hold only the front few runners and head-on shots held too long. A player's horse, and the rest of the field, must never disappear for long.
4. **A race call has a fixed shape.** Callers name every runner in the first 400–500 m so owners know where their horse has settled. They give fractions, flag sudden moves, and build to the line. Today POST TIME shows a one-line ticker of engine events, which is not a call.
5. **Data graphics turn movement into a story.** Tracking-led graphics (running order of the first 10, leader speed, the last three splits against par, a distance countdown) have become content that Sky Sports Racing's director says "our viewers now couldn't live without".
6. **A photo finish is a line-scan image, not a photograph.** Every pixel column is the finish line at one instant, so x is time. The judge slides a vertical line from the first nose to the second. British cameras now capture about 6,000 frames per second. Judges treat every race as a dead heat until the image shows otherwise.
7. **The wait for the verdict creates tension, but it is short.** Calls normally take seconds. A long delay (30–40 s or more) signals a very close finish. "Photograph" is announced when the margin looks under a head by eye.
8. **The result is not official until "weighed in".** The first four return to the winner's enclosure, jockeys weigh in, and then the presentation follows. POST TIME's "Sealed ✓" verification can play this beat.
9. **Races in games excite through anticipation and character more than control.** In Umamusume, players do not steer: rising commentary, skill cut-ins, a progress bar that disappears in the last spurt, and the Winning Live reward carry the race. Rival Stars and Derby King draw "repetitive" complaints when every race looks and feels the same.
10. **Close finishes are what players remember.** In the research, enjoyment peaked when a player was only *slightly* ahead, and 69% chose to replay a game they had narrowly won over one they had won easily. POST TIME should set up, show and reward closeness: the photo strip, margin language, "beaten a short head" near-miss framing, and a share card.

---

## 1. Real racecourse design: what tells a viewer where the race is

**Shape and character.** Courses are described by direction (left- or right-handed), by type, and by terrain. *Galloping* tracks have long straights and wide bends that reward stamina. *Sharp* or *turning* tracks have tight bends that reward handy, speedy horses. *Undulating* tracks and *stiff uphill finishes* add a stamina test ([geegeez course topography](https://www.geegeez.co.uk/course-topography-uphill-finishes/amp/); [Racing TV course guides](https://www.racingtv.com/racecourses)). Labels such as "L/H sharp, uphill run-in" are standard shorthand among punters.

**Dimensions from the regulator (BHA Racecourse Manual extract)** ([BHA Track Design PDF](https://www.britishhorseracing.com/wp-content/uploads/2014/03/Track-Design.pdf)):
- Minimum bend radius 135 m. Turf flat tracks are at least 22.9 m wide. The ideal circuit is at least 1m2f (2012 m).
- The ideal is "a straight allowing 5 furlongs (1006 m) and 6 furlongs (1207 m) races". Sprints are run on a straight course.
- Distances are measured "2 yards (1.8 m) from the permanent inside running rail".
- The minimum distance from a start to a bend is 1 furlong (201 m).
- **"The finish must be on the straight and not on a bend."**
- Bends are banked with super-elevation (camber), but excessive banking is "detrimental to both safety and horse welfare".
- The running rail is moved in and out ("dolling") to give fresh ground. Solid fencing stands at least 2 m behind the rail. Access points have colour-distinguished rails.
- Stalls must be movable to every flat start. Jumps courses have a separate "canter down".

**Chutes.** A chute is a straight extension that lets races start away from a bend. For example, Ellis Park's mile starts from a chute ([Wikipedia: Chute](https://en.wikipedia.org/wiki/Chute_(racecourse))). Start positions are marked by striped posts just inside the rail, often topped with a ball or block ([Penn racing glossary](https://pennhorseracing.com/glossary/category/track-terms/)).

**Distance poles.** US rules standardise the colours: quarter poles red and white, eighth (furlong) poles green and white, sixteenth poles black and white ([Illinois Admin Code 1305.220](https://ilga.gov/ftp/JCAR/AdminCode/011/011013050002200R.html)). Poles are counted **backwards from the finish**. Del Mar's article says jockeys use the 3/8 pole to ask for speed and the quarter pole for the final push. Caller Trevor Denman calls the half, quarter and eighth poles, and says the quarter pole is where "all the action happens" ([Del Mar: "The poles are where it begins and ends"](https://www.dmtc.com/media/news/the-poles-are-where-it-begins-and-ends-out-on-548)). The finish is "the wire".

**Winning post, judge and stands.** The judge's box was designed for the "judge's eye" view, directly in line with the post. Old courses moved and raised boxes when sightlines failed ([York Racecourse](https://conferenceandeventsyork.yorkracecourse.co.uk/unique-locations.html); [Papers Past 1937](https://paperspast.natlib.govt.nz/newspapers/EP19370310.2.190)). Grandstands face the run-in and line. At courses with two winning posts (Sandown), photographing the wrong post reversed a result ([Racing Post](https://www.racingpost.com/news/photo-finish-farce-confusion-reigns-after-wrong-winner-is-called-at-sandown/370006)).

**The pre-race ritual (each step is a natural "beat").** Horses go through the pre-parade and then the parade ring. Jockeys enter about 10–15 minutes before the off and talk tactics with the trainer. About 5 minutes before the off, horses leave the ring and canter to post, which takes "a few minutes" ([Jockey Club guide to raceday](https://www.thejockeyclub.co.uk/the-racing/racing-explained/days-at-races/guide-to-raceday/)). At the start, handlers check girths. The starter calls each draw. Odd-numbered stalls load first, then evens. Blindfolded horses go in first, and some are allowed to load late ([BHA: what happens at the start](https://www.britishhorseracing.com/faqs/flat-races-what-happens-when-the-horses-arrive-at-the-start/)). In US rules horses load in numerical order unless the starter decides a horse is fractious ([Ohio 3769-6-37](https://codes.ohio.gov/ohio-administrative-code/rule-3769-6-37)).

**Landmarks that tell a viewer where the race is:** the start post and stalls; the first bend; the back straight; the home turn ("turn for home"); the 3f, 2f and 1f poles; the grandstand appearing; the winning post with the judge's box and the photo-finish mirror opposite.

---

## 2. Race broadcast craft

### Camera plan

- **Main pan camera.** It is high in the stand near the line. The operator also feeds the director graphics and information ([Penn racing: Broadcasting the show](https://pennhorseracing.com/?p=16631)). NBC director Drew Esocoff: "The idea is to cover the race as cleanly as possible with as few camera cuts as possible… a wide pan camera on basically the whole field and then a tighter camera on the battle for the top three or four positions". With HD, the wide pan alone can "clearly see the whole race unfold" ([SVG 2011](https://www.sportsvideo.org/2011/06/10/nbc-belmont-reunite-for-triple-crowns-closing-act/)).
- **Tracking car.** This is a 4x4 with gyro-stabilised heads, sometimes two (wide and tight). It was "heavily favored" at the Breeders' Cup, where the producer stayed on it for at least half the race ([SVG search summary: Aerial Video Systems, Breeders' Cup](https://www.sportsvideo.org/2013/11/12/aerial-video-systems-take-to-track-skies-for-breeders-cup/?print=1)).
- **Specialist cameras** (ITV Cheltenham, 49+ cameras): a 285 m wirecam, a helmet "Jockeycam", a car tracker, a starter jib, a drone, and the "Claisse Cam" rail-level minicams that are cut into live coverage for scale, with prominent near-field hoof sound. The ultra-high-motion **finish-line camera** on the grandstand is used for frame-by-frame playback of the run-in ([SVG Europe ITV 2019](https://www.svgeurope.org/blog/headlines/staying-on-itv-sport-bolsters-horse-racing-coverage-with-new-specialist-cameras/)).
- **Kentucky Derby** (54 cameras): four 6x slow-motion cameras inside and outside the track at the finish, because "the most important thing in horse racing is obviously the finish". There are also robotic cameras in the paddock and an outrider helmet camera for the post-race interview ([SVG 2016](https://www.sportsvideo.org/2016/05/06/massive-kentucky-derby-production-like-a-super-bowl-for-nbc-sports-group/)). A cable-cam running at up to 80 mph along the backstretch was added to *convey speed*, because the main camera can be "a half mile away" ([SVG 2018](https://www.sportsvideo.org/2018/05/04/nbc-sports-adds-80-mph-aerial-camera-over-churchill-downs-backstretch-to-capture-kentucky-derby-speed/)).
- **Stewards' views:** head-on, side-on, close-up side-on, a back-straight scout camera and a rear view up the home straight ([BHA stewards' room](https://www.britishhorseracing.com/?p=23980)). Head-on is mainly an *integrity* angle.
- **Sky Sports Racing:** two live cameras on the finishing straight (close and wide), with super slow motion on the close one "for immediate analysis on race finishes" ([InsiderSport 2019](https://insidersport.com/2019/02/05/matthew-imi-sky-racing-adapting-to-industry-challenges-as-a-new-channel/)).

### When to cut, and what viewers dislike

- Viewers punish over-cutting and tight framing. Racing Post: head-on shots "for too long making it impossible to tell who is in the lead"; "too many close-ups on just the front few runners" ([Racing Post opinion](https://www.racingpost.com/news/opinion/comment/fantastic-foreign-coverage-shows-just-what-a-raw-deal-were-getting-on-tv-ab6wn7G4EjVB/)). In a five-runner race at Newmarket, "only one horse was on screen for almost all of the final furlong… That is dismal" ([Racing Post, Pearson](https://racingpost.com/news/opinion/comment/appalling-tv-camera-angles-are-infuriating-me-especially-when-studying-replays-aCN9R6V6Yh5E)).
- Woodbine's new cuts between a wide shot and a tight shot of the leaders confused viewers. One close-up of the leaders left out the eventual top three and the favourite ([DRF](https://www.drf.com/news/woodbines-modified-tv-coverage-annoying)).
- The automated director in sim racing ("BattleDirector") makes useful rules explicit: an interest score per car, gap-closing battle detection, podium fights weighted above midfield fights, a logged *reason* for every cut, and replays **held until the live battle calms** ([Steam page](https://store.steampowered.com/app/4993670)).

### The race call

- Name every runner early: "You want to name every horse in the first 400 or 500 metres to give the punter an idea of where their horse settles" (Matt Hill, Flemington) ([VRC](https://cms.vrc.com.au/latest-news/straight-talk-with-matt-hill/)).
- Callers identify positions, "point out any sudden moves", and give fractions at the quarter and half ([Wikipedia: Race caller](https://en.wikipedia.org/wiki/Race_caller)). The call should arrive at the line with the winner.
- Callers prepare by knowing which horses will "try for the front" and which come from off the pace. They track who is "coming on" and who is "all done", and each call tells a short story ([Standardbred Canada](https://standardbredcanada.ca/extract/422026/printable/print)).
- Memorable calls come from character and set phrases ("London to a brick on", "ALLLLLLL Right!") ([Wikipedia](https://en.wikipedia.org/wiki/Race_caller)).

### On-screen graphics

- **TPD in-running graphics** (Sky Sports Racing): live running order of the first 10, leader speed, the last three splits against average, and a distance countdown ([European Gaming / TPD](https://europeangaming.eu/portal/latest-news/2021/10/14/101717/racegoers-to-experience-tpds-in-running-graphics-at-qipco-british-champions-day/)). Finishing Speed % is colour-coded on air to show whether the pace was strong or weak ([geegeez](https://www.geegeez.co.uk/tag/finishing-speed/)).
- **TurfTrax/BBC** set out to "demystify" the sport with running order, distance covered and remaining, speed, sectionals, gaps and a tactical replay ([SVG Europe 2011](https://www.svgeurope.org/blog/headlines/tracking-race-horses-in-realtime/)).
- **Trakus "chiclets"** were coloured saddlecloth tiles tracking position along the bottom of the screen. Novices liked them; purists said they cost picture quality ([DRF](https://www.drf.com/news/woodbines-modified-tv-coverage-annoying)).
- Viewers also value pace data, aerial shots that show the whole field, and jockey cameras for tactics ([Advanced Television](https://www.advanced-television.com/?p=275466)).

**What makes the final furlong dramatic on TV:** tighter framing on the *battle* while keeping it readable, slow-motion finish angles held ready, near-field hoof sound, the caller's rising pitch, and a distance countdown that runs out. Many broadcasters also clean graphics off the screen in the closing stages. In Umamusume the position tracker vanishes in the final stretch on purpose ([Nook Gaming](https://www.nookgaming.com/umamusume-pretty-derby-review-nothing-to-neigh-at/); [GameTora](https://gametora.com/umamusume/race-mechanics)).

---

## 3. The photo finish

**How it works.** A line-scan (strip) camera images only the finish line, building the picture column by column, so **the horizontal axis is time**. Stationary objects become horizontal streaks, and the white background is "a continuous scan of the painted finish line". Racers can look stretched or compressed, but the order is preserved. Digital line sensors reach up to 20,000 lines per second ([Wikipedia: Photo finish](https://en.wikipedia.org/wiki/Photo_finish)). The BHA says: "Every vertical line of pixels in any of the images you see is a photograph of the winning line." New cameras installed at every British course in March 2026 capture about 6,000 frames per second ([BHA blog, 2026](https://www.britishhorseracing.com/blog-calling-the-correct-result-in-a-close-finish/)). A rural Australian track's camera runs at about 8,000 fps, and software stitches the result ([Bega District News](https://www.begadistrictnews.com.au/story/6478717/behind-the-scenes-of-determining-a-heart-stopping-race-day-photo-finish/?cs=509)).

**Mirror image.** Bertram Pearl added a mirror at the post in 1948 so the camera sees both sides of the horses. If the reflection aligns vertically with the foreground image, the camera is square to the line ([Wikipedia](https://en.wikipedia.org/wiki/Photo_finish)). Judges use it when a nose is hidden. Without one, a dead heat can be called ([search summary of BHA cases](https://www.britishhorseracing.com/blog-calling-the-correct-result-in-a-close-finish/)). RaceTech added a reverse-angle finish camera in 2019 ([SVG Europe: RaceTech 75 years](https://www.svgeurope.org/blog/headlines/racetech-celebrates-75-years-of-photo-finish-technology/)).

**The judge's reading** ([BHA blog](https://www.britishhorseracing.com/blog-calling-the-correct-result-in-a-close-finish/)):
1. When all horses have finished, the operator stops recording and immediately shows the judge.
2. If the margin looks under a head by eye, a photo is **announced on course**.
3. The judge zooms in and places a line on the leading edge of the first nose, then moves it to touch the second horse's nose. At that moment the first is already across, so it is in front. At Newmarket the gap was "only a few pixels".
4. The default is "every race is a dead heat until you have evidence that it is not".
5. The judge confirms with the stewards, then announces. Close-up images are published.
6. There is no time pressure. Getting it right comes first.

**Timing.** "Where early photo finishes meant waiting minutes, the verdict is given within seconds today" ([RaceTech via search](https://www.racetech.co.uk/?p=314)). A country-track judge says anything over 30–40 s means "very close"; the closest call took 10 minutes including a protest ([Bega District News](https://www.begadistrictnews.com.au/story/6478717/behind-the-scenes-of-determining-a-heart-stopping-race-day-photo-finish/?cs=509)). Boards show **PHOTO** while the judge works ([Wikipedia](https://en.wikipedia.org/wiki/Photo_finish)).

**Margins.** These are defined by points on the head: **nose** (tip of the muzzle to the back of the nostril), **short head** (to the front of the eye), **head** (to the back of the jawbone), **neck** (to the point of the shoulder), **½ length** (to the hip), **¾ length** (to the buttocks), **1 length** (nose to tail). Above 10 lengths, margins go in one-length steps to 99, then "99+" ([IHRB](https://www.ihrb.ie/daily-enquiries/turf-club-announce-changes-to-judges-distances)). A length is about 2.4 m (Equibase: 2.49 m). Time gaps convert to lengths with a lengths-per-second scale: 6 L/s for flat turf on good ground, 4 L/s for jumps on heavy ([Wikipedia: Horse length](https://en.wikipedia.org/wiki/Horse_length)). Japan uses ハナ/アタマ/クビ (nose/head/neck), with a nose taken as about 20 cm ([pondaichi, unofficial](https://www.pondaichi-act2.tech/hanasa-horse-racing/)).

**How broadcasters present it.** The ultra-high-motion finish-line camera gives frame-by-frame run-in replays while the judge works ([SVG Europe ITV](https://www.svgeurope.org/blog/headlines/staying-on-itv-sport-bolsters-horse-racing-coverage-with-new-specialist-cameras/)). The official print is then shown and posted. The BHA warns that phone photos of screens mislead ([BHA](https://www.britishhorseracing.com/blog-calling-the-correct-result-in-a-close-finish/)). Slow-motion video can mislead too: "separating a trio was tricky" in a Derby finish ([search summary, Citizen](https://www.citizen.co.za/sport/horses/kentucky-derby-swings-on-bing-crosbys-star)).

**In games.** No written source confirmed a dedicated photo-finish sequence in Rival Stars or Umamusume. A Mane Quest reviewer calls "a close photo finish after well-timed sprints" the most satisfying moment in Rival Stars ([Mane Quest](https://themanequest.com/blog/2020/6/21/review-rival-stars-horse-racing-desktop-edition-gorgeous-graphics-and-forgivable-flaws)). The genre is open: a real line-scan strip is an authentic visual that no competitor appears to own.

---

## 4. After the line

- **The first 30 seconds on TV.** Horses run on past the post and are pulled up. The pan stays on the leaders as they ease down. Directors cut to the slow-motion finish angle (close side-on, often 6x) for one or two replays, while the caller recaps the finishing order and margins. If there is a photo, the PHOTO status holds until the judge announces, and the frame-by-frame run-in fills the wait ([SVG 2016](https://www.sportsvideo.org/2016/05/06/massive-kentucky-derby-production-like-a-super-bowl-for-nbc-sports-group/); [InsiderSport](https://insidersport.com/2019/02/05/matthew-imi-sky-racing-adapting-to-industry-challenges-as-a-new-channel/)). The winning jockey is interviewed on horseback by a reporter wearing a helmet camera ([SVG 2016](https://www.sportsvideo.org/2016/05/06/massive-kentucky-derby-production-like-a-super-bowl-for-nbc-sports-group/)).
- **Cool-down.** Horses don't stop at once. They are walked in hand until their breathing settles, then washed down. The winner goes for a sample ([Edinburgh Reporter](https://theedinburghreporter.co.uk/2022/03/what-goes-on-behind-the-scenes-before-and-after-a-race)).
- **Winner's enclosure.** Winning and placed horses (the first four) return with their connections. Unplaced horses go to the unsaddling area. Jockeys weigh in, and *then* trophies are presented ([Jockey Club: Winners' Enclosure](https://thejockeyclub.co.uk/the-racing/racing-explained/days-at-races/winners-enclosure); [Jockey Club guide](https://www.thejockeyclub.co.uk/the-racing/racing-explained/days-at-races/guide-to-raceday/)).
- **"Weighed in, weighed in."** The result is not official until this announcement. Bets are then paid ([Jockey Club guide](https://www.thejockeyclub.co.uk/the-racing/racing-explained/days-at-races/guide-to-raceday/)). Since its wrong-post error, Sandown has a steward verify the order before the weighed-in announcement ([Racing Post](https://www.racingpost.com/news/photo-finish-farce-confusion-reigns-after-wrong-winner-is-called-at-sandown/370006)). In the US, stewards declare the race "official" after the clerk reports the weights ([Cornell LII, Conn. regs](https://www.law.cornell.edu/regulations/connecticut/Regs-Conn-State-Agencies-SS-12-574-A27)).
- **The emotion is in the return.** When welfare rules stopped winners being led in, an Irish columnist called the jockey's walk back on foot "a rather meaningless trudge" and argued that leading the horse in is "an owner's only recorded physical contact with the animal" ([Irish Field](https://www.theirishfield.ie/amp/racing/inside-racing/nick-nugent-let-the-winner-return-in-glory-270005)). For an *owner* game, this is the moment to give the player.

---

## 5. Games

### Rival Stars Horse Racing (PikPok)

What sources confirm:
- **Control is light:** steering plus a segmented sprint meter that charges faster in the horse's preferred position. Slowing down restores it ([Mane Quest review](https://themanequest.com/blog/2020/6/21/review-rival-stars-horse-racing-desktop-edition-gorgeous-graphics-and-forgivable-flaws); [Common Sense Media](https://www.commonsensemedia.org/app-reviews/rival-stars-horse-racing)). A start meter rewards stopping the cursor in the green zone ([Pocket Gamer](https://www.pocketgamer.com/rival-stars-horse-racing/rival-stars-horse-racing-tips-to-help-you-flying-out-of-the-gate/)). The usual advice is to hold the sprint for the final ~200 m ([Gamezebo](https://www.gamezebo.com/walkthroughs/rival-stars-horse-racing-guide-tips-cheats-and-strategies/)).
- **Presentation:** each track has its own intro sequence. Hiring a jockey switches to a *spectator view*. "The music and visuals make the final stretch feel important." Commentary names horses by position, and preset names are pre-recorded so the announcer can say them ([Mane Quest](https://themanequest.com/blog/2020/6/21/review-rival-stars-horse-racing-desktop-edition-gorgeous-graphics-and-forgivable-flaws); [Thumb Culture PS5](https://www.thumbculture.co.uk/rival-stars-horse-racing-ps5-review)). PikPok re-recorded commentary with a veteran racing commentator and generated names to be "commentary friendly". The art lead said the aim was "to show the beauty and power of Thoroughbred horses", because "most horse games lack visual polish" ([Mane Quest interview](https://themanequest.com/blog/2021/8/13/most-horse-games-lack-visual-polish-behind-the-scenes-of-rival-stars-horse-racing-with-art-lead-victoria-smith)).
- **Career framing:** you rebuild a family ranch after a fatal track accident, guided by a mentor, trainer and stable manager. Racing raises horse level and grade ([Mane Quest](https://themanequest.com/blog/2020/6/21/review-rival-stars-horse-racing-desktop-edition-gorgeous-graphics-and-forgivable-flaws)). The guide character mocks you after losses ([UploadVR](https://www.uploadvr.com/rival-stars-horse-racing-vr-edition-review/)).
- **Complaints:** racing is "monotonous" and "repetitive" ([PlayDay](https://playday.one/2026/04/27/rival-stars-horse-racing-review/); [Common Sense Media](https://www.commonsensemedia.org/app-reviews/rival-stars-horse-racing)). Multiplayer is uninteresting because everyone gets max-level horses ([Mane Quest](https://themanequest.com/blog/2020/6/21/review-rival-stars-horse-racing-desktop-edition-gorgeous-graphics-and-forgivable-flaws)). Players came for breeding more than racing, and PikPok reprioritised ([Mane Quest interview](https://themanequest.com/blog/2021/8/13/most-horse-games-lack-visual-polish-behind-the-scenes-of-rival-stars-horse-racing-with-art-lead-victoria-smith)).
- **Not confirmed in writing:** the exact chase-camera behaviour, any finish-line slow motion, or a photo-finish sequence. Check these by playing before citing them.

**Principles to take (not copy):** commentary that can say *your horse's name* is a major ownership hook. Spend art budget on how the horse looks in motion. Each track should have a signature intro. Visual polish alone does not stop races feeling repetitive; races need variety in their *shape*.

### Umamusume: Pretty Derby (Cygames)
- **The player watches; strategy is chosen beforehand** ([GamingOnPhone](https://gamingonphone.com/reviews/umamusume-pretty-derby-game-review)). The structure is fixed: early race (first sixth), mid race, late race, last spurt (final sixth). A top progress bar has phase ticks and **disappears near the last spurt**. On-screen indicators flag late starts, rushing and duels for the lead ([GameTora](https://gametora.com/umamusume/race-mechanics)).
- **Tension:** "anticipation of reaching the final corner with a mix of fear and excitement… commentators' energy reaches a fever pitch by the end". Skill animations ("ultimates") fire when their conditions are met ([Nook Gaming](https://www.nookgaming.com/umamusume-pretty-derby-review-nothing-to-neigh-at/)). One critic: "race cutscenes that had no business being as hype as they are" ([search summary of Game8 review](https://game8.co/articles/reviews/7757)).
- **Reward after the line:** the Winning Live idol performance. Many players skip it, and races can be skipped to results ([Nook Gaming](https://www.nookgaming.com/umamusume-pretty-derby-review-nothing-to-neigh-at/)).
- **Principles:** visible *moments* tied to the horse's traits (a "kick" fires, a duel for the lead) make a simulation feel authored. Remove UI at the climax. Escalate the commentary. A post-race reward ritual must be skippable.

### Others, briefly
- **Derby King / Photo Finish Horse Racing (Third Time Games):** six-horse races, a start-timing mini-game and whip timing that drains energy. Reviewers praise the "real race-day atmosphere" but find the races "very boring very quickly" with only three race types per tier ([GameGrin](https://gamegrin.com/reviews/derby-king-quest-for-the-triple-crown-review)). Store reviewers dislike "YOU LOST!" shown for 2nd place ([App Store](https://apps.apple.com/us/app/id993764346)). Lesson: **frame placings with dignity.**
- **ZED RUN:** moved from results with no animation to "live, 3D races" on a stylised floating track, streamed on site and on Twitch, with replays from the results tab ([Consensys](https://consensys.io/blog/zed-run-the-future-of-horse-breeding-and-racing); [ZED beta](https://medium.com/@zed_run/zed-beta-racing-726bb73f05e7)). Adding animation was itself treated as the upgrade. The game is now listed as abandoned ([games.gg](https://games.gg/ja/zed-run/)).
- **Winning Post 9/10 (Koei Tecmo):** markets "dramatically evolved racing scenes" that blend realism with game camera work, and builds **rival matches** around named opposing horses and connections ([Siliconera](https://siliconera.com/?p=750421); [Gematsu](https://gematsu.com/2022/12/winning-post-10-first-details-screenshots)). Lesson: recurring rivals give a watched race stakes.
- **Football Manager:** kept text-only commentary alongside 2D and 3D views for players who prefer it ([PC Gamer](https://pcgamer.com/preview-why-football-manager-2011-will-score-big)). Lesson: let players choose how much race they watch.

---

## 6. What keeps a watched, deterministic race exciting

- **Close and uncertain outcomes drive enjoyment.** Enjoyment peaked when players were *slightly* ahead, and 69% chose to replay a narrowly won game over an easily won one ([BPS Research Digest](https://www.bps.org.uk/research-digest/why-risk-losing-more-fun-easy-win)). Perceived suspense differs from actual uncertainty, so *presentation* can raise suspense ([search summary, Econ Inquiry](https://zendy.io/title/10.1111/ecin.12462)).
- **Anticipation before the off.** The ritual of parade, going to post and loading is a slow build that broadcasts fill on purpose. Esocoff calls a big race "a two-hour show with a two-minute payoff" ([SVG 2011](https://www.sportsvideo.org/2011/06/10/nbc-belmont-reunite-for-triple-crowns-closing-act/)).
- **Knowing where your horse is.** Callers name every runner early for exactly this reason ([VRC](https://cms.vrc.com.au/latest-news/straight-talk-with-matt-hill/)). Chiclets and tiles help newcomers ([DRF](https://www.drf.com/news/woodbines-modified-tv-coverage-annoying)).
- **Moments of hope.** "Coming on" versus "all done" ([Standardbred Canada](https://standardbredcanada.ca/extract/422026/printable/print)), a gap opening, a kick, a duel for the lead ([GameTora](https://gametora.com/umamusume/race-mechanics)).
- **A reason for every shot**, and replays that never step on live action ([BattleDirector](https://store.steampowered.com/app/4993670)).
- **A ritual after the line:** a confirmation beat ("weighed in"), placings honoured, the owner's moment, then the replay and the share.

---

## Where POST TIME stands today (from the code)

- **Director** (`packages/race-viewer/src/director.ts`): side-on only, never cuts, spring-eased framings (`gate`, `close`, `pack`, `judge`, `post`, `wide`). It shows the player's horse at least every 10 s, reacts to `move`/`kick`/`lead_change`, and favours the leaders in the final 201 m. This matches Esocoff's "few cuts" model.
- **Trackside scene:** draws a furlong pole every furlong, a winning post and a course-specific grandstand. Poles do not appear to be numbered or colour-coded by distance.
- **Commentary:** a single-line `Ticker` of engine events (`start`, `slow_start`, `kick`, `boxed_in`, `tiring`, `lead_change`, `final_furlong`, `move`, `photo_finish`, `finish`). There is no structured call, no "name every runner" pass and no fractions.
- **Finish:** a `PHOTO` stamp. On a photo, playback re-runs from about 14 m out with a "PHOTO REPLAY" badge. Then `ResultsCard`, `PhotoFinishCard` (margin phrase such as "by a short head"), `ResultsSequence` (board, reward count-up, Why card), `ShareReplay` and the "Sealed ✓" fairness panel.
- **Pre-race:** a countdown. There is no parade, canter to post or stall-loading beat.

---

## Design principles for POST TIME

1. **Always show how far is left.** At every moment of a race, a distance marker (pole or label) or a distance-to-go readout is visible. Test: in screenshots sampled every 2 s of a replay, 100% show one.
2. **Poles count down to the line and are colour-coded by distance.** Show 1f, 2f and 3f labels at least, the 1f pole distinct (green/white style) and the quarter pole distinct (red/white style), all measured from the post.
3. **The finish is always on a straight**, with at least 1f of visible run-in, and the grandstand and judge's box read clearly at the post. Test: course geometry check.
4. **The player's horse is never out of frame for more than N seconds** (currently 10). In the final 400 m it is never out of frame unless it is beaten more than about 10 lengths. In that case an inset shows it.
5. **The camera never holds only the leader when the race is close.** In the final furlong, the shot includes every horse within 2 lengths of the lead. Test: assert on framing against the field.
6. **Wide by default, tight by exception.** At least 50% of race time uses a framing that shows the front half of the field, and no tight framing lasts longer than about 8 s.
7. **The call names every runner within the first 20–25% of the race** (the "first call"), in running order, with the player's horse called by name.
8. **Every director change has a logged reason** (event, battle, my horse unseen) that tests can assert.
9. **Commentary escalates.** Each phase (break, settled, mid race, turn for home, 2f, 1f, finish) has its own lines, and the final 200 m uses short, high-energy phrases. Test: phase coverage, and no phase is silent for more than 6 s.
10. **"Moments of hope" are visible.** When the player's horse gains two or more places or closes the gap to the leader by a length or more within 3 s, the call, the HUD and the framing all acknowledge it within 1 s.
11. **Gaps read in lengths, not metres**, using the official lengths-per-second scale for surface and going, with nose, short head, head and neck vocabulary under one length.
12. **Clear the screen for the climax.** Below about 150 m to go, the HUD reduces to running order (top 4 plus mine) and the distance, and the course map and other panels fade.
13. **A photo is called only when it is close.** When the margin between first and second is under a head (about 0.2 L), the viewer shows PHOTO within 1 s of the line. Above a neck, it never does.
14. **The photo finish is a line-scan strip.** It is rendered from the deterministic crossing times (x = time, a vertical judge's line, both noses visible, a mirror strip optional). The margin call follows 3–8 s after the line in a normal photo and up to about 15 s in a dead-heat-close one, and never longer than the slow-motion replay that fills the wait.
15. **A dead heat is possible and celebrated**, if the engine supports it: the judge's default is a dead heat until the image proves otherwise.
16. **The result becomes "official" with a visible beat** ("Weighed in · Sealed ✓") *before* credits count up, so verification feels like ritual rather than paperwork.
17. **The first 30 seconds after the line follow a script:** pull-up and ease down (live), then a slow-motion finish replay (about 6 s), then the photo verdict or official order, then the winner's walk back, then rewards. The player can skip each step.
18. **Every placing gets dignified framing.** No "YOU LOST". Second is "beaten a short head", fourth is "placed, returns to the enclosure", and an unplaced horse gets one sentence on why.
19. **Replays never compete with live action.** A replay starts only after the live race (or the live battle) is over.
20. **Anticipation comes before the off.** Every live race has at least a 30–60 s pre-race sequence: field on show, going to post, stall loading in draw order (odds then evens). The player's horse gets a named moment in it.
21. **Each course has a signature look and an intro shot** (shape, direction, character such as "sharp, uphill finish"), so races do not feel identical.
22. **The race shape is legible.** The viewer can tell front-runners from closers within the first 25% of the race, through the call and a "where they settled" graphic.
23. **Sharing captures the climax.** One tap produces a still (photo strip or finish frame) or a short clip of the last 200 m with the margin text, and it never reveals a result before the broadcast has shown it (no-spoiler rule).
24. **Watching stays optional and cheap.** There is a "just the finish" mode (last 2f plus the photo) and a results-only mode, as with Umamusume's skip and FM's text-only commentary.

---

## Prioritised improvements

| # | What | Why | Effort |
|---|------|-----|--------|
| 1 | **A real race call.** Replace the single event ticker with a phase-structured commentary script: break, "first call" naming all runners in order, fractions at 2f/4f, moves, turn for home, 2f, 1f, the finish line, margin recap. It is generated deterministically from replay events and positions. Optional text-to-speech later. | Callers name every runner early so owners know where their horse is. Commentary escalation drives tension in Umamusume and Rival Stars. This is the biggest gap. | M |
| 2 | **Line-scan photo-finish strip.** Render a synthetic strip from each horse's crossing time (x = time), with the judge's line and a margin label. Show PHOTO, hold for 3–8 s over the slow-motion replay, then reveal. Reuse it as the share image on `PhotoFinishCard`. | Authentic, recognisable, cheap to make deterministic, and unused by competitors. Turns close finishes into the moment players remember. | M |
| 3 | **Readable distance landmarks.** Numbered, colour-coded poles (3f/2f/1f, and the quarter pole), "turn for home" and a distinct winning post with judge's box, plus a big distance-to-go readout. Clear the HUD in the final 150 m. | Poles are how jockeys, callers and viewers know where the race is. A low-cost gain in readability. | S |
| 4 | **Gaps in lengths and a "battle" graphic.** In the top bar, show gaps in lengths (lengths-per-second scale) and highlight a live duel ("2 in it", "my horse closing, ¾ L"). | TPD and TurfTrax graphics "demystify" the race and give hope moments. | S |
| 5 | **A post-line script.** Live ease-down, then a slow-motion finish replay, then the verdict, then a "Weighed in · Sealed ✓" beat, then the existing reward count-up and Why card. Add placed-horse framing ("beaten a neck"). | Mirrors the first 30 seconds on TV. Makes "official" a ritual. Avoids "YOU LOST" style complaints. | S–M |
| 6 | **Director rules from broadcast critique.** In the final furlong, keep all horses within 2 L of the lead in frame. Log a reason for each change. Add an inset for the player's horse when it is far back. Hold replays until the battle is over. | The most common viewer complaint is horses missing from the shot. | S |
| 7 | **Pre-race sequence.** 30–60 s: the field walking (parade) with form chips, the player's horse highlighted, canter to post, stall loading odds then evens with a gate-shot hold, and "they're off". | Anticipation is half the product ("two-hour show, two-minute payoff"). It also gives live viewers a natural "your race is starting" window. | M |
| 8 | **Course identity.** Each course gets a sharp/galloping, left/right-handed and uphill-finish profile that is visible in the course map and on the race card, plus an intro flyover or establishing shot. | Fights "every race feels the same" (Rival Stars, Derby King). Teaches players why course suits matter. | M |
| 9 | **Rivals and stakes.** Show named recurring rivals (the player's "nemesis" or a house-stable star) in the pre-race card and call them in commentary ("…and the old rival is on her heels"). | Winning Post builds whole races around rivals. Stakes make a watched race personal. | M |
| 10 | **Owner's moment in the winner's enclosure.** A short pixel vignette with the horse led in, a rosette, a photo with the trophy, and a shareable still. Placed horses (2nd–4th) get a smaller version. | Leading in is "an owner's only recorded physical contact with the animal". It fits an ownership game. | M–L |
| 11 | **Finish-only and results-only viewing modes** for repeat or low-interest races, as an extension of the existing watch options. | Respects time and keeps the full broadcast special. | S |
| 12 | **Sectional and pace post-race graphic.** Furlong splits, a finishing-speed-style "pace was strong/weak" badge and a replay of where the race was won. | Turns results into learning and supports the "Your decisions show" pillar. | M |
| 13 | **Rail-level effect shot or speed shot** (a parallax foreground layer with hoof sound) cut in once per race, mid race. | The ITV "Claisse Cam" and NBC's 80 mph cable-cam exist to convey speed, which side-on pixel views can lack. | M |
| 14 | **Short shareable clip** of the last 200 m plus the photo strip, with the no-spoiler gate. | Sharing is an acquisition loop. The photo strip is the natural thumbnail. | L |

---

*Source count: 67 distinct URLs cited above. Gaps: no primary source documents Rival Stars' camera or finish behaviour in detail, or Umamusume's camera plan; check both by playing before building on them. Several fetches failed (BHA pages via proxy, At The Races, Gravity Media); claims from search-result summaries are marked "search summary".*
