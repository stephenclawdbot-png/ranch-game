"""Apple App Store customer reviews via the public iTunes RSS feed (US store, most recent, up to 10 pages x 50)."""
import json, sys, subprocess, os, time
OUT = os.path.dirname(os.path.abspath(__file__)) + "/apple"
os.makedirs(OUT, exist_ok=True)
def curl(u):
    return subprocess.run(["curl", "-sS", "--max-time", "40", u], capture_output=True, text=True).stdout
for arg in sys.argv[1:]:
    appid, name = arg.split(":", 1)
    revs = []
    for p in range(1, 11):
        t = curl(f"https://itunes.apple.com/us/rss/customerreviews/page={p}/id={appid}/sortby=mostrecent/json")
        try:
            d = json.loads(t)
        except Exception:
            break
        es = d.get("feed", {}).get("entry", [])
        if isinstance(es, dict): es = [es]
        es = [e for e in es if "im:rating" in e]
        if not es: break
        for e in es:
            revs.append({"id": e["id"]["label"], "rating": int(e["im:rating"]["label"]), "version": e.get("im:version", {}).get("label"),
                         "updated": e.get("updated", {}).get("label"), "title": e["title"]["label"], "text": e["content"]["label"],
                         "author": e["author"]["name"]["label"]})
        time.sleep(0.3)
    json.dump({"appid": appid, "name": name, "fetched": time.strftime("%Y-%m-%d"), "reviews": revs}, open(f"{OUT}/{appid}.json", "w"), ensure_ascii=False)
    print(appid, name, len(revs), revs[-1]["updated"][:10] if revs else "", flush=True)
