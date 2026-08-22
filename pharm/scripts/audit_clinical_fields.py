#!/usr/bin/env python3
"""Audit the single Pharm runtime dataset for clinical-data quality."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ================================================================
# USER SETTINGS (edit)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]
INPUT_DATASET_PATH = PHARM_DIR / "assests" / "pharm_data_rxclass_enriched.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "clinical_field_audit_report.json"
CLINICAL_FIELDS = ("moa", "indications", "contraindications", "adverseEffects", "majorInteractions", "monitoring", "pearls")
FALLBACK_PREFIXES = ("therapy class and common inpatient use:", "common inpatient use:", "therapeutic indication varies by formulation and clinical context.", "review official prescribing information", "monitor for medication-specific adverse effects", "monitor based on indication", "monitor per indication", "none listed.")
MAX_EXAMPLES = 50


def text(value: Any) -> str:
    return str(value or "").strip()


def normalized(value: Any) -> str:
    value = text(value).casefold().replace("_", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


def text_list(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return [text(item) for item in values]


def is_fallback(value: Any) -> bool:
    value = normalized(value)
    return not value or any(value.startswith(normalized(prefix)) for prefix in FALLBACK_PREFIXES)


def load_medications() -> list[dict[str, Any]]:
    payload = json.loads(INPUT_DATASET_PATH.read_text(encoding="utf-8"))
    rows = payload if isinstance(payload, list) else payload.get("medications", []) if isinstance(payload, dict) else []
    return [row for row in rows if isinstance(row, dict)]


def add_example(target: list[dict[str, Any]], item: dict[str, Any]) -> None:
    if len(target) < MAX_EXAMPLES:
        target.append(item)


def audit(medications: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts = {field: Counter() for field in CLINICAL_FIELDS}
    fallback_values: list[dict[str, Any]] = []
    class_as_clinical: list[dict[str, Any]] = []
    duplicate_clinical_values: list[dict[str, Any]] = []
    empty_array_values: list[dict[str, Any]] = []
    missing_provenance: list[dict[str, Any]] = []
    conflicting_identifiers: list[dict[str, Any]] = []
    suspicious_duplicates: list[dict[str, Any]] = []
    rxcui_to_names: dict[str, set[str]] = defaultdict(set)
    names_to_ids: dict[str, set[str]] = defaultdict(set)

    for medication in medications:
        name = text(medication.get("name"))
        med_id = text(medication.get("id"))
        name_key = normalized(name)
        names_to_ids[name_key].add(med_id)
        rxnorm = medication.get("rxnorm") if isinstance(medication.get("rxnorm"), dict) else {}
        rxcui = text(rxnorm.get("rxcui"))
        if rxcui:
            rxcui_to_names[rxcui].add(name)
        class_labels = {normalized(value) for path in medication.get("classPaths", []) if isinstance(path, list) for value in path}
        provenance = medication.get("provenance") if isinstance(medication.get("provenance"), dict) else {}
        statuses = medication.get("clinicalDataStatus") if isinstance(medication.get("clinicalDataStatus"), dict) else {}

        for field in CLINICAL_FIELDS:
            value = medication.get(field, "" if field == "moa" else [])
            values = [text(value)] if field == "moa" and text(value) else ([] if field == "moa" else text_list(value))
            status = text(statuses.get(field)) or ("verified" if any(values) else "missing")
            status_counts[field][status] += 1
            if any(values) and not text_list(provenance.get(field)):
                add_example(missing_provenance, {"name": name, "field": field})
            seen: set[str] = set()
            for entry in values:
                key = normalized(entry)
                if not entry:
                    add_example(empty_array_values, {"name": name, "field": field})
                    continue
                if key in seen:
                    add_example(duplicate_clinical_values, {"name": name, "field": field, "value": entry})
                seen.add(key)
                if is_fallback(entry):
                    add_example(fallback_values, {"name": name, "field": field, "value": entry})
                if field in {"moa", "indications"} and key in class_labels:
                    add_example(class_as_clinical, {"name": name, "field": field, "value": entry})

    for rxcui, names in rxcui_to_names.items():
        if len(names) > 1:
            add_example(conflicting_identifiers, {"rxcui": rxcui, "names": sorted(names)})
    for name_key, ids in names_to_ids.items():
        if len(ids) > 1:
            add_example(suspicious_duplicates, {"normalizedName": name_key, "ids": sorted(ids)})

    field_statuses = {field: dict(counter) for field, counter in status_counts.items()}
    has_legacy = any(counter.get("legacy-unverified", 0) for counter in status_counts.values())
    valid = not any((fallback_values, class_as_clinical, duplicate_clinical_values, empty_array_values, missing_provenance, conflicting_identifiers, suspicious_duplicates))
    return {
        "totalMedications": len(medications), "clinicalFieldStatuses": field_statuses,
        "verifiedData": {field: counter.get("verified", 0) for field, counter in status_counts.items()},
        "missingData": {field: counter.get("missing", 0) for field, counter in status_counts.items()},
        "legacyUnverifiedData": {field: counter.get("legacy-unverified", 0) for field, counter in status_counts.items()},
        "invalidFallbackData": fallback_values, "classLabelsMasqueradingAsClinicalData": class_as_clinical,
        "duplicateClinicalListEntries": duplicate_clinical_values, "emptyStringsInsideClinicalArrays": empty_array_values,
        "missingProvenanceForNonEmptyClinicalFields": missing_provenance, "conflictingMedicationIdentifiers": conflicting_identifiers,
        "suspiciousDuplicateMedicationRecords": suspicious_duplicates, "hasLegacyUnverifiedData": has_legacy, "passesStrictAudit": valid,
    }


def main() -> None:
    report = audit(load_medications())
    output = {"generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "inputDatasetPath": str(INPUT_DATASET_PATH.relative_to(PHARM_DIR)), "report": report}
    OUTPUT_REPORT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Audited medications: {report['totalMedications']}")
    print(f"Strict audit passed: {report['passesStrictAudit']}")
    print(f"Wrote {OUTPUT_REPORT_PATH.relative_to(PHARM_DIR)}")


if __name__ == "__main__":
    main()
