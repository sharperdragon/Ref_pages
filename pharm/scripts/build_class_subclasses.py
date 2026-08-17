#!/usr/bin/env python3
"""
Generate subclass taxonomy artifacts for pharm class filtering.

Outputs:
1) One subclass file per curated primary family in `pharm/assests/classes`.
2) A master index file at `pharm/assests/classes/class_subclasses_index.json`.
3) A build report file at `pharm/assests/classes/class_subclasses_build_report.json`.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple


# =======================
# USER SETTINGS (edit)
# =======================
PHARM_DIR = Path(__file__).resolve().parents[1]
CLASSES_SIMPLE_PATH = PHARM_DIR / "assests" / "classes_simple.json"
ENRICHED_DATA_PATH = PHARM_DIR / "assests" / "pharm_data_drugbank_enriched.json"
FAMILY_SOURCE_PATH = PHARM_DIR / "assests" / "classes" / "drug_class_families.json"
REMOVE_LIST_PATH = PHARM_DIR / "assests" / "classes_remove.txt"
OUTPUT_CLASSES_DIR = PHARM_DIR / "assests" / "classes"
MASTER_INDEX_PATH = OUTPUT_CLASSES_DIR / "class_subclasses_index.json"
BUILD_REPORT_PATH = OUTPUT_CLASSES_DIR / "class_subclasses_build_report.json"

SUBCLASS_FILE_SUFFIX = "_subclasses.json"
INDEX_VERSION = "2"
APPROVED_GROUP_NAME = "approved"
CLEAN_EXISTING_SUBCLASS_FILES = True

# Optional quality gates. Keep False during iterative curation.
ENFORCE_MAX_PRIMARY_COUNT = False
MAX_PRIMARY_COUNT = 90
ENFORCE_MIN_MEDICATION_COVERAGE = False
MIN_MEDICATION_COVERAGE = 0.90


def clean_text(value: object) -> str:
    return str(value or "").strip()


def normalize_text(value: object) -> str:
    text = clean_text(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slugify(value: object) -> str:
    text = normalize_text(value)
    slug = text.replace(" ", "-")
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "class"


def ensure_unique_slug(base_slug: str, used_slugs: Set[str]) -> str:
    if base_slug not in used_slugs:
        used_slugs.add(base_slug)
        return base_slug

    suffix = 2
    while True:
        candidate = f"{base_slug}-{suffix}"
        if candidate not in used_slugs:
            used_slugs.add(candidate)
            return candidate
        suffix += 1


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def to_text_list(value: object) -> List[str]:
    if isinstance(value, list):
        return [clean_text(v) for v in value if clean_text(v)]

    cleaned = clean_text(value)
    return [cleaned] if cleaned else []


def load_classes_simple(path: Path) -> List[str]:
    payload = load_json(path)
    classes = payload.get("classes", []) if isinstance(payload, dict) else payload

    if not isinstance(classes, list):
        raise ValueError(f"Expected list of classes in {path}")

    ordered: List[str] = []
    seen: Set[str] = set()
    for item in classes:
        label = clean_text(item)
        if not label:
            continue
        key = normalize_text(label)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(label)

    return ordered


def load_medications(path: Path) -> List[Dict[str, object]]:
    payload = load_json(path)
    if isinstance(payload, list):
        meds = payload
    elif isinstance(payload, dict) and isinstance(payload.get("medications"), list):
        meds = payload["medications"]
    else:
        raise ValueError(f"Unable to read medications array from {path}")

    return [item for item in meds if isinstance(item, dict)]


def load_remove_list(path: Path) -> List[str]:
    if not path.exists():
        return []

    items: List[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        label = clean_text(raw)
        if not label:
            continue
        if label.endswith(":"):
            continue
        items.append(label)

    deduped: List[str] = []
    seen: Set[str] = set()
    for label in items:
        key = normalize_text(label)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(label)

    return deduped


def load_family_source(path: Path) -> Dict[str, object]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected object payload in {path}")

    fallback_payload = payload.get("fallback") if isinstance(payload.get("fallback"), dict) else {}
    fallback = {
        "primaryClass": clean_text(fallback_payload.get("primaryClass")) or "Other Classes",
        "slug": clean_text(fallback_payload.get("slug")) or "other-classes",
        "subclass": clean_text(fallback_payload.get("subclass")) or "Unmapped",
    }

    families_payload = payload.get("families")
    if not isinstance(families_payload, list):
        raise ValueError(f"Expected 'families' list in {path}")

    families: List[Dict[str, object]] = []
    for entry in families_payload:
        if not isinstance(entry, dict):
            continue

        primary_class = clean_text(entry.get("primaryClass"))
        if not primary_class:
            continue

        slug = clean_text(entry.get("slug")) or slugify(primary_class)

        families.append(
            {
                "primaryClass": primary_class,
                "slug": slug,
                "includeExact": to_text_list(entry.get("includeExact")),
                "includePrefixes": to_text_list(entry.get("includePrefixes")),
                "includeContains": to_text_list(entry.get("includeContains")),
                "excludeExact": to_text_list(entry.get("excludeExact")),
            }
        )

    if len(families) == 0:
        raise ValueError(f"No usable family definitions found in {path}")

    return {
        "fallback": fallback,
        "families": families,
    }


def medication_groups(record: Dict[str, object]) -> Set[str]:
    drugbank_meta = record.get("drugbank")
    if not isinstance(drugbank_meta, dict):
        return set()

    groups = to_text_list(drugbank_meta.get("groups"))
    return {normalize_text(g) for g in groups if normalize_text(g)}


def medication_class_labels(record: Dict[str, object]) -> Set[str]:
    labels: Set[str] = set()

    drug_class = clean_text(record.get("drugClass"))
    if drug_class:
        labels.add(drug_class)

    drugbank_meta = record.get("drugbank")
    if isinstance(drugbank_meta, dict):
        for category in to_text_list(drugbank_meta.get("categories")):
            labels.add(category)

    return labels


def collect_class_counts(
    medications: Iterable[Dict[str, object]],
    canonical_classes: Set[str],
) -> Tuple[Dict[str, int], Dict[str, int]]:
    all_counts: Dict[str, int] = {label: 0 for label in canonical_classes}
    approved_counts: Dict[str, int] = {label: 0 for label in canonical_classes}

    normalized_to_canonical = {normalize_text(label): label for label in canonical_classes}

    for med in medications:
        groups = medication_groups(med)
        approved = APPROVED_GROUP_NAME in groups

        labels = medication_class_labels(med)
        matched_labels: Set[str] = set()
        for raw in labels:
            canonical = normalized_to_canonical.get(normalize_text(raw))
            if canonical:
                matched_labels.add(canonical)

        for label in matched_labels:
            all_counts[label] += 1
            if approved:
                approved_counts[label] += 1

    return all_counts, approved_counts


def resolve_remove_classes(remove_labels: List[str], canonical_classes: Iterable[str]) -> Set[str]:
    canonical_by_norm = {normalize_text(label): label for label in canonical_classes}
    removed: Set[str] = set()

    for label in remove_labels:
        canonical = canonical_by_norm.get(normalize_text(label))
        if canonical:
            removed.add(canonical)

    return removed


def normalize_phrase_set(values: Iterable[str]) -> Set[str]:
    return {normalize_text(value) for value in values if normalize_text(value)}


def label_matches_family(label: str, family: Dict[str, object]) -> bool:
    normalized_label = normalize_text(label)
    if not normalized_label:
        return False

    include_exact = normalize_phrase_set(to_text_list(family.get("includeExact")))
    include_prefixes = normalize_phrase_set(to_text_list(family.get("includePrefixes")))
    include_contains = normalize_phrase_set(to_text_list(family.get("includeContains")))
    exclude_exact = normalize_phrase_set(to_text_list(family.get("excludeExact")))

    matched = False

    if normalized_label in include_exact:
        matched = True

    if not matched:
        for prefix in include_prefixes:
            if normalized_label == prefix or normalized_label.startswith(f"{prefix} "):
                matched = True
                break

    if not matched:
        for phrase in include_contains:
            if phrase and phrase in normalized_label:
                matched = True
                break

    if not matched:
        return False

    return normalized_label not in exclude_exact


def build_primary_records(
    ordered_classes: List[str],
    approved_counts: Dict[str, int],
    removed_classes: Set[str],
    families: List[Dict[str, object]],
) -> List[Dict[str, object]]:
    supported = {
        label
        for label, count in approved_counts.items()
        if count > 0 and label not in removed_classes
    }

    family_subclasses: List[List[str]] = [[] for _ in families]
    for label in ordered_classes:
        if label not in supported:
            continue

        for family_index, family in enumerate(families):
            if label_matches_family(label, family):
                family_subclasses[family_index].append(label)
                break

    used_slugs: Set[str] = set()
    records: List[Dict[str, object]] = []

    for family_index, family in enumerate(families):
        primary_class = clean_text(family.get("primaryClass"))
        if not primary_class:
            continue

        subclasses = sorted(family_subclasses[family_index], key=lambda item: item.lower())

        if not subclasses:
            continue

        base_slug = clean_text(family.get("slug")) or slugify(primary_class)
        slug = ensure_unique_slug(base_slug, used_slugs)
        file_name = f"{slug}{SUBCLASS_FILE_SUFFIX}"

        records.append(
            {
                "primaryClass": primary_class,
                "slug": slug,
                "fileName": file_name,
                "subclasses": subclasses,
            }
        )

    return records


def write_primary_files(records: List[Dict[str, object]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    if CLEAN_EXISTING_SUBCLASS_FILES:
        for existing in output_dir.glob(f"*{SUBCLASS_FILE_SUFFIX}"):
            existing.unlink()

    for record in records:
        payload = {
            "primaryClass": record["primaryClass"],
            "slug": record["slug"],
            "subclasses": record["subclasses"],
        }

        file_path = output_dir / str(record["fileName"])
        file_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_master_index(
    records: List[Dict[str, object]],
    classes_simple_path: Path,
    enriched_data_path: Path,
    family_source_path: Path,
    remove_list_path: Path,
    fallback: Dict[str, str],
    output_path: Path,
) -> None:
    primaries = [
        {
            "primaryClass": record["primaryClass"],
            "slug": record["slug"],
            "file": f"classes/{record['fileName']}",
            "subclasses": record["subclasses"],
        }
        for record in records
    ]

    payload = {
        "version": INDEX_VERSION,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sourceFiles": {
            "classesSimple": str(classes_simple_path),
            "enrichedData": str(enriched_data_path),
            "familySource": str(family_source_path),
            "removeList": str(remove_list_path),
        },
        "fallback": {
            "primaryClass": clean_text(fallback.get("primaryClass")) or "Other Classes",
            "slug": clean_text(fallback.get("slug")) or "other-classes",
            "subclass": clean_text(fallback.get("subclass")) or "Unmapped",
        },
        "primaries": primaries,
    }

    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def validate_outputs(
    records: List[Dict[str, object]],
    ordered_classes: List[str],
    approved_counts: Dict[str, int],
    output_dir: Path,
    index_path: Path,
) -> None:
    canonical_set = set(ordered_classes)

    slugs = [str(record["slug"]) for record in records]
    if len(slugs) != len(set(slugs)):
        raise ValueError("Duplicate slugs detected in generated records.")

    for record in records:
        subclasses = list(record["subclasses"])
        if len(subclasses) != len(set(subclasses)):
            raise ValueError(f"Duplicate subclasses in primary {record['primaryClass']}")

        for subclass in subclasses:
            if subclass not in canonical_set:
                raise ValueError(f"Subclass '{subclass}' not found in classes_simple.json")
            if approved_counts.get(subclass, 0) <= 0:
                raise ValueError(f"Subclass '{subclass}' has zero approved support")

        output_file = output_dir / str(record["fileName"])
        if not output_file.exists():
            raise ValueError(f"Missing generated primary file: {output_file}")

    if not index_path.exists():
        raise ValueError(f"Missing master index file: {index_path}")


def build_class_to_primary_lookup(records: List[Dict[str, object]]) -> Dict[str, Set[str]]:
    lookup: Dict[str, Set[str]] = {}
    for record in records:
        primary_class = clean_text(record.get("primaryClass"))
        if not primary_class:
            continue

        for subclass in to_text_list(record.get("subclasses")):
            key = normalize_text(subclass)
            if not key:
                continue
            if key not in lookup:
                lookup[key] = set()
            lookup[key].add(primary_class)

    return lookup


def build_coverage_report(
    medications: List[Dict[str, object]],
    records: List[Dict[str, object]],
    all_counts: Dict[str, int],
    approved_counts: Dict[str, int],
    removed_classes: Set[str],
    report_path: Path,
) -> Dict[str, object]:
    class_to_primary = build_class_to_primary_lookup(records)

    mapped_medications = 0
    unmapped_medications = 0

    for med in medications:
        labels = medication_class_labels(med)
        label_keys = {normalize_text(label) for label in labels if normalize_text(label)}

        if any(key in class_to_primary for key in label_keys):
            mapped_medications += 1
        else:
            unmapped_medications += 1

    total_medications = len(medications)
    medication_coverage = (
        float(mapped_medications) / float(total_medications)
        if total_medications > 0
        else 0.0
    )

    supported_classes = [label for label, count in approved_counts.items() if count > 0]
    mapped_subclass_keys = set(class_to_primary.keys())

    mapped_supported_classes = [
        label
        for label in supported_classes
        if normalize_text(label) in mapped_subclass_keys
    ]

    unmapped_supported_classes = sorted(
        [
            label
            for label in supported_classes
            if normalize_text(label) not in mapped_subclass_keys and label not in removed_classes
        ],
        key=lambda item: item.lower(),
    )

    report_payload = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "counts": {
            "medicationsTotal": total_medications,
            "medicationsMapped": mapped_medications,
            "medicationsUnmapped": unmapped_medications,
            "medicationCoverage": round(medication_coverage, 4),
            "classesTotal": len(all_counts),
            "classesApprovedSupported": len(supported_classes),
            "classesRemoved": len(removed_classes),
            "classesMappedToPrimaries": len(mapped_supported_classes),
            "classesUnmappedToPrimaries": len(unmapped_supported_classes),
            "primaryCount": len(records),
        },
        "unmappedApprovedClasses": unmapped_supported_classes,
    }

    report_path.write_text(json.dumps(report_payload, indent=2) + "\n", encoding="utf-8")
    return report_payload


def enforce_quality_gates(report_payload: Dict[str, object]) -> None:
    counts = report_payload.get("counts") if isinstance(report_payload, dict) else {}
    if not isinstance(counts, dict):
        return

    primary_count = int(counts.get("primaryCount") or 0)
    medication_coverage = float(counts.get("medicationCoverage") or 0.0)

    if ENFORCE_MAX_PRIMARY_COUNT and primary_count > MAX_PRIMARY_COUNT:
        raise ValueError(
            f"Primary class count {primary_count} exceeds configured maximum {MAX_PRIMARY_COUNT}."
        )

    if ENFORCE_MIN_MEDICATION_COVERAGE and medication_coverage < MIN_MEDICATION_COVERAGE:
        raise ValueError(
            "Medication coverage "
            f"{medication_coverage:.4f} is below minimum {MIN_MEDICATION_COVERAGE:.4f}."
        )


def run() -> None:
    ordered_classes = load_classes_simple(CLASSES_SIMPLE_PATH)
    medications = load_medications(ENRICHED_DATA_PATH)
    family_source = load_family_source(FAMILY_SOURCE_PATH)
    remove_labels = load_remove_list(REMOVE_LIST_PATH)

    all_counts, approved_counts = collect_class_counts(medications, set(ordered_classes))

    removed_classes = resolve_remove_classes(remove_labels, ordered_classes)

    records = build_primary_records(
        ordered_classes,
        approved_counts,
        removed_classes,
        family_source["families"],
    )

    write_primary_files(records, OUTPUT_CLASSES_DIR)
    write_master_index(
        records,
        CLASSES_SIMPLE_PATH,
        ENRICHED_DATA_PATH,
        FAMILY_SOURCE_PATH,
        REMOVE_LIST_PATH,
        family_source["fallback"],
        MASTER_INDEX_PATH,
    )
    validate_outputs(records, ordered_classes, approved_counts, OUTPUT_CLASSES_DIR, MASTER_INDEX_PATH)

    report_payload = build_coverage_report(
        medications,
        records,
        all_counts,
        approved_counts,
        removed_classes,
        BUILD_REPORT_PATH,
    )
    enforce_quality_gates(report_payload)

    counts = report_payload.get("counts", {}) if isinstance(report_payload, dict) else {}
    print("Subclass taxonomy build completed.")
    print(f"- Primary classes generated: {counts.get('primaryCount', 0)}")
    print(f"- Approved-supported classes: {counts.get('classesApprovedSupported', 0)}")
    print(f"- Mapped approved classes: {counts.get('classesMappedToPrimaries', 0)}")
    print(f"- Medication coverage: {counts.get('medicationCoverage', 0):.4f}")
    print(f"- Master index: {MASTER_INDEX_PATH}")
    print(f"- Build report: {BUILD_REPORT_PATH}")


if __name__ == "__main__":
    run()
