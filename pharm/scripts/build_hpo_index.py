#!/usr/bin/env python3
"""Build a compact Pharm terminology index from the shared HPO ontology."""

from __future__ import annotations

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
PROJECT_ROOT = Path(__file__).resolve().parents[2]
HPO_SOURCE_PATH = PROJECT_ROOT / "assets" / "hpo_terms.json"
OUTPUT_INDEX_PATH = PROJECT_ROOT / "pharm" / "assests" / "hpo_index.json"


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", clean_text(value)).encode("ascii", "ignore").decode("ascii")
    text = text.casefold().replace("&", " and ").replace("_", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def normalize_hpo_id(value: Any) -> str:
    match = re.search(r"HP[_:](\d{7})", clean_text(value), flags=re.IGNORECASE)
    return f"HP:{match.group(1)}" if match else ""


def timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def unique_text(values: list[Any]) -> list[str]:
    seen, output = set(), []
    for value in values:
        cleaned, key = clean_text(value), normalize_text(value)
        if cleaned and key and key not in seen:
            seen.add(key)
            output.append(cleaned)
    return output


def selected_synonyms(meta: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for synonym in meta.get("synonyms", []) if isinstance(meta.get("synonyms"), list) else []:
        if not isinstance(synonym, dict):
            continue
        predicate = clean_text(synonym.get("pred")).casefold()
        synonym_type = clean_text(synonym.get("synonymType")).casefold()
        # Retain exact, related, layperson, and abbreviation terminology only.
        if any(marker in predicate for marker in ("exact", "related")) or any(marker in synonym_type for marker in ("layperson", "abbreviation")):
            values.append(synonym.get("val"))
    return unique_text(values)


def xrefs_by_namespace(meta: dict[str, Any], namespace: str) -> list[str]:
    prefix = f"{namespace}:"
    values = []
    for xref in meta.get("xrefs", []) if isinstance(meta.get("xrefs"), list) else []:
        raw = clean_text(xref.get("val") if isinstance(xref, dict) else xref)
        if raw.upper().startswith(prefix.upper()):
            values.append(raw.split(":", 1)[1].strip())
    return unique_text(values)


def is_obsolete(meta: dict[str, Any]) -> bool:
    return bool(meta.get("deprecated") or meta.get("obsolete"))


def main() -> int:
    payload = json.loads(HPO_SOURCE_PATH.read_text(encoding="utf-8"))
    graph = payload.get("graphs", [])[0] if isinstance(payload, dict) and isinstance(payload.get("graphs"), list) and payload.get("graphs") else {}
    nodes = graph.get("nodes", []) if isinstance(graph, dict) else []
    edges = graph.get("edges", []) if isinstance(graph, dict) else []

    concepts: dict[str, dict[str, Any]] = {}
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, dict):
            continue
        hpo_id = normalize_hpo_id(node.get("id"))
        label = clean_text(node.get("lbl"))
        meta = node.get("meta") if isinstance(node.get("meta"), dict) else {}
        if not hpo_id or not label:
            continue
        concepts[hpo_id] = {
            "id": hpo_id,
            "label": label,
            "synonyms": selected_synonyms(meta),
            "xrefs": {
                "SNOMEDCT_US": xrefs_by_namespace(meta, "SNOMEDCT_US"),
                "UMLS": xrefs_by_namespace(meta, "UMLS"),
            },
            "parents": [],
            "obsolete": is_obsolete(meta),
        }

    for edge in edges if isinstance(edges, list) else []:
        if not isinstance(edge, dict) or clean_text(edge.get("pred")) != "is_a":
            continue
        child, parent = normalize_hpo_id(edge.get("sub")), normalize_hpo_id(edge.get("obj"))
        if child in concepts and parent in concepts and parent not in concepts[child]["parents"]:
            concepts[child]["parents"].append(parent)

    label_lookup: dict[str, list[str]] = defaultdict(list)
    synonym_lookup: dict[str, list[str]] = defaultdict(list)
    snomed_lookup: dict[str, list[str]] = defaultdict(list)
    umls_lookup: dict[str, list[str]] = defaultdict(list)
    for concept in concepts.values():
        if concept["obsolete"]:
            continue
        label_key = normalize_text(concept["label"])
        if label_key:
            label_lookup[label_key].append(concept["id"])
        for synonym in concept["synonyms"]:
            key = normalize_text(synonym)
            if key:
                synonym_lookup[key].append(concept["id"])
        for identifier in concept["xrefs"]["SNOMEDCT_US"]:
            snomed_lookup[identifier].append(concept["id"])
        for identifier in concept["xrefs"]["UMLS"]:
            umls_lookup[identifier].append(concept["id"])

    def sort_lookup(lookup: dict[str, list[str]]) -> dict[str, list[str]]:
        return {key: sorted(set(value)) for key, value in sorted(lookup.items())}

    active_concepts = [concept for concept in concepts.values() if not concept["obsolete"]]
    index = {
        "version": 1,
        "generatedAt": timestamp(),
        "source": "assets/hpo_terms.json",
        "concepts": dict(sorted(concepts.items())),
        "lookups": {
            "byId": {concept_id: [concept_id] for concept_id in sorted(concepts)},
            "byPreferredLabel": sort_lookup(label_lookup),
            "bySynonym": sort_lookup(synonym_lookup),
            "bySnomedCt": sort_lookup(snomed_lookup),
            "byUmls": sort_lookup(umls_lookup),
        },
        "audit": {
            "totalHpoNodesParsed": len(nodes) if isinstance(nodes, list) else 0,
            "totalActiveConceptsIndexed": len(active_concepts),
            "conceptsWithSynonyms": sum(bool(concept["synonyms"]) for concept in active_concepts),
            "conceptsWithSnomedMappings": sum(bool(concept["xrefs"]["SNOMEDCT_US"]) for concept in active_concepts),
            "conceptsWithUmlsMappings": sum(bool(concept["xrefs"]["UMLS"]) for concept in active_concepts),
        },
    }
    OUTPUT_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Built {OUTPUT_INDEX_PATH.relative_to(PROJECT_ROOT)}: {len(active_concepts)} active concepts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
