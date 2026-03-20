#!/usr/bin/env python3
"""
Expand the enriched pharm dataset with additional DrugBank records.

This script keeps existing curated medications and appends DrugBank-derived
records for names not already represented.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple


# ================================================================
# Configurable values (change here)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]
DRUGBANK_TSV_PATH = PHARM_DIR / "assests" / "drugbank.tsv"
INPUT_ENRICHED_JSON_PATH = PHARM_DIR / "assests" / "pharm_data_drugbank_enriched.json"
OUTPUT_ENRICHED_JSON_PATH = PHARM_DIR / "assests" / "pharm_data_drugbank_enriched.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "drugbank_catalog_report.json"

# Set to an empty set to include every DrugBank row.
INCLUDE_GROUPS: Set[str] = set()
EXCLUDE_GROUPS: Set[str] = set()
# Exclude records whose group list is composed only of these values.
EXCLUDE_IF_ONLY_GROUPS: Set[str] = {"experimental"}

DEFAULT_ROUTE = "PO"
FALLBACK_CLASS = "Unclassified"
REMOVE_GENERIC_PLACEHOLDER_TEXT = True
GENERIC_PLACEHOLDER_BY_FIELD = {
    "contraindications": "Refer to official prescribing information.",
    "adverseEffects": "Common adverse effects vary by formulation and dose.",
    "majorInteractions": "Review full interaction profile before prescribing.",
    "monitoring": "Monitor per indication, route, and patient-specific risk factors.",
}

SORT_OUTPUT_BY_NAME = True
MAX_EXAMPLE_COUNT = 40

REQUIRED_FIELDS = [
    "id",
    "name",
    "drugClass",
    "routes",
    "moa",
    "indications",
]

ROUTE_PRIORITY = ["PO", "IV", "IM", "SQ", "INH", "IN", "SL", "Topical", "PR"]

ATC_TOP_LEVEL = {
    "A": "Alimentary tract and metabolism",
    "B": "Blood and blood forming organs",
    "C": "Cardiovascular system",
    "D": "Dermatologicals",
    "G": "Genito urinary system and sex hormones",
    "H": "Systemic hormonal preparations",
    "J": "Antiinfectives for systemic use",
    "L": "Antineoplastic and immunomodulating agents",
    "M": "Musculo-skeletal system",
    "N": "Nervous system",
    "P": "Antiparasitic products, insecticides and repellents",
    "R": "Respiratory system",
    "S": "Sensory organs",
    "V": "Various",
}


def clean_text(value: object) -> str:
    return str(value or "").strip()


def split_pipe(value: object) -> List[str]:
    raw = clean_text(value)
    if not raw:
        return []
    return [item.strip() for item in raw.split("|") if item.strip()]


def normalize_name(value: object) -> str:
    text = clean_text(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def first_sentence(value: object, max_len: int = 320) -> str:
    text = clean_text(value)
    if not text:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    sentence = sentence.strip()
    if len(sentence) <= max_len:
        return sentence
    return sentence[: max_len - 3].rstrip() + "..."


def load_json(path: Path) -> Dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def get_drugbank_id(item: Dict[str, object]) -> str:
    raw_drugbank = item.get("drugbank")
    if not isinstance(raw_drugbank, dict):
        return ""
    return clean_text(raw_drugbank.get("drugbank_id", ""))


def load_tsv_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"DrugBank TSV not found: {path}")
    rows: List[Dict[str, str]] = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            rows.append({k: clean_text(v) for k, v in row.items()})
    return rows


def should_include_row(
    row: Dict[str, str],
    include_groups: Set[str],
    exclude_groups: Set[str],
    exclude_if_only_groups: Set[str],
) -> bool:
    groups = {g.lower() for g in split_pipe(row.get("groups", ""))}
    if groups and exclude_if_only_groups and groups.issubset(exclude_if_only_groups):
        return False
    if include_groups and groups.isdisjoint(include_groups):
        return False
    if exclude_groups and not groups.isdisjoint(exclude_groups):
        return False
    return True


def row_priority_score(row: Dict[str, str]) -> Tuple[int, int, int, int, str]:
    groups = {g.lower() for g in split_pipe(row.get("groups", ""))}
    has_approved = 1 if "approved" in groups else 0
    has_description = 1 if clean_text(row.get("description", "")) else 0
    has_categories = 1 if split_pipe(row.get("categories", "")) else 0
    has_atc = 1 if split_pipe(row.get("atc_codes", "")) else 0
    # Larger tuple is preferred except for last tie-breaker where smaller ID is preferred.
    return (has_approved, has_description, has_categories, has_atc, clean_text(row.get("drugbank_id", "")))


def build_preferred_name_index(
    rows: Iterable[Dict[str, str]],
    include_groups: Set[str],
    exclude_groups: Set[str],
    exclude_if_only_groups: Set[str],
) -> Dict[str, Dict[str, str]]:
    index: Dict[str, Dict[str, str]] = {}
    scores: Dict[str, Tuple[int, int, int, int, str]] = {}

    for row in rows:
        if not should_include_row(row, include_groups, exclude_groups, exclude_if_only_groups):
            continue

        key = normalize_name(row.get("name", ""))
        if not key:
            continue

        score = row_priority_score(row)
        if key not in index:
            index[key] = row
            scores[key] = score
            continue

        current = scores[key]
        if score[:4] > current[:4]:
            index[key] = row
            scores[key] = score
            continue

        if score[:4] == current[:4]:
            current_id = current[4]
            candidate_id = score[4]
            if candidate_id and current_id and candidate_id < current_id:
                index[key] = row
                scores[key] = score

    return index


def infer_drug_class(row: Dict[str, str]) -> str:
    categories = split_pipe(row.get("categories", ""))
    if categories:
        return categories[0]

    atc_codes = split_pipe(row.get("atc_codes", ""))
    if atc_codes:
        top = clean_text(atc_codes[0])[:1].upper()
        if top in ATC_TOP_LEVEL:
            return f"ATC {top} - {ATC_TOP_LEVEL[top]}"

    groups = split_pipe(row.get("groups", ""))
    if groups:
        return f"DrugBank {groups[0].title()}"

    return FALLBACK_CLASS


def infer_routes(row: Dict[str, str]) -> List[str]:
    text = " ".join(
        [
            clean_text(row.get("name", "")),
            clean_text(row.get("categories", "")),
            clean_text(row.get("description", "")),
        ]
    ).lower()

    routes: List[str] = []

    def add(route: str) -> None:
        if route not in routes:
            routes.append(route)

    if re.search(r"\binhal", text):
        add("INH")
    if re.search(r"\bintranasal\b|\bnasal spray\b", text):
        add("IN")
    if re.search(r"\bsublingual\b", text):
        add("SL")
    if re.search(r"\brectal\b|\bsuppositor", text):
        add("PR")
    if re.search(r"\btopical\b|\bdermal\b|\bcutaneous\b|\bophthalmic\b|\botic\b|\btransdermal\b", text):
        add("Topical")
    if re.search(r"\bsubcutaneous\b|\bsubcutan\b", text):
        add("SQ")
    if re.search(r"\bintramuscular\b|\bim\b", text):
        add("IM")
    if re.search(r"\bintravenous\b|\biv\b|\binfusion\b|\binject", text):
        add("IV")
    if re.search(r"\boral\b|\btablet\b|\bcapsule\b|\bby mouth\b", text):
        add("PO")

    if not routes:
        add(DEFAULT_ROUTE)

    order = {route: i for i, route in enumerate(ROUTE_PRIORITY)}
    routes.sort(key=lambda route: order.get(route, len(ROUTE_PRIORITY)))
    return routes


def make_unique_id(base_id: str, existing_ids: Set[str]) -> str:
    candidate = base_id
    counter = 2
    while candidate in existing_ids:
        candidate = f"{base_id}-{counter}"
        counter += 1
    return candidate


def ensure_non_empty_list(values: List[str], fallback: str) -> List[str]:
    cleaned = [clean_text(value) for value in values if clean_text(value)]
    return cleaned if cleaned else [fallback]


def parse_drugbank_categories_from_indication(text: object) -> List[str]:
    raw = clean_text(text)
    if not raw:
        return []
    prefix = "drugbank categories:"
    if not raw.lower().startswith(prefix):
        return []

    remainder = raw[len(prefix) :].strip()
    if not remainder:
        return []
    return [item.strip() for item in remainder.split(",") if item.strip()]


def remove_generic_placeholders(record: Dict[str, object]) -> Dict[str, object]:
    if not REMOVE_GENERIC_PLACEHOLDER_TEXT:
        return record

    for field, placeholder in GENERIC_PLACEHOLDER_BY_FIELD.items():
        if field not in record:
            continue

        value = record.get(field)
        placeholder_norm = normalize_name(placeholder)

        if isinstance(value, list):
            cleaned = []
            for item in value:
                item_text = clean_text(item)
                if not item_text:
                    continue
                if normalize_name(item_text) == placeholder_norm:
                    continue
                cleaned.append(item_text)
            record[field] = cleaned
            continue

        item_text = clean_text(value)
        if item_text and normalize_name(item_text) == placeholder_norm:
            record[field] = []

    return record


def normalize_drugbank_categories_into_class(record: Dict[str, object]) -> Dict[str, object]:
    indications_raw = record.get("indications", [])
    extracted_categories: List[str] = []
    cleaned_indications: List[str] = []

    if isinstance(indications_raw, list):
        for item in indications_raw:
            item_text = clean_text(item)
            if not item_text:
                continue
            from_indication = parse_drugbank_categories_from_indication(item_text)
            if from_indication:
                extracted_categories.extend(from_indication)
                continue
            cleaned_indications.append(item_text)
        record["indications"] = cleaned_indications

    drugbank_meta = record.get("drugbank", {})
    if isinstance(drugbank_meta, dict):
        categories = drugbank_meta.get("categories", [])
        if isinstance(categories, list):
            extracted_categories.extend([clean_text(item) for item in categories if clean_text(item)])

    deduped_categories: List[str] = []
    seen = set()
    for item in extracted_categories:
        key = normalize_name(item)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped_categories.append(item)

    if deduped_categories:
        primary_category = deduped_categories[0]
        current_class = clean_text(record.get("drugClass", ""))
        should_replace_class = (
            not current_class
            or normalize_name(current_class) == normalize_name(primary_category)
            or current_class.startswith("DrugBank ")
            or current_class == FALLBACK_CLASS
        )
        if should_replace_class:
            record["drugClass"] = primary_category

    indications_final = record.get("indications", [])
    if isinstance(indications_final, list) and len(indications_final) == 0:
        moa_text = clean_text(record.get("moa", ""))
        if moa_text:
            record["indications"] = [moa_text]
        else:
            med_name = clean_text(record.get("name", ""))
            if med_name:
                record["indications"] = [f"See DrugBank entry for {med_name}."]
            else:
                record["indications"] = ["See DrugBank entry."]

    return record


def build_generated_record(row: Dict[str, str], existing_ids: Set[str]) -> Dict[str, object]:
    drugbank_id = clean_text(row.get("drugbank_id", ""))
    name = clean_text(row.get("name", ""))
    categories = split_pipe(row.get("categories", ""))
    atc_codes = split_pipe(row.get("atc_codes", ""))
    groups = split_pipe(row.get("groups", ""))
    desc_sentence = first_sentence(row.get("description", ""))

    base_id = f"drugbank-{drugbank_id.lower()}" if drugbank_id else f"drugbank-{normalize_name(name).replace(' ', '-')}"
    record_id = make_unique_id(base_id, existing_ids)
    existing_ids.add(record_id)

    indications = []
    if desc_sentence:
        indications.append(desc_sentence)

    pearls = []
    if drugbank_id:
        pearls.append(f"DrugBank ID: {drugbank_id}")
    if groups:
        pearls.append(f"Regulatory groups: {', '.join(groups)}")
    if atc_codes:
        pearls.append(f"ATC codes: {', '.join(atc_codes[:4])}")

    moa = desc_sentence or f"DrugBank record for {name}."

    return {
        "id": record_id,
        "name": name,
        "drugClass": infer_drug_class(row),
        "routes": infer_routes(row),
        "moa": moa,
        "indications": ensure_non_empty_list(indications, f"See DrugBank entry for {name}."),
        "contraindications": [],
        "adverseEffects": [],
        "majorInteractions": [],
        "monitoring": [],
        "aliases": [],
        "brandExamples": [],
        "pearls": pearls,
        "drugbank": {
            "drugbank_id": drugbank_id,
            "name": name,
            "type": clean_text(row.get("type", "")),
            "groups": groups,
            "atc_codes": atc_codes,
            "categories": categories,
            "inchikey": clean_text(row.get("inchikey", "")),
            "inchi": clean_text(row.get("inchi", "")),
            "description_first_sentence": desc_sentence,
        },
    }


def missing_required_fields(record: Dict[str, object]) -> List[str]:
    missing: List[str] = []
    for field in REQUIRED_FIELDS:
        value = record.get(field)
        if isinstance(value, list):
            if len(value) == 0:
                missing.append(field)
        else:
            if not clean_text(value):
                missing.append(field)
    return missing


def run() -> Dict[str, object]:
    source_payload = load_json(INPUT_ENRICHED_JSON_PATH)
    existing_medications_raw = source_payload.get("medications", [])
    if not isinstance(existing_medications_raw, list):
        raise ValueError("Expected `medications` array in enriched JSON input.")
    existing_medications: List[Dict[str, object]] = []
    for med in existing_medications_raw:
        if not isinstance(med, dict):
            continue
        cleaned = remove_generic_placeholders(med)
        cleaned = normalize_drugbank_categories_into_class(cleaned)
        existing_medications.append(cleaned)

    rows = load_tsv_rows(DRUGBANK_TSV_PATH)
    include_groups = {g.lower() for g in INCLUDE_GROUPS}
    exclude_groups = {g.lower() for g in EXCLUDE_GROUPS}
    exclude_if_only_groups = {g.lower() for g in EXCLUDE_IF_ONLY_GROUPS}
    preferred_index = build_preferred_name_index(
        rows,
        include_groups,
        exclude_groups,
        exclude_if_only_groups,
    )

    existing_ids: Set[str] = set()
    existing_name_keys: Set[str] = set()
    existing_drugbank_ids: Set[str] = set()

    for med in existing_medications:
        if not isinstance(med, dict):
            continue
        med_id = clean_text(med.get("id", ""))
        if med_id:
            existing_ids.add(med_id)

        name_key = normalize_name(med.get("name", ""))
        if name_key:
            existing_name_keys.add(name_key)

        aliases = med.get("aliases", [])
        if isinstance(aliases, list):
            for alias in aliases:
                alias_key = normalize_name(alias)
                if alias_key:
                    existing_name_keys.add(alias_key)

        drugbank_meta = med.get("drugbank", {})
        if isinstance(drugbank_meta, dict):
            drugbank_id = clean_text(drugbank_meta.get("drugbank_id", ""))
            if drugbank_id:
                existing_drugbank_ids.add(drugbank_id)

    additions: List[Dict[str, object]] = []
    skipped_existing_name = 0
    skipped_existing_drugbank_id = 0

    for key in sorted(preferred_index.keys()):
        row = preferred_index[key]
        drugbank_id = clean_text(row.get("drugbank_id", ""))

        if key in existing_name_keys:
            skipped_existing_name += 1
            continue
        if drugbank_id and drugbank_id in existing_drugbank_ids:
            skipped_existing_drugbank_id += 1
            continue

        generated = build_generated_record(row, existing_ids)
        additions.append(generated)

        existing_name_keys.add(key)
        if drugbank_id:
            existing_drugbank_ids.add(drugbank_id)

    merged = list(existing_medications) + additions
    if SORT_OUTPUT_BY_NAME:
        merged = sorted(merged, key=lambda item: clean_text(item.get("name", "")).lower())

    invalid_examples: List[Dict[str, object]] = []
    invalid_count = 0
    for med in merged:
        if not isinstance(med, dict):
            invalid_count += 1
            continue
        missing = missing_required_fields(med)
        if missing:
            invalid_count += 1
            if len(invalid_examples) < MAX_EXAMPLE_COUNT:
                invalid_examples.append(
                    {
                        "id": clean_text(med.get("id", "")),
                        "name": clean_text(med.get("name", "")),
                        "missing_fields": missing,
                    }
                )

    output_payload = {"medications": merged}
    OUTPUT_ENRICHED_JSON_PATH.write_text(
        json.dumps(output_payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    report = {
        "input_files": {
            "enriched_json": str(INPUT_ENRICHED_JSON_PATH),
            "drugbank_tsv": str(DRUGBANK_TSV_PATH),
        },
        "output_files": {
            "enriched_json": str(OUTPUT_ENRICHED_JSON_PATH),
            "report_json": str(OUTPUT_REPORT_PATH),
        },
        "config": {
            "include_groups": sorted(include_groups),
            "exclude_groups": sorted(exclude_groups),
            "exclude_if_only_groups": sorted(exclude_if_only_groups),
            "remove_generic_placeholder_text": REMOVE_GENERIC_PLACEHOLDER_TEXT,
            "default_route": DEFAULT_ROUTE,
            "fallback_class": FALLBACK_CLASS,
            "sort_output_by_name": SORT_OUTPUT_BY_NAME,
        },
        "summary": {
            "existing_records": len(existing_medications),
            "selected_drugbank_unique_names": len(preferred_index),
            "added_records": len(additions),
            "final_records": len(merged),
            "skipped_existing_name_matches": skipped_existing_name,
            "skipped_existing_drugbank_id_matches": skipped_existing_drugbank_id,
            "invalid_records": invalid_count,
        },
        "added_examples": [
            {
                "id": clean_text(item.get("id", "")),
                "name": clean_text(item.get("name", "")),
                "drugClass": clean_text(item.get("drugClass", "")),
                "routes": item.get("routes", []),
                "drugbank_id": get_drugbank_id(item),
            }
            for item in additions[:MAX_EXAMPLE_COUNT]
        ],
        "invalid_examples": invalid_examples,
    }

    OUTPUT_REPORT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return report


def main() -> None:
    report = run()
    summary_raw = report.get("summary")
    summary = summary_raw if isinstance(summary_raw, dict) else {}
    print("DrugBank catalog expansion completed.")
    print(f"Existing records: {summary.get('existing_records', 0)}")
    print(f"Added records: {summary.get('added_records', 0)}")
    print(f"Final records: {summary.get('final_records', 0)}")
    print(f"Invalid records: {summary.get('invalid_records', 0)}")
    print(f"Output: {OUTPUT_ENRICHED_JSON_PATH}")
    print(f"Report: {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    main()
