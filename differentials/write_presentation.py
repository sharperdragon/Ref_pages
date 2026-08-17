import os
import json
import re
from typing import Dict, Any, Iterable, Tuple, Optional, List, Union
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DIFFERENTIALS_DIR = REPO_ROOT / "differentials"
PRESENTATIONS_DIR = DIFFERENTIALS_DIR / "data" / "presentations"

# ! -----------------------------
# ! USER SETTINGS
# ! -----------------------------
BASE_DIR = PRESENTATIONS_DIR
PRESENTATION_LIST_PATH = DIFFERENTIALS_DIR / "Presentation_list.json"
CLINICAL_INDEX_PATH = DIFFERENTIALS_DIR / "clinical_presentation_index.json"
NONCLINICAL_INDEX_PATH = DIFFERENTIALS_DIR / "non-clinical_presentation_index.json"
SCHEMA_PATH = REPO_ROOT / "assets" / "presentations_schema.json"

INCLUDE_FREQ = True                  
LOW_PRIORITY_MODE = "subfolder"        
REBUILD_EXISTING = True              # Rebuild items array from sources on existing files
SUMMARY_PATH = DIFFERENTIALS_DIR / "presentation_build_summary.md"
DRY_RUN = False                      # <= per user request

# --- Completion/locking flags ---
SKIP_COMPLETED = True            # Skip files that appear fully curated
COMPLETENESS_STRICT = True       # All HPI keys must be non-empty for every item

# ! -----------------------------
# ! Section → folder mapping
# ! -----------------------------
SECTION_FOLDERS: Dict[str, str] = {
    "Clinical": "clinical",
    "Biochemical": "biochemical",
    "Hematological": "hematological",
}

# ! -----------------------------
# ! Already written & low-priority slugs
# ! -----------------------------
WRITTEN_SLUGS = {
    "abdominal",
    "anorectal-pain",
    "arm-pain",
    "arm-swellings",
    "ascites",
    "axillary-swellings",
    "backache",
    "breast-lumps",
    "breast-pain",
    "chest-pain",
    "clubbing",
    "coma",
    "confusion",
    "constipation",
    "convulsions",
    "cough",
    "cyanosis",
    "deafness",
    "diarrhea",
    "dizziness",
    "dysphagia",
    "dyspnea",
}

LOW_PRIORITY_SLUGS = {
    "erectile-dysfunction",
    "facial-swellings",
    "facial-ulcers",
    "finger-lesions",
    "finger-pain",
    "foot-and-ankle-deformities",
    "groin-swellings",
    "hand-deformities",
    "hemiparesis",
    "hiccups",
    "jaw-pain-and-swellings",
    "leg-ulcers",
    "mouth-ulcers",
    "nasal-discharge",
    "penile-lesions",
    "popliteal-swellings",
    "pruritus-ani",
    "scalp-lesions",
    "scrotal-pain",
    "scrotal-swellings",
    "stridor",
    "sweating-abnormalities",
    "thirst",
    "tiredness",
    "toe-lesions",
    "tongue-disorders",
}

# ! -----------------------------
# ! Utilities
# ! -----------------------------
_def_slug_cleanup = re.compile(r"[^a-z0-9\s-]")
_bullet_pat = re.compile(r"^[\u2022\u2023\u25E6\u2043\u2219\-•\s]+")
_fig_pat = re.compile(r"\((?:fig|figure|see)[:\s][^\)]*\)", re.IGNORECASE)
_eg_tail_pat = re.compile(r"\be\.g\.[^;,.]*", re.IGNORECASE)
_trailing_punct = re.compile(r"[\s,:;\-]+$")

SYSTEM_FIX = {
    "‘medical’ causes": "Medical",
    "medical causes": "Medical",
    "urinary tract": "Urinary tract",
    "abdominal wall": "Abdominal wall",
    "gastrointestinal": "Gastrointestinal",
    "referred pain": "Referred",
}

