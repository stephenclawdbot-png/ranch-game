"""Keyword-theme counts over real reviews (Steam community + Apple RSS). Prints counts per game/theme
(split into negative = Steam 'Not Recommended' or Apple <=3 stars, positive otherwise) and writes excerpts
(verbatim, with link/date) for manual reading."""
import json, re, glob, os, sys, collections
BASE = os.path.dirname(os.path.abspath(__file__))
THEMES = {
 "graphics_praise": r"\b(graphics|visuals?)\b.{0,40}\b(beautiful|gorgeous|stunning|amazing|great|good|realistic|pretty|nice|awesome)|\b(beautiful|gorgeous|stunning|amazing|great|realistic|pretty)\b.{0,25}\b(graphics|visuals?)\b",
 "graphics_complaint": r"\b(graphics|visuals?)\b.{0,40}\b(bad|dated|old|ugly|poor|outdated|terrible|awful|meh|low|blurry)|\b(ugly|outdated|dated)\b",
 "horses_look_same": r"(all|they) (look|looked) (the )?(same|alike|identical)|same (looking )?horses?|identical horses?|look (the )?same|lack of variety|no variety|more variety",
 "coat_colour_pattern": r"\b(coats?|colou?rs?|patterns?|markings?|dapples?|roan|pinto|paint|appaloosa|leopard|palomino|buckskin|cremello|dun|tobiano|sabino|piebald|brindle)\b",
 "breeding_genetics_foal": r"\b(breed(ing)?|genetics?|genes?|foals?|offspring|inherit|bloodlines?|pedigree)\b",
 "foal_resemblance": r"foals?.{0,80}(look like|inherit|resembl|parents?)|(parents?).{0,60}foals?",
 "realistic_horse": r"realistic (horse|horses|look|movement|animation)|horses? (look|looks|are) (so )?(realistic|real|lifelike)|lifelike|anatomy|proportions?|conformation",
 "mane_tail_body": r"\b(manes?|tails?|forelock|feathers?|feathering|muscles?|body type|build)\b",
 "animation_movement": r"\b(animations?|animated|gallop(s|ing)?|canter|trot|stride|legs?|movements?|moves|stiff|clunky|janky|smooth|motion capture|mocap)\b",
 "jockey_rider": r"\b(jockeys?|riders?)\b",
 "race_repetitive": r"repetit|same races?|boring|grind|grindy|tedious|monoton",
 "camera": r"\bcamera\b|\bcam\b|angle",
 "photo_finish_close": r"photo finish|close finish|neck and neck|nail.?biter|by a nose",
 "crowd_commentary_sound": r"\b(crowd|commentary|commentator|announcer|sound|music|audio)\b",
 "track_environment_weather": r"\b(tracks?|scenery|environments?|weather|rain|lighting|courses?|maps?|locations?|world)\b",
 "ownership_bond": r"\bbond(ing)?\b|attached|my (own )?horses?|favou?rite horse|love (my|these|the) horses?|name (my|your|the) horses?|naming",
 "stable_customisation": r"\b(customi[sz](e|ation|ing)|decorat|stables?|barn|ranch|tack|saddle|outfit)\b",
 "photo_mode_share": r"photo mode|screenshots?|take (pictures|photos)|camera mode|share",
 "ui_complexity": r"\b(ui|interface|menus?|confusing|cluttered|overwhelm|complicated|tutorial|hard to understand)\b",
 "performance_bugs": r"\b(lag|laggy|crash(es|ing)?|fps|frame ?rate|loading|load times?|freez|battery|overheat|hot|bugs?|buggy|glitch(es|y)?|stutter)\b",
 "monetisation": r"pay to win|p2w|paywall|expensive|\bads\b|microtransaction|in-app|gems|money grab|cash grab",
 "desktop_updates_lag": r"updates?.{0,60}(mobile|phone)|(mobile|phone).{0,60}updates?",
}
NEG = lambda r: (r.get("recommended") is False) or (r.get("rating") is not None and r["rating"] <= 3)

def load():
    games = {}
    for f in glob.glob(BASE + "/steam/*.json"):
        d = json.load(open(f)); revs = d["reviews"]
        if not revs: continue
        for r in revs: r["src"] = "Steam"; r["link"] = r["url"]
        games[f"Steam {d['appid']} {d['lang']}"] = revs
    for f in glob.glob(BASE + "/apple/*.json"):
        d = json.load(open(f)); revs = d["reviews"]
        for r in revs:
            r["src"] = "App Store"; r["text"] = (r["title"] + ". " + r["text"]); r["posted"] = r["updated"][:10]
            r["link"] = f"https://apps.apple.com/us/app/id{d['appid']}?see-all=reviews (review id {r['id']})"
        games[f"Apple {d['appid']} {d['name']}"] = revs
    return games

games = load()
rows = []; excerpts = collections.defaultdict(list)
for g, revs in sorted(games.items()):
    n = len(revs); neg = sum(1 for r in revs if NEG(r))
    dates = [r.get("posted") for r in revs if r.get("posted")]
    line = {"game": g, "n": n, "neg": neg, "newest": dates[0] if dates else None, "oldest": dates[-1] if dates else None}
    for t, rx in THEMES.items():
        c = re.compile(rx, re.I)
        hits = [r for r in revs if c.search(r["text"] or "")]
        line[t] = (len(hits), sum(1 for r in hits if NEG(r)))
        for r in hits:
            m = c.search(r["text"]); s = max(0, m.start() - 160); e = min(len(r["text"]), m.end() + 200)
            excerpts[(g, t)].append({"neg": NEG(r), "posted": r.get("posted"), "link": r["link"], "excerpt": r["text"][s:e], "len": len(r["text"])})
    rows.append(line)
json.dump(rows, open(BASE + "/themes_counts.json", "w"), indent=1)
json.dump({f"{k[0]} || {k[1]}": v for k, v in excerpts.items()}, open(BASE + "/themes_excerpts.json", "w"), ensure_ascii=False, indent=0)
ths = list(THEMES)
for line in rows:
    print(f"\n## {line['game']}  n={line['n']} neg={line['neg']} {line['newest']} .. {line['oldest']}")
    print("  " + "  ".join(f"{t}={line[t][0]}/{line[t][1]}neg" for t in ths if line[t][0]))
