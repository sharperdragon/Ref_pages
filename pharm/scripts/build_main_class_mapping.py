#!/usr/bin/env python3
"""
Build deterministic medication -> canonical class mappings from the compiled hierarchy.

Outputs:
1) main_class_mapping.json
2) main_hierarchy_mapping_report.json
3) main_hierarchy_aliases.json bootstrap (if missing)
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


# =======================
# USER SETTINGS (edit)
# =======================
PHARM_DIR = Path(__file__).resolve().parents[1]

MEDICATIONS_SOURCE_PATH = PHARM_DIR / "assests" / "pharm_data_rxclass_enriched.json"
HIERARCHY_INDEX_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_index.json"
HIERARCHY_PATHS_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_paths.json"
ALIASES_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_aliases.json"

OUTPUT_MAPPING_PATH = PHARM_DIR / "assests" / "classes" / "main_class_mapping.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_mapping_report.json"

MAPPING_VERSION = "2"

SOURCE_KIND_DRUG_CLASS = "drugClass"
SOURCE_KIND_SPECIFIC_CLASS = "specificClassLabel"
SOURCE_KIND_CLASS_CANDIDATE = "classCandidate"
SOURCE_KIND_CLASS_TAG = "classTag"

SOURCE_WEIGHT_DRUG_CLASS = 100
SOURCE_WEIGHT_SPECIFIC_CLASS = 95
SOURCE_WEIGHT_CLASS_CANDIDATE = 78
SOURCE_WEIGHT_CLASS_TAG = 68

MATCH_WEIGHT_ALIAS = 300
MATCH_WEIGHT_EXACT = 220
MATCH_WEIGHT_PHRASE = 160
MATCH_WEIGHT_CONTAINS = 120
DEPTH_WEIGHT_PER_LEVEL = 18

WARN_UNMAPPED_MEDICATION_RATIO = 0.25
WARN_TOP_UNMAPPED_LABEL_COUNT = 20
MAX_TOP_UNMAPPED_LABELS = 30

DEFAULT_ALIASES_PAYLOAD = {
    "version": MAPPING_VERSION,
    "byDrugClass": {
        "selective serotonin reuptake inhibitor": "drug_classes.central_nervous_system.psychiatric_agents.antidepressants.ssris",
        "serotonin norepinephrine reuptake inhibitor": "drug_classes.central_nervous_system.psychiatric_agents.antidepressants.snris",
        "benzodiazepine": "drug_classes.central_nervous_system.anesthetic_and_sedative_agents.benzodiazepines",
        "tricyclic antidepressant": "drug_classes.central_nervous_system.psychiatric_agents.antidepressants.tricyclic_antidepressants",
        "typical antipsychotic": "drug_classes.central_nervous_system.psychiatric_agents.antipsychotics.first_generation",
        "atypical antipsychotic": "drug_classes.central_nervous_system.psychiatric_agents.antipsychotics.second_generation",
        "central nervous system stimulant": "drug_classes.central_nervous_system.psychiatric_agents.adhd_agents.stimulants",
    },
    "bySpecificClass": {},
    "byClassCandidate": {},
    "byClassTag": {},
    "phraseRules": [
        {
            "name": "SSRIs",
            "source": "all",
            "contains": ["serotonin", "reuptake", "inhibitor"],
            "targetId": "drug_classes.central_nervous_system.psychiatric_agents.antidepressants.ssris",
        },
        {
            "name": "SNRIs",
            "source": "all",
            "contains": ["serotonin", "norepinephrine", "reuptake", "inhibitor"],
            "targetId": "drug_classes.central_nervous_system.psychiatric_agents.antidepressants.snris",
        },
        {
            "name": "Benzodiazepines",
            "source": "all",
            "contains": ["benzodiazepine"],
            "targetId": "drug_classes.central_nervous_system.anesthetic_and_sedative_agents.benzodiazepines",
        },
    ],
}


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    text = clean_text(value).lower()
    text = text.replace("&", " and ")
    text = text.replace("_", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def to_text_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [clean_text(item) for item in value if clean_text(item)]
    cleaned = clean_text(value)
    return [cleaned] if cleaned else []


def uniq(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = clean_text(value)
        key = normalize_text(cleaned)
        if not cleaned or not key or key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def ensure_aliases_payload(path: Path) -> Dict[str, Any]:
    if path.exists():
        payload = load_json(path)
        if isinstance(payload, dict):
            payload.setdefault("version", MAPPING_VERSION)
            payload.setdefault("byDrugClass", {})
            payload.setdefault("bySpecificClass", {})
            payload.setdefault("byClassCandidate", {})
            payload.setdefault("byClassTag", {})
            payload.setdefault("phraseRules", [])
            return payload

    write_json(path, DEFAULT_ALIASES_PAYLOAD)
    return DEFAULT_ALIASES_PAYLOAD


def load_medications(path: Path) -> List[Dict[str, Any]]:
    payload = load_json(path)
    if isinstance(payload, list):
        meds = payload
    elif isinstance(payload, dict) and isinstance(payload.get("medications"), list):
        meds = payload["medications"]
    else:
        raise ValueError(f"Unable to read medications from {path}")
    return [item for item in meds if isinstance(item, dict)]


def load_hierarchy_index(path: Path) -> Dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected object payload in {path}")

    fallback_node_id = clean_text(payload.get("fallbackNodeId"))
    fallback_path_ids = to_text_list(payload.get("fallbackPathIds"))
    fallback_path_labels = to_text_list(payload.get("fallbackPathLabels"))

    node_by_id: Dict[str, Dict[str, Any]] = {}

    nodes = payload.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = clean_text(node.get("id"))
            if not node_id:
                continue
            node_by_id[node_id] = node

    return {
        "fallbackNodeId": fallback_node_id,
        "fallbackPathIds": fallback_path_ids,
        "fallbackPathLabels": fallback_path_labels,
        "nodeById": node_by_id,
    }


def load_hierarchy_paths(path: Path) -> List[Dict[str, Any]]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected object payload in {path}")

    nodes = payload.get("paths")
    if not isinstance(nodes, list):
        nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError(f"Expected 'paths' or 'nodes' list in {path}")

    parsed: List[Dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = clean_text(node.get("id"))
        label = clean_text(node.get("label"))
        depth = int(node.get("depth") or 0)
        path_ids = to_text_list(node.get("pathIds"))
        path_labels = to_text_list(node.get("pathLabels"))
        if not node_id or not label:
            continue
        parsed.append(
            {
                "id": node_id,
                "label": label,
                "labelNorm": normalize_text(label),
                "depth": depth,
                "pathIds": path_ids,
                "pathLabels": path_labels,
            }
        )

    parsed.sort(key=lambda item: (item.get("depth", 0), item.get("labelNorm", "")), reverse=True)
    return parsed


def build_label_lookup(paths: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    lookup: Dict[str, List[Dict[str, Any]]] = {}
    for node in paths:
        key = clean_text(node.get("labelNorm"))
        if not key:
            continue
        lookup.setdefault(key, []).append(node)
    return lookup


def extract_source_labels(medication: Dict[str, Any]) -> List[Tuple[str, str, int]]:
    labels: List[Tuple[str, str, int]] = []

    drug_class = clean_text(medication.get("drugClass"))
    if drug_class:
        labels.append((SOURCE_KIND_DRUG_CLASS, drug_class, SOURCE_WEIGHT_DRUG_CLASS))

    specific = clean_text(medication.get("specificClassLabel"))
    if specific:
        labels.append((SOURCE_KIND_SPECIFIC_CLASS, specific, SOURCE_WEIGHT_SPECIFIC_CLASS))

    for candidate in to_text_list(medication.get("classCandidates")):
        labels.append((SOURCE_KIND_CLASS_CANDIDATE, candidate, SOURCE_WEIGHT_CLASS_CANDIDATE))

    for tag in to_text_list(medication.get("classTags")):
        labels.append((SOURCE_KIND_CLASS_TAG, tag, SOURCE_WEIGHT_CLASS_TAG))

    deduped: List[Tuple[str, str, int]] = []
    seen: set[Tuple[str, str]] = set()
    for source_kind, source_label, source_weight in labels:
        key = (source_kind, normalize_text(source_label))
        if not key[1] or key in seen:
            continue
        seen.add(key)
        deduped.append((source_kind, source_label, source_weight))

    return deduped


def alias_target_id_for_label(
    aliases_payload: Dict[str, Any],
    source_kind: str,
    normalized_label: str,
) -> str:
    by_source_map: Dict[str, str] = {
        SOURCE_KIND_DRUG_CLASS: "byDrugClass",
        SOURCE_KIND_SPECIFIC_CLASS: "bySpecificClass",
        SOURCE_KIND_CLASS_CANDIDATE: "byClassCandidate",
        SOURCE_KIND_CLASS_TAG: "byClassTag",
    }

    alias_bucket_name = by_source_map.get(source_kind, "")
    if not alias_bucket_name:
        return ""

    alias_bucket = aliases_payload.get(alias_bucket_name)
    if not isinstance(alias_bucket, dict):
        return ""

    for key, target_id in alias_bucket.items():
        if normalize_text(key) == normalized_label:
            return clean_text(target_id)

    return ""


def phrase_rule_target_id(
    aliases_payload: Dict[str, Any],
    source_kind: str,
    normalized_label: str,
) -> str:
    rules = aliases_payload.get("phraseRules")
    if not isinstance(rules, list):
        return ""

    source_to_rule_scope = {
        SOURCE_KIND_DRUG_CLASS: "drugClass",
        SOURCE_KIND_SPECIFIC_CLASS: "specificClass",
        SOURCE_KIND_CLASS_CANDIDATE: "classCandidate",
        SOURCE_KIND_CLASS_TAG: "classTag",
    }
    current_scope = source_to_rule_scope.get(source_kind, "")

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        scope = clean_text(rule.get("source"))
        if scope and scope not in {"all", current_scope}:
            continue

        contains = [normalize_text(item) for item in to_text_list(rule.get("contains")) if normalize_text(item)]
        if not contains:
            continue
        if not all(token in normalized_label for token in contains):
            continue

        target_id = clean_text(rule.get("targetId"))
        if target_id:
            return target_id

    return ""


def score_candidate(
    source_weight: int,
    match_weight: int,
    node_depth: int,
) -> int:
    return source_weight + match_weight + (max(node_depth, 0) * DEPTH_WEIGHT_PER_LEVEL)


def choose_mapping_for_medication(
    medication: Dict[str, Any],
    label_lookup: Dict[str, List[Dict[str, Any]]],
    hierarchy_paths: List[Dict[str, Any]],
    hierarchy_index: Dict[str, Any],
    aliases_payload: Dict[str, Any],
) -> Tuple[Dict[str, Any], Optional[Tuple[str, str]]]:
    medication_id = clean_text(medication.get("id"))

    source_labels = extract_source_labels(medication)
    best_entry: Optional[Dict[str, Any]] = None

    for source_kind, source_label, source_weight in source_labels:
        normalized_label = normalize_text(source_label)
        if not normalized_label:
            continue

        alias_target_id = alias_target_id_for_label(aliases_payload, source_kind, normalized_label)
        if alias_target_id:
            node = next((item for item in hierarchy_paths if clean_text(item.get("id")) == alias_target_id), None)
            if node:
                score = score_candidate(source_weight, MATCH_WEIGHT_ALIAS, int(node.get("depth") or 0))
                candidate_entry = {
                    "medicationId": medication_id,
                    "classNodeId": clean_text(node.get("id")),
                    "classPathIds": to_text_list(node.get("pathIds")),
                    "classPathLabels": to_text_list(node.get("pathLabels")),
                    "sourceKind": source_kind,
                    "sourceLabel": source_label,
                    "matchType": "alias",
                    "matchNote": f"Matched alias target {alias_target_id}",
                    "score": score,
                }
                if not best_entry or candidate_entry["score"] > best_entry["score"]:
                    best_entry = candidate_entry

        exact_nodes = label_lookup.get(normalized_label, [])
        for node in exact_nodes:
            score = score_candidate(source_weight, MATCH_WEIGHT_EXACT, int(node.get("depth") or 0))
            candidate_entry = {
                "medicationId": medication_id,
                "classNodeId": clean_text(node.get("id")),
                "classPathIds": to_text_list(node.get("pathIds")),
                "classPathLabels": to_text_list(node.get("pathLabels")),
                "sourceKind": source_kind,
                "sourceLabel": source_label,
                "matchType": "exact",
                "matchNote": "Exact normalized label match",
                "score": score,
            }
            if not best_entry or candidate_entry["score"] > best_entry["score"]:
                best_entry = candidate_entry

        phrase_target_id = phrase_rule_target_id(aliases_payload, source_kind, normalized_label)
        if phrase_target_id:
            node = next((item for item in hierarchy_paths if clean_text(item.get("id")) == phrase_target_id), None)
            if node:
                score = score_candidate(source_weight, MATCH_WEIGHT_PHRASE, int(node.get("depth") or 0))
                candidate_entry = {
                    "medicationId": medication_id,
                    "classNodeId": clean_text(node.get("id")),
                    "classPathIds": to_text_list(node.get("pathIds")),
                    "classPathLabels": to_text_list(node.get("pathLabels")),
                    "sourceKind": source_kind,
                    "sourceLabel": source_label,
                    "matchType": "phrase",
                    "matchNote": f"Matched phrase rule to {phrase_target_id}",
                    "score": score,
                }
                if not best_entry or candidate_entry["score"] > best_entry["score"]:
                    best_entry = candidate_entry

        # Last fallback: contains matching against hierarchy labels.
        for node in hierarchy_paths:
            node_norm = clean_text(node.get("labelNorm"))
            if not node_norm:
                continue
            if normalized_label in node_norm or node_norm in normalized_label:
                score = score_candidate(source_weight, MATCH_WEIGHT_CONTAINS, int(node.get("depth") or 0))
                candidate_entry = {
                    "medicationId": medication_id,
                    "classNodeId": clean_text(node.get("id")),
                    "classPathIds": to_text_list(node.get("pathIds")),
                    "classPathLabels": to_text_list(node.get("pathLabels")),
                    "sourceKind": source_kind,
                    "sourceLabel": source_label,
                    "matchType": "contains",
                    "matchNote": "Contains match against hierarchy label",
                    "score": score,
                }
                if not best_entry or candidate_entry["score"] > best_entry["score"]:
                    best_entry = candidate_entry

    if best_entry:
        return best_entry, None

    fallback_node_id = clean_text(hierarchy_index.get("fallbackNodeId"))
    fallback_path_ids = to_text_list(hierarchy_index.get("fallbackPathIds"))
    fallback_path_labels = to_text_list(hierarchy_index.get("fallbackPathLabels"))

    fallback_entry = {
        "medicationId": medication_id,
        "classNodeId": fallback_node_id,
        "classPathIds": fallback_path_ids,
        "classPathLabels": fallback_path_labels,
        "sourceKind": "fallback",
        "sourceLabel": clean_text(medication.get("drugClass")),
        "matchType": "fallback",
        "matchNote": "No hierarchy match found; mapped to fallback node",
        "score": 0,
    }

    unmapped_label = ""
    for _, source_label, _ in source_labels:
        normalized = normalize_text(source_label)
        if normalized:
            unmapped_label = source_label
            break

    unmapped = (unmapped_label, clean_text(medication.get("id"))) if unmapped_label else None
    return fallback_entry, unmapped


def build_mapping() -> None:
    medications = load_medications(MEDICATIONS_SOURCE_PATH)
    hierarchy_index = load_hierarchy_index(HIERARCHY_INDEX_PATH)
    hierarchy_paths = load_hierarchy_paths(HIERARCHY_PATHS_PATH)
    aliases_payload = ensure_aliases_payload(ALIASES_PATH)

    label_lookup = build_label_lookup(hierarchy_paths)

    mappings: List[Dict[str, Any]] = []
    by_medication_id: Dict[str, Dict[str, Any]] = {}
    unmapped_counter: Counter[str] = Counter()

    for medication in medications:
        medication_id = clean_text(medication.get("id"))
        if not medication_id:
            continue

        mapping_entry, unmapped = choose_mapping_for_medication(
            medication=medication,
            label_lookup=label_lookup,
            hierarchy_paths=hierarchy_paths,
            hierarchy_index=hierarchy_index,
            aliases_payload=aliases_payload,
        )
        mappings.append(mapping_entry)
        by_medication_id[medication_id] = mapping_entry

        if unmapped and mapping_entry.get("matchType") == "fallback":
            unmapped_counter[clean_text(unmapped[0])] += 1

    medications_total = len(medications)
    medications_mapped = sum(1 for item in mappings if item.get("matchType") != "fallback")
    medications_unmapped = max(medications_total - medications_mapped, 0)
    unmapped_ratio = (float(medications_unmapped) / float(medications_total)) if medications_total > 0 else 0.0

    top_unmapped = [
        {"label": label, "count": count}
        for label, count in unmapped_counter.most_common(MAX_TOP_UNMAPPED_LABELS)
    ]

    warnings: Dict[str, Any] = {
        "unmappedMedicationRatioExceeded": unmapped_ratio > WARN_UNMAPPED_MEDICATION_RATIO,
        "topUnmappedLabelFrequencyExceeded": (
            (top_unmapped[0]["count"] if top_unmapped else 0) > WARN_TOP_UNMAPPED_LABEL_COUNT
        ),
    }

    mapping_payload = {
        "version": MAPPING_VERSION,
        "generatedAt": now_iso_utc(),
        "sourceFiles": {
            "medications": str(MEDICATIONS_SOURCE_PATH),
            "hierarchyIndex": str(HIERARCHY_INDEX_PATH),
            "hierarchyPaths": str(HIERARCHY_PATHS_PATH),
            "aliases": str(ALIASES_PATH),
        },
        "counts": {
            "medicationsTotal": medications_total,
            "medicationsMapped": medications_mapped,
            "medicationsUnmapped": medications_unmapped,
            "unmappedMedicationRatio": round(unmapped_ratio, 4),
        },
        "warnings": warnings,
        "topUnmappedSourceLabels": top_unmapped,
        "byMedicationId": by_medication_id,
        "mappings": mappings,
    }

    report_payload = {
        "generatedAt": mapping_payload["generatedAt"],
        "counts": mapping_payload["counts"],
        "warnings": mapping_payload["warnings"],
        "topUnmappedSourceLabels": mapping_payload["topUnmappedSourceLabels"],
        "sourceFiles": mapping_payload["sourceFiles"],
    }

    write_json(OUTPUT_MAPPING_PATH, mapping_payload)
    write_json(OUTPUT_REPORT_PATH, report_payload)

    print("Main hierarchy mapping build completed.")
    print(f"- Medications total: {medications_total}")
    print(f"- Medications mapped: {medications_mapped}")
    print(f"- Medications fallback-mapped: {medications_unmapped}")
    print(f"- Mapping file: {OUTPUT_MAPPING_PATH}")
    print(f"- Report file: {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    build_mapping()
