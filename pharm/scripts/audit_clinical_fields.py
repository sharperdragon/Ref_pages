#!/usr/bin/env python3
"""
Audit the pharm catalog for clinical-field quality issues.

This script is designed for VS Code task execution and writes:
1) a JSON audit report for mechanism, indication, and contraindication coverage
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence


# ================================================================
# USER SETTINGS (edit)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]

INPUT_DATASET_PATH = PHARM_DIR / "assests" / "pharm_data_rxclass_enriched.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "clinical_field_audit_report.json"

FALLBACK_MOA = "Mechanism data not available in current static build."
FALLBACK_INDICATION = "Therapeutic indication varies by formulation and clinical context."
FALLBACK_CONTRAINDICATION = "Review official prescribing information for contraindications."

MAX_EXAMPLES_PER_SECTION = 40
MAX_SUSPICIOUS_MOA = 60


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", clean_text(value).casefold()).strip()


def to_text_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [clean_text(item) for item in value if clean_text(item)]
    text = clean_text(value)
    return [text] if text else []


def load_medications(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    medications = payload.get("medications", [])
    if isinstance(medications, list):
        return [item for item in medications if isinstance(item, dict)]
    return []


def build_fallback_report(medications: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    exact_fallback_moa = 0
    exact_fallback_indications = 0
    exact_fallback_contraindications = 0

    fallback_examples: List[Dict[str, Any]] = []

    for medication in medications:
        moa = clean_text(medication.get("moa"))
        indications = to_text_list(medication.get("indications"))
        contraindications = to_text_list(medication.get("contraindications"))

        reasons: List[str] = []

        if moa == FALLBACK_MOA:
            exact_fallback_moa += 1
            reasons.append("fallback_moa")

        if indications == [FALLBACK_INDICATION]:
            exact_fallback_indications += 1
            reasons.append("fallback_indications")

        if contraindications == [FALLBACK_CONTRAINDICATION]:
            exact_fallback_contraindications += 1
            reasons.append("fallback_contraindications")

        if reasons and len(fallback_examples) < MAX_EXAMPLES_PER_SECTION:
            fallback_examples.append(
                {
                    "name": clean_text(medication.get("name")),
                    "id": clean_text(medication.get("id")),
                    "reasons": reasons,
                    "moa": moa,
                    "indications": indications,
                    "contraindications": contraindications,
                }
            )

    total = len(medications) or 1
    return {
        "totalMedications": len(medications),
        "exactFallbackCounts": {
            "moa": exact_fallback_moa,
            "indications": exact_fallback_indications,
            "contraindications": exact_fallback_contraindications,
        },
        "exactFallbackPercentages": {
            "moa": round(exact_fallback_moa / total, 4),
            "indications": round(exact_fallback_indications / total, 4),
            "contraindications": round(exact_fallback_contraindications / total, 4),
        },
        "examples": fallback_examples,
    }


def build_catalog_name_index(medications: Sequence[Dict[str, Any]]) -> List[str]:
    names = {
        normalize_text(medication.get("name"))
        for medication in medications
        if normalize_text(medication.get("name"))
    }
    return sorted(names, key=len, reverse=True)


def is_generic_moa_statement(text: str) -> bool:
    normalized = normalize_text(text)
    return (
        normalized.startswith("the mechanism")
        or normalized.startswith("its mechanism")
        or normalized.startswith("mechanism of action")
        or normalized.startswith("the precise mechanism")
        or normalized.startswith("drugs that inhibit")
        or normalized.startswith("barbiturates are")
        or normalized.startswith("amphetamines are")
        or normalized.startswith("antihistamines appear")
    )


def build_suspicious_moa_report(medications: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_names = build_catalog_name_index(medications)
    suspicious: List[Dict[str, Any]] = []

    for medication in medications:
        name = clean_text(medication.get("name"))
        moa = clean_text(medication.get("moa"))
        if not moa or moa == FALLBACK_MOA:
            continue

        own_name = normalize_text(name)
        moa_normalized = normalize_text(moa)

        matched_other_name = ""
        for candidate in normalized_names:
            if candidate == own_name:
                continue
            if len(candidate) < 6:
                continue
            if candidate in moa_normalized:
                matched_other_name = candidate
                break

        reasons: List[str] = []
        if matched_other_name:
            reasons.append("mentions_other_catalog_drug")
        if not any(token in moa_normalized for token in own_name.split()[:2]) and not is_generic_moa_statement(moa):
            reasons.append("does_not_reference_own_drug_name")

        if reasons:
            suspicious.append(
                {
                    "name": name,
                    "id": clean_text(medication.get("id")),
                    "reasons": reasons,
                    "matchedOtherDrugName": matched_other_name,
                    "moa": moa,
                }
            )

    return {
        "count": len(suspicious),
        "examples": suspicious[:MAX_SUSPICIOUS_MOA],
    }


def build_summary(fallback_report: Dict[str, Any], suspicious_report: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "passesStrictAudit": (
            fallback_report["exactFallbackCounts"]["indications"] == 0
            and fallback_report["exactFallbackCounts"]["contraindications"] == 0
            and fallback_report["exactFallbackCounts"]["moa"] == 0
            and suspicious_report["count"] == 0
        ),
        "headline": (
            "Clinical fields are not fully populated; fallback copy is still present in the generated catalog."
        ),
    }


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def run() -> None:
    medications = load_medications(INPUT_DATASET_PATH)
    fallback_report = build_fallback_report(medications)
    suspicious_report = build_suspicious_moa_report(medications)

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "inputDatasetPath": str(INPUT_DATASET_PATH),
        "summary": build_summary(fallback_report, suspicious_report),
        "fallbackAudit": fallback_report,
        "suspiciousMechanismAudit": suspicious_report,
    }

    write_json(OUTPUT_REPORT_PATH, report)

    print(f"Audited medications: {fallback_report['totalMedications']}")
    print(f"Fallback MOA count: {fallback_report['exactFallbackCounts']['moa']}")
    print(f"Fallback indication count: {fallback_report['exactFallbackCounts']['indications']}")
    print(f"Fallback contraindication count: {fallback_report['exactFallbackCounts']['contraindications']}")
    print(f"Suspicious MOA count: {suspicious_report['count']}")
    print(f"Wrote report: {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    run()
