"""Scrape public Steam community user reviews (most recent first) via the app hub's
infinite-scroll endpoint. Store appreviews API is blocked from this container (302)."""
import json, sys, time, os, re, html, subprocess, urllib.parse
OUT = os.path.dirname(os.path.abspath(__file__)) + "/steam"
os.makedirs(OUT, exist_ok=True)

def curl(url):
    return subprocess.run(["curl", "-sS", "--max-time", "40", url], capture_output=True, text=True).stdout

def parse(t, appid):
    out = []
    for c in t.split('apphub_Card ')[1:]:
        m = re.search(r'data-modal-content-url="(https://steamcommunity.com/(?:profiles|id)/[^"]+/recommended/\d+/)"', c)
        rec = ('Not Recommended' not in c) and ('おすすめしません' not in c)
        hrs = re.search(r'([\d,.]+) hrs on record', c)
        date = re.search(r'Posted: ([^<]+)<', c)
        body = re.search(r'<div class="apphub_CardTextContent">(.*?)</div>\s*</div>', c, re.S)
        txt = body.group(1) if body else ''
        txt = re.sub(r'<div class="date_posted">.*?</div>', '', txt, flags=re.S)
        txt = html.unescape(re.sub(r'\s+', ' ', re.sub('<[^>]+>', ' ', txt))).strip()
        helpful = re.search(r'(\d[\d,]*) (?:people|person) found this review helpful', c)
        out.append({"url": m.group(1) if m else None, "recommended": rec,
                    "hours": hrs.group(1) if hrs else None,
                    "posted": date.group(1).strip() if date else None,
                    "helpful": helpful.group(1) if helpful else "0", "text": txt})
    return out

def fetch(appid, lang, maxpages):
    allr = []; seen = set()
    params = {"userreviewsoffset": 0, "p": 1, "numperpage": 10, "browsefilter": "mostrecent", "appid": appid,
              "appHubSubSection": 10, "l": lang, "filterLanguage": "default", "searchText": "", "forceanon": 1}
    for page in range(1, maxpages + 1):
        t = curl(f"https://steamcommunity.com/app/{appid}/homecontent/?" + urllib.parse.urlencode(params))
        revs = parse(t, appid)
        new = [r for r in revs if r["url"] not in seen]
        if not new: break
        for r in new: seen.add(r["url"])
        allr += new
        # continue form: hidden inputs
        form = dict(re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', t))
        if not form: break
        params.update(form)
        time.sleep(0.4)
    return allr

def summary(appid):
    t = curl(f"https://store.steampowered.com/app/{appid}/?l=english&cc=us")
    s = re.findall(r'<span class="game_review_summary[^"]*"[^>]*>([^<]+)</span>\s*(?:<span class="responsive_hidden">\s*\(([\d,]+)\)|)', t)
    tip = re.findall(r'data-tooltip-html="([^"]*?of the [\d,]+ user reviews[^"]*?)"', t)
    rel = re.search(r'<div class="date">([^<]+)</div>', t)
    name = re.search(r'<div id="appHubAppName" class="apphub_AppName">([^<]+)<', t)
    return {"name": name.group(1) if name else None, "summaries": s[:3], "tooltips": [html.unescape(x) for x in tip[:3]], "release": rel.group(1) if rel else None}

for arg in sys.argv[1:]:
    appid, lang, pages = (arg.split(":") + ["30"])[:3]
    s = summary(appid)
    r = fetch(appid, lang, int(pages))
    json.dump({"appid": appid, "lang": lang, "fetched": time.strftime("%Y-%m-%d"), "summary": s, "reviews": r},
              open(f"{OUT}/{appid}_{lang}.json", "w"), ensure_ascii=False, indent=0)
    print(appid, lang, s["name"], s["release"], s["tooltips"][:2], len(r), flush=True)
