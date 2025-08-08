#!/usr/bin/env python3
import pathlib, time, requests

POKELINE_PATH = r"D:\RandomStuff\PokeLine"
OUT_DIR = pathlib.Path(POKELINE_PATH) / "data" / "ps_raw"
CDN = "https://play.pokemonshowdown.com/data"
GH  = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master"

CDN_FILES = [
    "pokedex.json", "moves.json", "learnsets.json",
    "items.js", "abilities.js", "typechart.js", "formats-data.js", "formats.js",
]
GH_FILES = [
    "data/pokedex.ts", "data/moves.ts", "data/abilities.ts",
    "data/items.ts", "data/typechart.ts", "data/conditions.ts",
]

def fetch(url, dst, session, retries=4):
    for a in range(retries):
        r = session.get(url, timeout=30)
        if r.status_code in (200, 404): break
        if r.status_code in (429, 403, 500, 502, 503, 504):
            time.sleep(1.5*(a+1)); continue
        r.raise_for_status()
    if r.status_code == 404:
        print(f"[WARN] 404: {url}")
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(r.content)
    print(f"[OK]   {url} -> {dst}")
    return True

def main():
    out_cdn = OUT_DIR / "cdn"
    out_gh  = OUT_DIR / "github"
    with requests.Session() as s:
        s.headers.update({"User-Agent": "PokeLine-fetcher/1.1"})
        ok = 0
        for f in CDN_FILES:
            ok += int(fetch(f"{CDN}/{f}", out_cdn / f, s))
        for f in GH_FILES:
            ok += int(fetch(f"{GH}/{f}", out_gh / f, s))
        print(f"\nDone. Saved files under {OUT_DIR.resolve()}.")

if __name__ == "__main__":
    main()
