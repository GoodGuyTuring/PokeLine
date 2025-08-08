#!/usr/bin/env python3
"""
Fetch raw Pokémon Showdown data files (Gen 9-focused) from GitHub
and store them directly into your PokeLine project's data/ps_raw folder.
"""

import os
import time
import pathlib
import requests

# === CONFIG ===
# Path to your local PokeLine repo's data folder
POKELINE_PATH = r"D:\RandomStuff\PokeLine"
OUT_DIR = pathlib.Path(POKELINE_PATH) / "data" / "ps_raw"
REF = "master"  # branch, tag, or commit SHA for reproducibility

BASE = "https://raw.githubusercontent.com/smogon/pokemon-showdown"

PS_FILES = [
    # Base
    "data/pokedex.ts",
    "data/moves.ts",
    "data/abilities.ts",
    "data/items.ts",
    "data/typechart.ts",
    "data/conditions.ts",

    # Gen 9 overrides
    "data/mods/gen9/pokedex.ts",
    "data/mods/gen9/moves.ts",
    "data/mods/gen9/abilities.ts",
    "data/mods/gen9/items.ts",
    "data/mods/gen9/typechart.ts",
    "data/mods/gen9/conditions.ts",
]

def fetch_raw(ref: str, path: str, out_dir: pathlib.Path, session: requests.Session, retries=4):
    url = f"{BASE}/{ref}/{path}"
    for attempt in range(retries):
        r = session.get(url, timeout=30)
        if r.status_code in (200, 404):
            break
        if r.status_code in (429, 403, 500, 502, 503, 504):
            time.sleep(1.5 * (attempt + 1))
            continue
        r.raise_for_status()

    if r.status_code == 404:
        print(f"[WARN] 404: {path} not found at {ref}; skipping.")
        return False

    r.raise_for_status()
    dst = out_dir / path
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(r.content)
    print(f"[OK]   {path}  ->  {dst}")
    return True

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with requests.Session() as s:
        s.headers.update({"User-Agent": "PokeLine-fetcher/1.0"})
        ok = 0
        for p in PS_FILES:
            ok += int(fetch_raw(REF, p, OUT_DIR, s))
        print(f"\nDone. Fetched {ok}/{len(PS_FILES)} files into {OUT_DIR.resolve()}.")

if __name__ == "__main__":
    main()
