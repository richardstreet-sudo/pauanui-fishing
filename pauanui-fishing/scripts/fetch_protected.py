#!/usr/bin/env python3
"""Rebuild data/protected.json (High Protection Areas, Seafloor Protection Areas, marine reserves) from OpenStreetMap.
Boundaries carry DOC / LINZ designations but are only a guide – always confirm with DOC / Fisheries NZ.
Usage: python3 scripts/fetch_protected.py   (needs internet; uses the public Overpass API)"""
import json, math, urllib.parse, urllib.request

BBOX = "-37.8,174.3,-36.3,176.6"   # south,west,north,east – Coromandel east coast to Auckland
Q = f'''[out:json][timeout:90];
(relation["name"~"High Protection Area|Seafloor Protection|Marine Reserve"]({BBOX});
 way["name"~"High Protection Area|Seafloor Protection|Marine Reserve"]({BBOX}););
out geom;'''

def stitch(ways):
    ways = [list(w) for w in ways if len(w) > 1]; rings = []
    while ways:
        ring = ways.pop(0); changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for i, w in enumerate(ways):
                if w[0] == ring[-1]: ring += w[1:]; ways.pop(i); changed = True; break
                if w[-1] == ring[-1]: ring += w[::-1][1:]; ways.pop(i); changed = True; break
                if w[-1] == ring[0]: ring = w[:-1] + ring; ways.pop(i); changed = True; break
                if w[0] == ring[0]: ring = w[::-1][:-1] + ring; ways.pop(i); changed = True; break
        rings.append(ring)
    return rings

def simplify(pts, eps):  # Douglas-Peucker in degrees (lon scaled)
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]; ax, ay, bx, by, px, py = a[1]*.8, a[0], b[1]*.8, b[0], p[1]*.8, p[0]
        dx, dy = bx - ax, by - ay
        t = 0 if dx == dy == 0 else max(0, min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)))
        d = math.hypot(px - (ax + t*dx), py - (ay + t*dy))
        if d > dmax: dmax, idx = d, i
    return simplify(pts[:idx+1], eps)[:-1] + simplify(pts[idx:], eps) if dmax > eps else [a, b]

req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": Q}).encode(),
                             headers={"User-Agent": "pauanui-fishing-personal-app"})
data = json.load(urllib.request.urlopen(req, timeout=120))
out = []
for e in data["elements"]:
    t = e.get("tags", {}); name = t.get("name", "")
    if "Proposed" in (t.get("description") or ""): continue
    kind = "HPA" if "High Protection" in name else "SPA" if "Seafloor" in name else "Marine reserve"
    if e["type"] == "relation":
        ways = [[(p["lat"], p["lon"]) for p in m["geometry"]] for m in e["members"] if m["type"] == "way" and m.get("role", "outer") == "outer" and m.get("geometry")]
        rings = stitch(ways)
    else:
        rings = [[(p["lat"], p["lon"]) for p in e["geometry"]]]
    rr = [[[round(a, 5), round(b, 5)] for a, b in simplify(r, 0.0004)] for r in rings if len(r) >= 4]
    if rr: out.append({"name": name, "kind": kind, "rings": rr})
json.dump(out, open("data/protected.json", "w"), separators=(",", ":"), ensure_ascii=False)
print(len(out), "areas written")
