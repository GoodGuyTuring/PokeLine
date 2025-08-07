import json
import requests
from pathlib import Path

def create_typechart_fallback():
    """Create a complete type effectiveness chart"""
    typechart = {
        "normal": {"rock": 0.5, "ghost": 0, "steel": 0.5},
        "fire": {"fire": 0.5, "water": 0.5, "grass": 2, "ice": 2, "bug": 2, "rock": 0.5, "dragon": 0.5, "steel": 2},
        "water": {"fire": 2, "water": 0.5, "grass": 0.5, "ground": 2, "rock": 2, "dragon": 0.5},
        "electric": {"water": 2, "electric": 0.5, "grass": 0.5, "ground": 0, "flying": 2, "dragon": 0.5},
        "grass": {"fire": 0.5, "water": 2, "grass": 0.5, "poison": 0.5, "ground": 2, "flying": 0.5, "bug": 0.5, "rock": 2, "dragon": 0.5, "steel": 0.5},
        "ice": {"fire": 0.5, "water": 0.5, "grass": 2, "ice": 0.5, "ground": 2, "flying": 2, "dragon": 2, "steel": 0.5},
        "fighting": {"normal": 2, "ice": 2, "poison": 0.5, "flying": 0.5, "psychic": 0.5, "bug": 0.5, "rock": 2, "ghost": 0, "dark": 2, "steel": 2, "fairy": 0.5},
        "poison": {"grass": 2, "poison": 0.5, "ground": 0.5, "rock": 0.5, "ghost": 0.5, "steel": 0, "fairy": 2},
        "ground": {"fire": 2, "electric": 2, "grass": 0.5, "poison": 2, "flying": 0, "bug": 0.5, "rock": 2, "steel": 2},
        "flying": {"electric": 0.5, "grass": 2, "fighting": 2, "bug": 2, "rock": 0.5, "steel": 0.5},
        "psychic": {"fighting": 2, "poison": 2, "psychic": 0.5, "dark": 0, "steel": 0.5},
        "bug": {"fire": 0.5, "grass": 2, "fighting": 0.5, "poison": 0.5, "flying": 0.5, "psychic": 2, "ghost": 0.5, "dark": 2, "steel": 0.5, "fairy": 0.5},
        "rock": {"fire": 2, "ice": 2, "fighting": 0.5, "ground": 0.5, "flying": 2, "bug": 2, "steel": 0.5},
        "ghost": {"normal": 0, "psychic": 2, "ghost": 2, "dark": 0.5},
        "dragon": {"dragon": 2, "steel": 0.5, "fairy": 0},
        "dark": {"fighting": 0.5, "psychic": 2, "ghost": 2, "dark": 0.5, "fairy": 0.5},
        "steel": {"fire": 0.5, "water": 0.5, "electric": 0.5, "ice": 2, "rock": 2, "steel": 0.5, "fairy": 2},
        "fairy": {"fire": 0.5, "fighting": 2, "poison": 0.5, "dragon": 2, "dark": 2, "steel": 0.5}
    }
    return typechart

def download_from_pokeapi_for_missing():
    """Use PokeAPI to create abilities and items JSON files"""
    abilities = {}
    items = {}
    
    print("  Using PokeAPI to fetch abilities and items...")
    
    # Fetch abilities (first 300 should cover all main ones)
    try:
        print("    Fetching abilities from PokeAPI...")
        response = requests.get("https://pokeapi.co/api/v2/ability?limit=300", timeout=10)
        response.raise_for_status()
        ability_list = response.json()
        
        # Convert to Showdown format
        for ability_ref in ability_list['results']:
            ability_name = ability_ref['name'].replace('-', '').lower()
            abilities[ability_name] = {
                "name": ability_ref['name'].replace('-', ' ').title(),
                "id": ability_name,
                "num": int(ability_ref['url'].split('/')[-2])
            }
        print(f"      ✓ Fetched {len(abilities)} abilities")
    except Exception as e:
        print(f"      ✗ Failed to fetch abilities: {e}")
    
    # Fetch items (first 1000 should cover most)
    try:
        print("    Fetching items from PokeAPI...")
        response = requests.get("https://pokeapi.co/api/v2/item?limit=1000", timeout=15)
        response.raise_for_status()
        item_list = response.json()
        
        # Convert to Showdown format
        for item_ref in item_list['results']:
            item_name = item_ref['name'].replace('-', '').lower()
            items[item_name] = {
                "name": item_ref['name'].replace('-', ' ').title(),
                "id": item_name,
                "num": int(item_ref['url'].split('/')[-2])
            }
        print(f"      ✓ Fetched {len(items)} items")
    except Exception as e:
        print(f"      ✗ Failed to fetch items: {e}")
    
    return abilities, items