ALIAS_MAP = {
    ("Clinical Presentations", "Abdominal"): ["Abdominal pain", "Abdominal swellings"],
}

SECTION_INDEX_TYPE = {
    "Clinical": "clinical",
    "Biochemical": "non-clinical",
    "Hematological": "non-clinical",
}


def slugify(name: str) -> str:
    s = name.lower()
    s = _def_slug_cleanup.sub("", s)
    s = s.strip().replace(" ", "-")
    s = re.sub(r"-+", "-", s)
    return s


def normalize_label(s: str) -> str:
    s = s.strip()
    s = _bullet_pat.sub("", s)
    s = _fig_pat.sub("", s)
    s = _eg_tail_pat.sub("", s)
    s = _trailing_punct.sub("", s)
    return s.strip()



# Helper to convert ALL-CAPS labels to Title/Normal case, preserving separators
def _title_from_all_caps(text: str) -> str:
    """Convert ALL-CAPS labels into Title/Normal case while preserving separators.
    Example: "GASTROINTESTINAL" -> "Gastrointestinal"; "UPPER GI" -> "Upper gi".
    """
    if not text:
        return text
    # Lowercase all letters first, then capitalize token-wise while preserving separators
    parts = re.split(r"([\s_\-/]+)", text.lower())
    out = []
    for p in parts:
        if not p:
            continue
        # If this is a separator, keep as-is
        if re.fullmatch(r"[\s_\-/]+", p):
            out.append(p)
        else:
            # Word token: capitalize first letter only
            out.append(p[:1].upper() + p[1:])
    return "".join(out)

def title_case_system(cat: str) -> str:
    if not cat:
        return ""
    c = normalize_label(cat)
    low = c.lower()
    # Explicit fixes first
    if low in SYSTEM_FIX:
        return SYSTEM_FIX[low]
    # If the label is all-caps (contains at least one A-Z and equals its uppercase), normalize it
    if re.search(r"[A-Z]", c) and c == c.upper():
        return _title_from_all_caps(c)
    # Otherwise, ensure first char is uppercase and keep the rest as-is
    return c[:1].upper() + c[1:]


def load_json(path: Union[str, os.PathLike[str]]) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_required_symptom_keys(schema_obj: Dict[str, Any]) -> List[str]:
    # Prefer explicit list if present
    if isinstance(schema_obj.get("hpi"), dict):
        sym = schema_obj["hpi"]
        # Try required list
        if isinstance(sym.get("required"), list) and sym.get("required"):
            return list(sym["required"])  # keep order
        # Else use properties keys
        if isinstance(sym.get("properties"), dict):
            return list(sym["properties"].keys())
    # Fallback to canonical list
    return [
        "onset","progression","palliate","provoke","quality","timing",
        "region","radiation","severity","clinical tests","other symptoms"
    ]


def blank_symptoms(required_keys: Iterable[str]) -> Dict[str, list]:
    return {k: [] for k in required_keys}


# --- Completion detection helpers ---

def _has_nonempty_list(d: Dict[str, Any], key: str) -> bool:
    v = d.get(key)
    return isinstance(v, list) and len(v) > 0


def is_file_locked(doc: Dict[str, Any]) -> bool:
    """Allow an explicit opt-out from regeneration.
    Honor any of these markers if present: locked: true, completed: true, do_not_overwrite: true,
    or status in {"complete","done","final"}.
    """
    if doc.get("locked") is True or doc.get("completed") is True or doc.get("do_not_overwrite") is True:
        return True
    status = str(doc.get("status", "")).strip().lower()
    return status in {"complete", "completed", "done", "final"}


def is_document_complete(doc: Dict[str, Any], required_keys: Iterable[str]) -> bool:
    items = doc.get("items")
    if not isinstance(items, list) or not items:
        return False
    for it in items:
        if not isinstance(it, dict):
            return False
        hpi = it.get("hpi")
        if not isinstance(hpi, dict):
            return False
        if COMPLETENESS_STRICT:
            # Every required key must be present and non-empty
            for k in required_keys:
                if not _has_nonempty_list(hpi, k):
                    return False
        else:
            # At least one HPI key must be non-empty
            if not any(_has_nonempty_list(hpi, k) for k in required_keys):
                return False
    return True


