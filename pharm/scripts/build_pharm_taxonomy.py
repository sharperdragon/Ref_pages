#!/usr/bin/env python3
"""Build the browser taxonomy from the curated Filled_classes source files."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ================================================================
# USER SETTINGS (edit)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]
TAXONOMY_DIR = PHARM_DIR / "Filled_classes"
OUTPUT_TAXONOMY_PATH = PHARM_DIR / "assests" / "pharm_taxonomy.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "pharm_taxonomy_report.json"

EXCLUDED_TAXONOMY_FILES = {
    "dermatologic.json": "Expected dermatologic taxonomy, found an antiviral hierarchy instead.",
}
EXPECTED_ROOTS = {
    "antibiotic_combos.json": {"antimicrobials"},
    "antibiotics.json": {"antibiotics"},
    "antifungals_antiparasitics.json": {"antifungals", "antiparasitics"},
    "antivirals.json": {"antivirals"},
    "cardiovascular.json": {"cardiovascular"},
    "central_nervous_system.json": {"central_nervous_system"},
    "dermatologic.json": {"dermatologic"},
    "endocrine.json": {"endocrine"},
    "gastrointestinal.json": {"gastrointestinal"},
    "genitourinary_repro.json": {"genitourinary_and_reproductive"},
    "respiratory.json": {"respiratory"},
}
LABEL_OVERRIDES = {
    "5ht3": "5-HT3", "ace": "ACE", "cmv": "CMV", "dpp4": "DPP4", "enac": "ENaC",
    "gaba": "GABA", "glp1": "GLP-1", "h2": "H2", "hcv": "HCV", "hiv": "HIV",
    "maob": "MAO-B", "nk1": "NK1", "nmda": "NMDA", "nnrtis": "NNRTIs", "nrtis": "NRTIs",
    "rsv": "RSV", "sglt2": "SGLT2", "sv2a": "SV2A",
}


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", clean_text(value)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.casefold())).strip()


def display_label(key: str) -> str:
    parts = []
    for token in clean_text(key).split("_"):
        normalized = token.casefold()
        if normalized in LABEL_OVERRIDES:
            parts.append(LABEL_OVERRIDES[normalized])
        elif normalized in {"i", "ii", "iii", "iv", "v", "vi"}:
            parts.append(normalized.upper())
        elif re.fullmatch(r"(alpha|beta)\d+[a-z]?", normalized):
            parts.append(normalized[0].upper() + normalized[1:])
        else:
            parts.append(normalized.capitalize())
    return " ".join(parts)


def stable_id(path_keys: list[str]) -> str:
    return "taxonomy." + ".".join(re.sub(r"[^a-z0-9]+", "-", key.casefold()).strip("-") for key in path_keys)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_taxonomy_entries() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    audit: dict[str, Any] = {
        "files": [], "excludedFiles": [], "rootMismatches": [], "malformedEntries": [],
        "emptyBranches": [], "duplicateEntriesWithinIdenticalPaths": [], "identicalCategoryFiles": [],
    }
    hashes: dict[str, list[str]] = defaultdict(list)

    for path in sorted(TAXONOMY_DIR.glob("*.json")):
        file_entries: list[dict[str, Any]] = []
        malformed: list[dict[str, Any]] = []
        empty: list[list[str]] = []
        duplicates: list[dict[str, Any]] = []
        try:
            payload = read_json(path)
        except (OSError, json.JSONDecodeError) as error:
            audit["files"].append({"file": path.name, "parsed": False, "medicationReferenceCount": 0})
            audit["malformedEntries"].append({"file": path.name, "path": [], "reason": f"JSON parse failure: {error}"})
            continue

        roots = list(payload) if isinstance(payload, dict) else []
        audit["files"].append({"file": path.name, "parsed": isinstance(payload, dict), "roots": roots, "medicationReferenceCount": 0})
        if not isinstance(payload, dict):
            audit["malformedEntries"].append({"file": path.name, "path": [], "reason": "Top-level JSON value must be an object."})
            continue

        expected = EXPECTED_ROOTS.get(path.name, set())
        if expected and not expected.issubset(set(roots)):
            audit["rootMismatches"].append({"file": path.name, "expectedRoots": sorted(expected), "actualRoots": roots})

        seen_by_path: dict[tuple[str, ...], set[str]] = defaultdict(set)

        def visit(value: Any, keys: list[str], labels: list[str]) -> None:
            if isinstance(value, dict):
                if not value:
                    empty.append(labels)
                for raw_key, child in value.items():
                    key = clean_text(raw_key)
                    if not key:
                        malformed.append({"path": labels, "reason": "Category names must be non-empty strings."})
                        continue
                    visit(child, [*keys, key], [*labels, display_label(key)])
            elif isinstance(value, list):
                if not value:
                    empty.append(labels)
                for index, medication in enumerate(value):
                    if not isinstance(medication, str) or not clean_text(medication):
                        malformed.append({"path": labels, "index": index, "reason": "Terminal medication entry must be a non-empty string."})
                        continue
                    name, normalized_name = clean_text(medication), normalize_text(medication)
                    if normalized_name in seen_by_path[tuple(keys)]:
                        duplicates.append({"path": labels, "medication": name})
                        continue
                    seen_by_path[tuple(keys)].add(normalized_name)
                    file_entries.append({"name": name, "normalizedName": normalized_name, "pathKeys": keys, "path": labels, "sourceFile": path.name})
            else:
                malformed.append({"path": labels, "reason": f"Terminal taxonomy value must be a medication list, not {type(value).__name__}."})

        visit(payload, [], [])
        audit["files"][-1]["medicationReferenceCount"] = len(file_entries)
        audit["malformedEntries"].extend({"file": path.name, **item} for item in malformed)
        audit["emptyBranches"].extend({"file": path.name, "path": item} for item in empty)
        audit["duplicateEntriesWithinIdenticalPaths"].extend({"file": path.name, **item} for item in duplicates)
        hashes[hashlib.sha256(path.read_bytes()).hexdigest()].append(path.name)
        if path.name in EXCLUDED_TAXONOMY_FILES:
            audit["excludedFiles"].append({"file": path.name, "reason": EXCLUDED_TAXONOMY_FILES[path.name]})
        else:
            entries.extend(file_entries)

    audit["identicalCategoryFiles"] = [sorted(files) for files in hashes.values() if len(files) > 1]
    return entries, audit


def build_tree(entries: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    root = {"id": "taxonomy.root", "label": "All classes", "parent": None, "children": [], "path": [], "medications": set(), "sortOrder": 0}
    nodes: dict[str, dict[str, Any]] = {root["id"]: root}

    for entry in entries:
        parent = root
        parent["medications"].add(entry["normalizedName"])
        for depth, (key, label) in enumerate(zip(entry["pathKeys"], entry["path"]), start=1):
            node_id = stable_id(entry["pathKeys"][:depth])
            node = nodes.get(node_id)
            if node is None:
                node = {"id": node_id, "label": label, "parent": parent["id"], "children": [], "path": entry["path"][:depth], "medications": set(), "sortOrder": len(nodes)}
                nodes[node_id] = node
                parent["children"].append(node_id)
            node["medications"].add(entry["normalizedName"])
            parent = node

    serialized = []
    for node in sorted(nodes.values(), key=lambda item: item["sortOrder"]):
        serialized.append({
            "id": node["id"], "label": node["label"], "parent": node["parent"],
            "children": node["children"], "path": node["path"],
            "medicationCount": len(node["medications"]), "sortOrder": node["sortOrder"],
        })
    return serialized[0], serialized


def main() -> int:
    entries, audit = load_taxonomy_entries()
    root, nodes = build_tree(entries)
    paths_by_medication: dict[str, set[tuple[str, ...]]] = defaultdict(set)
    for entry in entries:
        paths_by_medication[entry["normalizedName"]].add(tuple(entry["path"]))
    payload = {
        "version": 1,
        "generatedAt": timestamp(),
        "source": "Filled_classes/*.json",
        "rootId": root["id"],
        "root": root,
        "nodes": nodes,
    }
    report = {
        "generatedAt": payload["generatedAt"],
        "inputFiles": {"taxonomy": "Filled_classes/*.json"},
        "outputFiles": {"taxonomy": str(OUTPUT_TAXONOMY_PATH.relative_to(PHARM_DIR))},
        "counts": {
            "totalNodes": len(nodes),
            "totalMedicationReferences": len(entries),
            "totalUniqueMedications": len({entry["normalizedName"] for entry in entries}),
            "medicationsWithMultiplePaths": sum(len(paths) > 1 for paths in paths_by_medication.values()),
        },
        "taxonomyAudit": audit,
    }
    write_json(OUTPUT_TAXONOMY_PATH, payload)
    write_json(OUTPUT_REPORT_PATH, report)
    print(f"Built {OUTPUT_TAXONOMY_PATH.relative_to(PHARM_DIR)}: {len(nodes)} nodes")
    print(f"Wrote {OUTPUT_REPORT_PATH.relative_to(PHARM_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
