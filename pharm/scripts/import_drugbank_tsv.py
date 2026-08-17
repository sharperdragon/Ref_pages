#!/usr/bin/env python3
"""
Import and map DrugBank TSV rows into the local pharm_data.json schema.

This script is designed for VSCode task execution and writes:
1) An enriched pharm JSON file with DrugBank metadata attached per matched med.
2) A report file showing what matched and what still needs manual curation.
"""

from __future__ import annotations

import copy
import csv
import json
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple, TypedDict


# =======================
# USER SETTINGS (edit)
# =======================
PHARM_DIR = Path(__file__).resolve().parents[1]
DRUGBANK_TSV_PATH = PHARM_DIR / "assests" / "drugbank.tsv"
INPUT_PHARM_JSON_PATH = PHARM_DIR / "pharm_data.json"
OUTPUT_PHARM_JSON_PATH = PHARM_DIR / "assests" / "pharm_data_drugbank_enriched.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "drugbank_import_report.json"
OVERWRITE_INPUT_PHARM_JSON = False

REQUIRED_FIELDS = [
    "id",
    "name",
    "drugClass",
    "routes",
    "moa",
    "indications",
    "contraindications",
    "adverseEffects",
    "majorInteractions",
    "monitoring",
]

# Optional name cleanup tokens to improve matches like
# "Metoprolol Tartrate" -> "Metoprolol"
NAME_SUFFIX_TOKENS = {
    "hydrochloride",
    "tartrate",
    "succinate",
    "sodium",
    "potassium",
    "calcium",
    "acetate",
    "maleate",
    "phosphate",
    "citrate",
    "clavulanate",
}

MAX_UNMATCHED_EXAMPLES = 50


class ReportInputFiles(TypedDict):
    drugbank_tsv: str
    pharm_data_json: str


class ReportOutputFiles(TypedDict):
    enriched_pharm_json: str
    import_report_json: str


class ReportSummary(TypedDict):
    drugbank_rows: int
    drugbank_unique_names: int
    drugbank_name_collisions: int
    pharm_records: int
    matched_records: int
    unmatched_records: int
    records_with_missing_required_fields: int


class DrugBankImportReport(TypedDict):
    input_files: ReportInputFiles
    output_files: ReportOutputFiles
    summary: ReportSummary
    unmatched_medications: List[str]
    matched_examples: List[Dict[str, object]]
    missing_required_fields: List[Dict[str, object]]


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


def name_without_suffix_tokens(name: str) -> str:
    parts = normalize_name(name).split()
    if not parts:
        return ""
    kept = [p for p in parts if p not in NAME_SUFFIX_TOKENS]
    return " ".join(kept).strip()


def first_sentence(value: object, max_len: int = 280) -> str:
    text = clean_text(value)
    if not text:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    sentence = sentence.strip()
    if len(sentence) <= max_len:
        return sentence
    return sentence[: max_len - 3].rstrip() + "..."


def load_drugbank_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"DrugBank TSV not found: {path}")
    rows: List[Dict[str, str]] = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            rows.append({k: clean_text(v) for k, v in row.items()})
    return rows


def build_drugbank_index(
    rows: Iterable[Dict[str, str]],
) -> Tuple[Dict[str, Dict[str, str]], Dict[str, List[Dict[str, str]]]]:
    primary: Dict[str, Dict[str, str]] = {}
    collisions: Dict[str, List[Dict[str, str]]] = {}

    for row in rows:
        key = normalize_name(row.get("name", ""))
        if not key:
            continue
        groups = split_pipe(row.get("groups", ""))
        is_approved = "approved" in {g.lower() for g in groups}

        existing = primary.get(key)
        if existing is None:
            primary[key] = row
            continue

        existing_groups = split_pipe(existing.get("groups", ""))
        existing_approved = "approved" in {g.lower() for g in existing_groups}

        # Prefer approved records when multiple entries share a normalized name.
        if is_approved and not existing_approved:
            primary[key] = row
            collisions.setdefault(key, []).append(existing)
        else:
            collisions.setdefault(key, []).append(row)

    return primary, collisions


