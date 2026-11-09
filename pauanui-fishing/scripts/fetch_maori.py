#!/usr/bin/env python3
"""Rebuild data/maori.json from the fishing.net.nz Māori fishing calendar (one POST per month).
Usage: python3 scripts/fetch_maori.py 2026 2028   (inclusive years)"""
import json, re, sys, time, urllib.parse, urllib.request
MON = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}
y0, y1 = int(sys.argv[1]), int(sys.argv[2])
out = {}
for y in range(y0, y1 + 1):
    for m in range(1, 13):
        req = urllib.request.Request("https://www.fishing.net.nz/fishing-advice/maori-fishing-calendar/",
            data=urllib.parse.urlencode({"Month": m, "Year": y}).encode(), headers={"User-Agent": "pauanui-fishing-personal-app"})
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
        for r, d, mon, yr in set(re.findall(r"(Excellent|Good|Poor) fishing on [A-Za-z]+ (\d+) ([A-Za-z]+) (\d{4})", html)):
            out[f"{yr}-{MON[mon]:02d}-{int(d):02d}"] = r
        time.sleep(0.6)
json.dump(dict(sorted(out.items())), open("data/maori.json", "w"), separators=(",", ":"))
print(len(out), "days written")