def download_pokemon_data(target_dir=None):
    """
    Download all essential Pokemon data from reliable sources
    """
    
    # Determine where to save files
    if target_dir:
        data_dir = Path(target_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
    else:
        data_dir = Path(__file__).parent
    
    print(f"📁 Saving files to: {data_dir.absolute()}")
    print("-" * 60)
    
    success_count = 0
    total_files = 5
    
    # 1. Download Pokedex and Moves from official Showdown
    print("\n📥 Downloading core data files...")
    
    for filename, url in [
        ("pokedex.json", "https://play.pokemonshowdown.com/data/pokedex.json"),
        ("moves.json", "https://play.pokemonshowdown.com/data/moves.json"),
    ]:
        print(f"  Downloading {filename}...")
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()
            (data_dir / filename).write_text(json.dumps(data, indent=2))
            print(f"    ✓ {filename} - {len(data)} entries")
            success_count += 1
        except Exception as e:
            print(f"    ✗ Failed: {e}")
    
    # 2. Try to get abilities and items from pmariglia's bot repo
    print("\n📥 Downloading abilities and items...")
    
    abilities_success = False
    items_success = False
    
    # Try pmariglia's repository first
    for filename, url in [
        ("abilities.json", "https://raw.githubusercontent.com/pmariglia/showdown/master/data/abilities.json"),
        ("items.json", "https://raw.githubusercontent.com/pmariglia/showdown/master/data/items.json"),
    ]:
        print(f"  Trying {filename} from pmariglia's repo...")
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()
            (data_dir / filename).write_text(json.dumps(data, indent=2))
            print(f"    ✓ {filename} - {len(data)} entries")
            if filename == "abilities.json":
                abilities_success = True
            else:
                items_success = True
            success_count += 1
        except Exception as e:
            print(f"    ✗ Failed: {e}")
    
    # If pmariglia's repo fails, try alternative sources
    if not abilities_success or not items_success:
        print("\n  Trying alternative data sources...")
        
        # Try @pkmn/data or dex
        alt_sources = [
            ("abilities", "https://data.pkmn.cc/data/abilities.json"),
            ("items", "https://data.pkmn.cc/data/items.json"),
        ]
        
        for name, url in alt_sources:
            if (name == "abilities" and abilities_success) or (name == "items" and items_success):
                continue
                
            print(f"    Trying {name} from pkmn.cc...")
            try:
                response = requests.get(url, timeout=10)
                response.raise_for_status()
                data = response.json()
                (data_dir / f"{name}.json").write_text(json.dumps(data, indent=2))
                print(f"      ✓ {name}.json downloaded")
                if name == "abilities":
                    abilities_success = True
                else:
                    items_success = True
                success_count += 1
            except:
                print(f"      ✗ Failed")
    
    # Last resort: Use PokeAPI
    if not abilities_success or not items_success:
        print("\n  Using PokeAPI as fallback...")
        abilities, items = download_from_pokeapi_for_missing()
        
        if not abilities_success and abilities:
            (data_dir / "abilities.json").write_text(json.dumps(abilities, indent=2))
            abilities_success = True
            success_count += 1
            print(f"    ✓ abilities.json created from PokeAPI")
        
        if not items_success and items:
            (data_dir / "items.json").write_text(json.dumps(items, indent=2))
            items_success = True
            success_count += 1
            print(f"    ✓ items.json created from PokeAPI")
    
    # 3. Type chart - try multiple sources
    print("\n📥 Downloading type chart...")
    typechart_success = False
    
    typechart_sources = [
        "https://raw.githubusercontent.com/pmariglia/showdown/master/data/typechart.json",
        "https://data.pkmn.cc/data/typechart.json",
    ]
    
    for url in typechart_sources:
        print(f"  Trying {url.split('/')[-3]} source...")
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()
            (data_dir / "typechart.json").write_text(json.dumps(data, indent=2))
            print(f"    ✓ typechart.json downloaded")
            typechart_success = True
            success_count += 1
            break
        except:
            print(f"    ✗ Failed")
    
    if not typechart_success:
        print("  Creating fallback type chart...")
        typechart = create_typechart_fallback()
        (data_dir / "typechart.json").write_text(json.dumps(typechart, indent=2))
        print("    ✓ typechart.json created from fallback")
        success_count += 1
    
    # Summary
    print("\n" + "="*60)
    print("DOWNLOAD SUMMARY")
    print("="*60)
    
    # Check what files we have
    files_status = {
        "pokedex.json": (data_dir / "pokedex.json").exists(),
        "moves.json": (data_dir / "moves.json").exists(),
        "abilities.json": (data_dir / "abilities.json").exists(),
        "items.json": (data_dir / "items.json").exists(),
        "typechart.json": (data_dir / "typechart.json").exists(),
    }
    
    print("\n📂 File Status:")
    for filename, exists in files_status.items():
        if exists:
            file_path = data_dir / filename
            size = file_path.stat().st_size / 1024
            print(f"  ✓ {filename} ({size:.1f} KB)")
        else:
            print(f"  ✗ {filename} - MISSING")
    
    all_present = all(files_status.values())
    
    print(f"\n📊 Success Rate: {success_count}/{total_files} files")
    
    if all_present:
        print("\n✅ SUCCESS! All essential files are ready!")
        print(f"📍 Location: {data_dir.absolute()}")
        print("\n🚀 Ready for Phase 2: Building data models")
    else:
        missing = [f for f, exists in files_status.items() if not exists]
        print(f"\n⚠️  Missing files: {', '.join(missing)}")
        print("Run the script again or manually download missing files")
    
    return all_present

if __name__ == "__main__":
    success = download_pokemon_data()
    exit(0 if success else 1)