def candidate_names_for_medication(med: Dict[str, object]) -> List[Tuple[str, str]]:
    candidates: List[Tuple[str, str]] = []
    med_name = clean_text(med.get("name", ""))
    if med_name:
        candidates.append((med_name, "name"))

    aliases = med.get("aliases", [])
    if isinstance(aliases, list):
        for alias in aliases:
            alias_text = clean_text(alias)
            if alias_text:
                candidates.append((alias_text, "alias"))

    # Add cleaned versions to improve hit rate.
    augmented: List[Tuple[str, str]] = list(candidates)
    for raw_name, source in candidates:
        stripped = name_without_suffix_tokens(raw_name)
        if stripped and stripped != normalize_name(raw_name):
            augmented.append((stripped, f"{source}:stripped"))

        # Combination fallback: try individual parts split by slash or hyphen.
        for part in re.split(r"[/\-]", raw_name):
            part_clean = clean_text(part)
            if part_clean:
                augmented.append((part_clean, f"{source}:combo-part"))

    # Deduplicate while preserving order.
    seen = set()
    unique: List[Tuple[str, str]] = []
    for candidate, source in augmented:
        key = normalize_name(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append((candidate, source))
    return unique


def find_match(
    med: Dict[str, object], drugbank_index: Dict[str, Dict[str, str]]
) -> Tuple[Optional[Dict[str, str]], Optional[str], Optional[str]]:
    for candidate, source in candidate_names_for_medication(med):
        key = normalize_name(candidate)
        row = drugbank_index.get(key)
        if row:
            return row, source, candidate
    return None, None, None


def ensure_list(value: object) -> List[str]:
    if isinstance(value, list):
        return [clean_text(item) for item in value if clean_text(item)]
    text = clean_text(value)
    return [text] if text else []


def missing_required_fields(record: Dict[str, object]) -> List[str]:
    missing: List[str] = []
    for field in REQUIRED_FIELDS:
        value = record.get(field)
        if isinstance(value, list):
            if not value:
                missing.append(field)
        else:
            if not clean_text(value):
                missing.append(field)
    return missing


def add_drugbank_metadata(med: Dict[str, object], match_row: Dict[str, str]) -> Dict[str, object]:
    out = copy.deepcopy(med)
    out["drugbank"] = {
        "drugbank_id": clean_text(match_row.get("drugbank_id", "")),
        "name": clean_text(match_row.get("name", "")),
        "type": clean_text(match_row.get("type", "")),
        "groups": split_pipe(match_row.get("groups", "")),
        "atc_codes": split_pipe(match_row.get("atc_codes", "")),
        "categories": split_pipe(match_row.get("categories", "")),
        "inchikey": clean_text(match_row.get("inchikey", "")),
        "inchi": clean_text(match_row.get("inchi", "")),
        "description_first_sentence": first_sentence(match_row.get("description", "")),
    }

    aliases = ensure_list(out.get("aliases", []))
    drugbank_name = clean_text(match_row.get("name", ""))
    if drugbank_name and normalize_name(drugbank_name) != normalize_name(out.get("name", "")):
        if drugbank_name not in aliases:
            aliases.append(drugbank_name)
    out["aliases"] = aliases

    # Optional, conservative enrichment: if class is blank, use first category.
    if not clean_text(out.get("drugClass", "")):
        categories = split_pipe(match_row.get("categories", ""))
        if categories:
            out["drugClass"] = categories[0]

    return out


def run() -> DrugBankImportReport:
    drugbank_rows = load_drugbank_rows(DRUGBANK_TSV_PATH)
    drugbank_index, collisions = build_drugbank_index(drugbank_rows)

    source_data = json.loads(INPUT_PHARM_JSON_PATH.read_text(encoding="utf-8"))
    medications = source_data.get("medications", [])
    if not isinstance(medications, list):
        raise ValueError("Expected `medications` to be an array in pharm_data.json")

    enriched_medications: List[Dict[str, object]] = []
    match_details: List[Dict[str, object]] = []
    unmatched: List[str] = []
    missing_report: List[Dict[str, object]] = []

    for med in medications:
        med_name = clean_text(med.get("name", ""))
        match_row, match_source, match_candidate = find_match(med, drugbank_index)
        if match_row:
            enriched = add_drugbank_metadata(med, match_row)
            enriched_medications.append(enriched)
            match_details.append(
                {
                    "medication": med_name,
                    "matched_drugbank_name": clean_text(match_row.get("name", "")),
                    "drugbank_id": clean_text(match_row.get("drugbank_id", "")),
                    "match_source": match_source,
                    "match_candidate": match_candidate,
                }
            )
        else:
            enriched_medications.append(copy.deepcopy(med))
            unmatched.append(med_name)

        missing_fields = missing_required_fields(enriched_medications[-1])
        if missing_fields:
            missing_report.append({"medication": med_name, "missing_fields": missing_fields})

    output_payload = {"medications": enriched_medications}
    output_path = INPUT_PHARM_JSON_PATH if OVERWRITE_INPUT_PHARM_JSON else OUTPUT_PHARM_JSON_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output_payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    report: DrugBankImportReport = {
        "input_files": {
            "drugbank_tsv": str(DRUGBANK_TSV_PATH),
            "pharm_data_json": str(INPUT_PHARM_JSON_PATH),
        },
        "output_files": {
            "enriched_pharm_json": str(output_path),
            "import_report_json": str(OUTPUT_REPORT_PATH),
        },
        "summary": {
            "drugbank_rows": len(drugbank_rows),
            "drugbank_unique_names": len(drugbank_index),
            "drugbank_name_collisions": len(collisions),
            "pharm_records": len(medications),
            "matched_records": len(match_details),
            "unmatched_records": len(unmatched),
            "records_with_missing_required_fields": len(missing_report),
        },
        "unmatched_medications": unmatched[:MAX_UNMATCHED_EXAMPLES],
        "matched_examples": match_details[:MAX_UNMATCHED_EXAMPLES],
        "missing_required_fields": missing_report,
    }
    OUTPUT_REPORT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return report


def main() -> None:
    report = run()
    summary = report["summary"]
    output_files = report["output_files"]
    print("DrugBank import completed.")
    print(f"Matched: {summary['matched_records']} / {summary['pharm_records']}")
    print(f"Unmatched: {summary['unmatched_records']}")
    print(f"Enriched output: {output_files['enriched_pharm_json']}")
    print(f"Report: {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    main()