def iter_etiologies(index_block: Any, parent_category: str = "") -> Iterable[Tuple[str, str, Optional[str]]]:
    """Yield (category, etiology, freq) recursively from index blocks."""
    if isinstance(index_block, dict):
        for k, v in index_block.items():
            cat = normalize_label(k) if k else parent_category
            if isinstance(v, dict):
                # Leaf case: {"Etiology": {"freq": "common"}}
                if all(isinstance(x, dict) and ("freq" in x or not x) for x in v.values()):
                    for et, meta in v.items():
                        name = normalize_label(et)
                        freq = (meta or {}).get("freq") if isinstance(meta, dict) else None
                        yield (cat, name, freq)
                else:
                    # Nested categories
                    yield from iter_etiologies(v, parent_category=cat or parent_category)
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, str):
                        yield (cat, normalize_label(item), None)
                    elif isinstance(item, dict):
                        nm = item.get("name") if isinstance(item.get("name"), str) else None
                        if nm:
                            yield (cat, normalize_label(nm), item.get("freq"))
                        else:
                            yield from iter_etiologies(item, parent_category=cat)
            elif isinstance(v, str):
                yield (cat, normalize_label(v), None)
    elif isinstance(index_block, list):
        for item in index_block:
            yield from iter_etiologies(item, parent_category=parent_category)
    elif isinstance(index_block, str):
        yield (parent_category, normalize_label(index_block), None)


