import json, os
BASE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(BASE + "/themes_counts.json"))
NAMES = {
 "Steam 1166860 english": ("Rival Stars Horse Racing: Desktop Edition", "Steam", "https://steamcommunity.com/app/1166860/reviews/?browsefilter=mostrecent"),
 "Apple 1215477266 Rival Stars Horse Racing": ("Rival Stars Horse Racing (mobile)", "App Store US", "https://apps.apple.com/us/app/id1215477266"),
 "Steam 2937440 english": ("Rival Stars Horse Racing: VR Edition", "Steam", "https://steamcommunity.com/app/2937440/reviews/?browsefilter=mostrecent"),
 "Apple 6504777327 Photo Finish LIVE": ("Photo Finish LIVE", "App Store US", "https://apps.apple.com/us/app/id6504777327"),
 "Apple 1275199710 Horse Racing Manager 2026": ("Horse Racing Manager 2026 (Third Time)", "App Store US", "https://apps.apple.com/us/app/id1275199710"),
 "Steam 2740170 english": ("Horse Racing Manager (Sheep Meadow Road Games, Early Access)", "Steam", "https://steamcommunity.com/app/2740170/reviews/?browsefilter=mostrecent"),
 "Steam 978960 english": ("Starters Orders 7 Horse Racing", "Steam", "https://steamcommunity.com/app/978960/reviews/?browsefilter=mostrecent"),
 "Steam 1474740 english": ("Horse Tales: Emerald Valley Ranch", "Steam", "https://steamcommunity.com/app/1474740/reviews/?browsefilter=mostrecent"),
 "Steam 1938050 english": ("Unbridled: That Horse Game", "Steam", "https://steamcommunity.com/app/1938050/reviews/?browsefilter=mostrecent"),
 "Steam 1518820 english": ("Horse Club Adventures", "Steam", "https://steamcommunity.com/app/1518820/reviews/?browsefilter=mostrecent"),
 "Apple 1468871996 Equestrian the Game": ("Equestrian the Game", "App Store US", "https://apps.apple.com/us/app/id1468871996"),
 "Apple 1445695988 Star Stable Online": ("Star Stable Online (mobile)", "App Store US", "https://apps.apple.com/us/app/id1445695988"),
 "Apple 684830457 Howrse": ("Howrse (mobile)", "App Store US", "https://apps.apple.com/us/app/id684830457"),
 "Apple 6480433538 Umamusume Pretty Derby": ("Umamusume: Pretty Derby", "App Store US", "https://apps.apple.com/us/app/id6480433538"),
 "Apple 6751256352 Pocket Horse Racing Champions": ("Pocket Horse: Racing Champions", "App Store US", "https://apps.apple.com/us/app/id6751256352"),
 "Steam 655610 english": ("Horse Racing 2016", "Steam", "https://steamcommunity.com/app/655610/reviews/?browsefilter=mostrecent"),
}
TH = ["graphics_praise","graphics_complaint","horses_look_same","coat_colour_pattern","breeding_genetics_foal","mane_tail_body","animation_movement","race_repetitive","camera","crowd_commentary_sound","ownership_bond","stable_customisation","ui_complexity","performance_bugs","monetisation"]
print("| Game | Source | Reviews read (newest .. oldest) | Neg. | " + " | ".join(TH) + " |")
print("|" + "---|" * (4 + len(TH)))
for r in rows:
    if r["game"] not in NAMES: continue
    n, src, url = NAMES[r["game"]]
    cells = [f"{r[t][0]}/{r[t][1]}" for t in TH]
    print(f"| [{n}]({url}) | {src} | {r['n']} ({r['newest']} .. {r['oldest']}) | {r['neg']} | " + " | ".join(cells) + " |")
