#!/usr/bin/env python3
# make_tab_manifest.py — richer tabs.json generator

from __future__ import annotations
import json
import hashlib
from json.decoder import JSONDecodeError
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

# =======================
# USER SETTINGS (edit)
# =======================
# Repository root.
REPO_ROOT = Path(__file__).resolve().parents[1]

# Directory containing template_*.json files.
TEMPLATE_DIR = REPO_ROOT / "v1_writer" / "templates"

# Where to write the manifest.
OUTPUT_PATH = REPO_ROOT / "v1_writer" / "tabs.json"

# Preferred number of columns for your UI.
DEFAULT_COLUMNS = 3

# Optional explicit map from MODE key -> html partial path.
# Add or adjust this map as you add new modes or partials.
HTML_PATH_MAP = {
    "SUBJECTIVE": "note_writer/subjective.html",
    "ROS":        "note_writer/ROS.html",
    "PE":         "note_writer/physical.html",
    "MSE":        "note_writer/MSE.html",
    # "PHYSICAL": "note_writer/physical.html",  # alias example
}

# Manifest version so your runtime can evolve safely.
MANIFEST_VERSION = 1

# =======================
# Internal helpers
# =======================

def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def safe_get(obj: Any, key: str, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return default

def iter_dicts(obj: Any) -> Iterable[Dict[str, Any]]:
    """Yield every dict in the structure (preorder)."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from iter_dicts(v)
    elif isinstance(obj, list):
        for it in obj:
            yield from iter_dicts(it)

def count_structure(data: Dict[str, Any]) -> Tuple[int, int, int, List[str]]:
    """
    Returns (sectionCount, panelCount, chipCount, chipIds)
    Heuristics:
      - "sections": list of sections
      - "panels": list of panels within section(s)
      - "chips": list within a panel
    """
    section_count = 0
    panel_count = 0
    chip_count = 0
    chip_ids: List[str] = []

    # Count sections
    sections = safe_get(data, "sections", [])
    if isinstance(sections, list):
        section_count += len(sections)

    # Count panels and chips by walking the tree
    for d in iter_dicts(data):
        # panels
        panels = d.get("panels")
        if isinstance(panels, list):
            panel_count += len(panels)
        # chips
        chips = d.get("chips")
        if isinstance(chips, list):
            chip_count += len(chips)
            for c in chips:
                if isinstance(c, dict):
                    cid = c.get("id")
                    if isinstance(cid, str):
                        chip_ids.append(cid)

    return section_count, panel_count, chip_count, chip_ids

def detect_defaults(data: Dict[str, Any]) -> bool:
    # Consider any "defaults" key anywhere as a default presence
    return any("defaults" in d for d in iter_dicts(data))

def derive_html_path(mode_key: str) -> str:
    key = mode_key.strip().upper()
    if key in HTML_PATH_MAP:
        return HTML_PATH_MAP[key]
    # Fallback heuristic: TitleCase file under note_writer/
    fallback = f"note_writer/{key.title()}.html"
    return fallback

def read_template(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except JSONDecodeError as e:
        # Raise a clearer error so the caller can show which file/line failed
        raise RuntimeError(f"{path.name}: JSON decode error at line {e.lineno}, col {e.colno}: {e.msg}")

def normalize_modes(modes_val: Any) -> List[str]:
    """Coerce the 'modes' field into a list of non-empty, uppercased strings."""
    if isinstance(modes_val, list):
        return [str(x).strip().upper() for x in modes_val if str(x).strip()]
    if isinstance(modes_val, str):
        v = modes_val.strip()
        return [v.upper()] if v else []
    return []

def infer_mode_from_filename(path: Path) -> str:
    """
    Infer a mode key from a template filename.
    Examples:
      templates/template_MSE.json -> MSE
      templates/template_subjective.json -> SUBJECTIVE
    """
    name = path.stem  # e.g., 'templates/template_MSE'
    if name.lower().startswith("template_"):
        return name[len("template_"):].strip().upper()
    return name.strip().upper()

# =======================
# Main
# =======================

def main():
    # Collect templates.
    if not TEMPLATE_DIR.exists():
        print(f"ERROR: Template directory not found: {TEMPLATE_DIR}")
        return

    templates: List[Path] = sorted(
        p for p in TEMPLATE_DIR.glob("template_*.json")
        if p.is_file()
    )

    if not templates:
        print(f"WARNING: No template_*.json files found under {TEMPLATE_DIR}")
        return

    tabs: List[Dict[str, Any]] = []
    all_modes: List[str] = []
    all_chip_ids: List[str] = []
    per_mode_counts: Dict[str, Dict[str, int]] = {}

    for tpath in templates:
        print(f"…processing {tpath.name}")
        try:
            data = read_template(tpath)
        except Exception as e:
            print(f"  ERROR: JSON load failed for {tpath.name}: {e}")
            continue

        modes_raw = safe_get(data, "modes", [])
        modes = normalize_modes(modes_raw)
        print(f"  modes raw: {modes_raw} (type={type(modes_raw).__name__}) -> normalized: {modes}")

        if not modes:
            inferred = infer_mode_from_filename(tpath)
            print(f"  WARNING: No valid 'modes' found; using filename-inferred mode: {inferred}")
            modes = [inferred]

        # Use the first mode as the tab key
        key = str(modes[0]).strip().upper()
        label = key  # Keep 1:1 for now (runtime can friendly-case later)

        checksum = sha256_file(tpath)
        title = safe_get(data, "title", None)

        section_count, panel_count, chip_count, chip_ids = count_structure(data)
        has_defaults = detect_defaults(data)

        # Track global indices
        all_modes.append(key)
        all_chip_ids.extend(chip_ids)
        per_mode_counts.setdefault(key, {"sections": 0, "panels": 0, "chips": 0})
        per_mode_counts[key]["sections"] += section_count
        per_mode_counts[key]["panels"] += panel_count
        per_mode_counts[key]["chips"] += chip_count

        tabs.append({
            "key": key,
            "label": label,
            "file": tpath.name,
            "source": str(tpath),
            "checksum": checksum,
            "title": title,
            "htmlPath": derive_html_path(key),
            "sectionCount": section_count,
            "panelCount": panel_count,
            "chipCount": chip_count,
            "hasDefaults": bool(has_defaults),
        })

    if not tabs:
        print("WARNING: No valid templates after parsing.")
        return

    # Ensure a stable order: SUBJECTIVE, ROS, PE, then alpha for everything else
    priority = ["SUBJECTIVE", "ROS", "PE", "MSE"]
    def sort_key(tab: Dict[str, Any]):
        k = tab["key"]
        return (priority.index(k) if k in priority else len(priority), k)
    tabs.sort(key=sort_key)

    # Mark the first as default
    tabs[0]["default"] = True

    # Build manifest
    generated_at = datetime.now(timezone.utc).isoformat()
    manifest: Dict[str, Any] = {
        "version": MANIFEST_VERSION,
        "generatedAt": generated_at,
        "generator": {
            "name": "make_tab_manifest.py",
            "projectRoot": str(REPO_ROOT),
            "templateDirectory": str(TEMPLATE_DIR),
            "fileCount": len(templates),
        },
        "tabs": tabs,
        "index": {
            "modes": [t["key"] for t in tabs],
            "byMode": per_mode_counts,
            "allChipIds": sorted(set(all_chip_ids)),
        },
        "settings": {
            "columns": DEFAULT_COLUMNS
        }
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"Wrote {OUTPUT_PATH} with {len(tabs)} tabs")

if __name__ == "__main__":
    main()