def build_index_lookup(d: Dict[str, Any]) -> Dict[str, str]:
    def norm(t: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", t.lower())
    return {norm(k): k for k in d.keys()}


def resolve_index_keys(pres_name: str, section: str, clinical_idx: Dict[str, Any], nonclinical_idx: Dict[str, Any]) -> List[str]:
    # Manual alias first
    if (section, pres_name) in ALIAS_MAP:
        return ALIAS_MAP[(section, pres_name)]

    # Choose index by section
    idx = clinical_idx if SECTION_INDEX_TYPE.get(section) == "clinical" else nonclinical_idx

    # Exact (case-insensitive)
    for k in idx.keys():
        if k.lower() == pres_name.lower():
            return [k]

    # Token-normalized
    def norm(t: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", t.lower())
    n_name = norm(pres_name)

    # Exact normalized
    for k in idx.keys():
        if norm(k) == n_name:
            return [k]

    # Contains: if the list name is umbrella, gather children with substring match
    matches = [k for k in idx.keys() if n_name and n_name in norm(k)]
    return matches


def write_json_atomically(dest_path: Union[str, os.PathLike[str]], data: Dict[str, Any]) -> None:
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest_path.with_suffix(dest_path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, dest_path)


# ! -----------------------------
# ! Main build
# ! -----------------------------

def main() -> None:
    # Load resources
    presentation_data: Dict[str, Any] = load_json(PRESENTATION_LIST_PATH)
    clinical_idx: Dict[str, Any] = load_json(CLINICAL_INDEX_PATH)
    nonclinical_idx: Dict[str, Any] = load_json(NONCLINICAL_INDEX_PATH)
    schema_data: Dict[str, Any] = load_json(SCHEMA_PATH)
    required_symptoms = get_required_symptom_keys(schema_data)

    created = 0
    updated = 0
    skipped = 0
    no_index = 0

    summary_rows = []

    for section, entries in presentation_data.items():
        folder_name = SECTION_FOLDERS.get(section, "misc")
        index_type = SECTION_INDEX_TYPE.get(section, "clinical")

        for entry in entries:
            pres_name = entry["name"] if isinstance(entry, dict) else str(entry)
            slug = slugify(pres_name)

            # Low priority routing
            subfolder = folder_name
            if slug in LOW_PRIORITY_SLUGS and LOW_PRIORITY_MODE == "subfolder":
                subfolder = "clinical/other"

            dest_path = BASE_DIR / subfolder / f"{slug}.json"
            dest_path.parent.mkdir(parents=True, exist_ok=True)

            # Resolve which index keys to use
            matched_keys = resolve_index_keys(pres_name, section, clinical_idx, nonclinical_idx)
            used_keys: List[str] = []

            # Build items
            items: List[Dict[str, Any]] = []
            seen = set()
            chosen_idx = clinical_idx if index_type == "clinical" else nonclinical_idx

            for key in matched_keys:
                block = chosen_idx.get(key)
                if block is None:
                    continue
                used_keys.append(key)
                for cat, et, fq in iter_etiologies(block):
                    system = title_case_system(cat)
                    name = et
                    sig = (system.lower(), name.lower())
                    if sig in seen:
                        continue
                    seen.add(sig)
                    item: Dict[str, Any] = {
                        "name": name,
                        "system": system,
                        "redFlag": False,
                        "hpi": blank_symptoms(required_symptoms),
                    }
                    if INCLUDE_FREQ:
                        item["freq"] = fq if fq else "unknown"
                    items.append(item)

            # Build document
            doc: Dict[str, Any] = {
                "presentation": pres_name,
                "items": items,
                "sources": {
                    "index_keys": used_keys,
                    "index_type": index_type,
                },
            }

            action = ""
            if dest_path.exists():
                # Load existing once for checks/preservation
                try:
                    existing = load_json(dest_path)
                except Exception:
                    existing = {}

                # Skip if file is explicitly locked or appears fully curated
                if SKIP_COMPLETED and (is_file_locked(existing) or is_document_complete(existing, required_symptoms)):
                    skipped += 1
                    action = "skipped-complete"
                elif REBUILD_EXISTING:
                    # Preserve extra top-level fields (if any) not managed by us
                    for k in existing.keys():
                        if k not in doc and k not in {"items", "sources"}:
                            doc[k] = existing[k]
                    if not DRY_RUN:
                        write_json_atomically(dest_path, doc)
                    updated += 1
                    action = "updated"
                else:
                    skipped += 1
                    action = "skipped"
            else:
                if not DRY_RUN:
                    write_json_atomically(dest_path, doc)
                created += 1
                action = "created"

            if not used_keys:
                no_index += 1

            summary_rows.append({
                "Presentation": pres_name,
                "Section": section,
                "Action": action,
                "IndexType": index_type,
                "#Etiologies": len(items),
                "AliasesUsed": ", ".join(used_keys) if used_keys else "",
                "Path": dest_path,
            })

    # Write summary markdown
    lines = [
        "# Presentation Build Summary\n",
        f"Created: {created}  |  Updated: {updated}  |  Skipped: {skipped}  |  No index match: {no_index}\n",
        f"List: {PRESENTATION_LIST_PATH}\n",
        f"Clinical Index: {CLINICAL_INDEX_PATH}\n",
        f"Non-Clinical Index: {NONCLINICAL_INDEX_PATH}\n",
        f"Schema: {SCHEMA_PATH}\n",
        "\n",
        "| Presentation | Section | Action | IndexType | #Etiologies | Aliases Used | Path |\n",
        "|---|---|---|---|---:|---|---|\n",
    ]
    for r in summary_rows:
        lines.append(
            f"| {r['Presentation']} | {r['Section']} | {r['Action']} | {r['IndexType']} | {r['#Etiologies']} | {r['AliasesUsed']} | `{r['Path']}` |\n"
        )

    try:
        if not DRY_RUN:
            SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
                f.write("".join(lines))
    except Exception as e:
        print(f"! Failed to write summary: {e}")

    print(f"Created={created}, Updated={updated}, Skipped={skipped}, NoIndex={no_index}")


if __name__ == "__main__":
    main()
