"""Specific concerns/desires: count distinct reviews (one review per account per game) across all collected sources,
and print up to 3 verbatim excerpts each (newest first) for the report."""
import json, re, glob, os, sys
BASE = os.path.dirname(os.path.abspath(__file__))
P = {
 "C01 repetitive races / grind": r"repetit|same races? over|grind(y|ing)?\b|tedious|monoton|gets? boring|boring after",
 "C02 monetisation gates looks (coats/breeds behind paywall)": r"(coats?|colou?rs?|breeds?|horses?).{0,80}(pay|paywall|gold|coins|gems|money|expensive|\$\d+)|(pay|paywall|expensive|\$\d+).{0,80}(coats?|colou?rs?|breeds?)",
 "C03 wants more breeds / breed-true looks": r"more (horse )?breeds|new breeds|add (the )?(friesians?|dutch warmbloods?|clydesdales?|shires?|breeds?)|friesian|breeds? (all )?(look|feel) (the )?same",
 "C04 horses look the same / need visual variety": r"(all|they|horses) (look|looked) (the )?(same|alike|identical)|lack of variety|no variety|more variety|look the same",
 "C05 breeding outcome feels unfair/opaque (stats)": r"breed(ing)?.{0,120}(average|lower stats|worse|odds|chance|luck|rng|never get)",
 "C06 genetics realism (colour inheritance wrong / wants realistic genetics)": r"(realistic|real|accurate) (colou?r )?genetics|genetics (make|makes) (no|zero) sense|genetics.{0,40}(realistic|accurate|wrong)|how .{0,20}genetics work",
 "C07 wants more coats/patterns/markings": r"more (coats?|colou?rs?|patterns?|markings?)|(new|rare) (coats?|colou?rs?|patterns?)|appaloosa|pinto|dapple|roan|buckskin|palomino",
 "C08 mane/tail realism or styling": r"\b(manes?|tails?|forelock|braid)",
 "C09 animation realism (gaits, legs, stiffness)": r"(animation|gait|gallop|canter|trot|legs?|movement)s?.{0,60}(stiff|clunky|janky|weird|awkward|unrealistic|realistic|smooth|limp|accurate)",
 "C10 camera complaints / wants camera options": r"\bcamera\b|helmet cam|jockey cam|camera (angle|view)s?",
 "C11 commentary / announcer": r"commentat|announcer|commentary",
 "C12 photo mode / screenshots / share": r"photo ?mode|screenshot|take (pictures|photos)|share (my|the) horses?",
 "C13 bond / care / interaction with horse": r"\bbond(ing)?\b|interact with (my|the) horses?|pet (my|the) horse|groom(ing)?|care for",
 "C14 stable/ranch customisation & decoration": r"decorat|customi[sz]e (my|the|your) (stable|barn|ranch)|stable (customi|design|decor)|ranch (customi|design|building)",
 "C15 tack / outfits customisation": r"\btack\b|saddles?|bridles?|outfits?|clothing",
 "C16 UI clunky / overwhelming / confusing": r"\bui\b|interface|menus?|confusing|cluttered|overwhelm|hard to (navigate|understand)|no tutorial|tutorial",
 "C17 performance / crashes / loading": r"\blag(gy)?\b|crash(es|ing)?|fps|frame ?rate|loading|load times?|freez|stutter|overheat|battery",
 "C18 bugs / glitches": r"\bbugs?\b|buggy|glitch",
 "C19 desktop/console version lags mobile updates": r"updates?.{0,80}(mobile|phone)|(mobile|phone).{0,80}updates?|abandon",
 "C20 wants realistic racing (close finishes, tactics)": r"photo finish|close finish|neck and neck|realistic (racing|races)|tactic",
 "C21 wants horse ageing / lifecycle / retirement": r"\bage(s|ing)?\b|retire|old age|lifespan|die(s|d)?\b",
 "C22 foals: raising, appearance, reveal": r"\bfoals?\b",
 "C23 skip/auto races wanted": r"skip (the )?races?|auto ?race|sim(ulate)? races?|skip button",
 "C24 environment/tracks/locations variety": r"(more|new|different) (tracks?|courses?|locations?|maps?|environments?)|scenery",
 "C25 realistic-looking horses praised": r"horses? (look|looks|are) (so )?(realistic|real|lifelike|beautiful|gorgeous|pretty|stunning)|realistic horses?|beautiful horses?|gorgeous horses?|pretty horses?",
 "C26 graphics dated/poor": r"(graphics|visuals?).{0,40}\b(bad|dated|old|ugly|poor|outdated|terrible|awful|meh)\b|\boutdated\b",
 "C27 jockeys (wants/complaints)": r"\bjockeys?\b",
 "C28 weather / lighting / time of day": r"\bweather\b|\brain\b|day ?night|lighting|sunset",
 "C29 finding/following my horse in race": r"(find|see|follow|spot|lose|lost) (track of )?my horse|which (one|horse) is mine",
 "C30 crowd/atmosphere": r"\bcrowd\b|atmosphere",
 "C31 genetics/coat praised": r"(genetics|coats?|colou?rs?|breeding).{0,40}(amazing|awesome|great|love|stellar|realistic|fun|cool)",
}
NEG = lambda r: (r.get("recommended") is False) or (r.get("rating") is not None and r["rating"] <= 3)
revs = []
for f in glob.glob(BASE + "/steam/*.json"):
    d = json.load(open(f))
    if d["lang"] != "english": continue
    for r in d["reviews"]:
        revs.append({"game": f"steam:{d['appid']}", "text": r["text"], "neg": NEG(r), "date": r["posted"], "link": r["url"]})
for f in glob.glob(BASE + "/apple/*.json"):
    d = json.load(open(f))
    if d["appid"] == "6480433538": continue  # Umamusume: not a horse-appearance game
    for r in d["reviews"]:
        revs.append({"game": f"apple:{d['appid']}", "text": r["title"] + ". " + r["text"], "neg": NEG({"rating": r["rating"]}), "date": r["updated"][:10], "link": f"https://apps.apple.com/us/app/id{d['appid']} (review {r['id']})"})
print("total reviews", len(revs))
out = []
for k, rx in P.items():
    c = re.compile(rx, re.I)
    hits = [r for r in revs if c.search(r["text"])]
    games = sorted(set(r["game"] for r in hits))
    out.append((k, len(hits), sum(1 for r in hits if r["neg"]), games, hits))
for k, n, neg, games, hits in out:
    print(f"\n## {k}: {n} reviews ({neg} negative) across {len(games)} games: {', '.join(games)}")
    if len(sys.argv) > 1:
        for r in sorted(hits, key=lambda r: -len(r['text']))[:int(sys.argv[1])]:
            m = c = re.compile(P[k], re.I).search(r["text"]); s = max(0, m.start() - 120); e = min(len(r["text"]), m.end() + 160)
            print(f"  - [{r['game']}] {r['date']} {'NEG' if r['neg'] else 'pos'} {r['link']}\n    …{r['text'][s:e]}…")
