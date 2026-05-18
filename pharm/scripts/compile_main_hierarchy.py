#!/usr/bin/env python3
"""
Compile MAIN_PHARM_CLASS_HIERARCHY.json into runtime-ready class artifacts.

Outputs:
1) main_hierarchy_index.json (tree + node metadata)
2) main_hierarchy_paths.json (flat node paths for matching)
3) main_hierarchy_label_overrides.json (manual overrides bootstrap file)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple


# ================================================================
# Configurable values (change here)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]
HIERARCHY_SOURCE_PATH = PHARM_DIR / "assests" / "MAIN_PHARM_CLASS_HIERARCHY.json"
OUTPUT_INDEX_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_index.json"
OUTPUT_PATHS_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_paths.json"
OUTPUT_LABEL_OVERRIDES_PATH = PHARM_DIR / "assests" / "classes" / "main_hierarchy_label_overrides.json"

INDEX_VERSION = "1"
ROOT_KEY = "drug_classes"
FALLBACK_PARENT_KEY = "other_classes"
FALLBACK_LEAF_KEY = "unmapped"

DEFAULT_TOKEN_OVERRIDES = {
    "ace": "ACE",
    "arb": "ARB",
    "dhfr": "DHFR",
    "dha": "DHA",
    "dpp4": "DPP4",
    "enac": "ENaC",
    "epa": "EPA",
    "gnrh": "GnRH",
    "gp": "GP",
    "h1": "H1",
    "h2": "H2",
    "hiv": "HIV",
    "ii": "II",
    "iii": "III",
    "iv": "IV",
    "il4": "IL4",
    "il5": "IL5",
    "il6": "IL6",
    "il12": "IL12",
    "il13": "IL13",
    "il17": "IL17",
    "il23": "IL23",
    "jak": "JAK",
    "maob": "MAOB",
    "mtp": "MTP",
    "mtor": "mTOR",
    "nk1": "NK1",
    "nnrtis": "NNRTIs",
    "nris": "NRIs",
    "nrtis": "NRTIs",
    "ns3": "NS3",
    "ns5a": "NS5A",
    "ns5b": "NS5B",
    "nsaids": "NSAIDs",
    "nmda": "NMDA",
    "nrti": "NRTI",
    "nnrti": "NNRTI",
    "p2y12": "P2Y12",
    "par1": "PAR1",
    "pcsk9": "PCSK9",
    "pde4": "PDE4",
    "pde5": "PDE5",
    "pcsk9": "PCSK9",
    "rnai": "RNAi",
    "serms": "SERMs",
    "sarms": "SARMs",
    "sglt2": "SGLT2",
    "sirna": "siRNA",
    "snris": "SNRIs",
    "ssris": "SSRIs",
    "sv2a": "SV2A",
    "tpa": "tPA",
}


def clean_text(value: object) -> str:
    return str(value or "").strip()


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_label_overrides(path: Path) -> Dict[str, object]:
    if path.exists():
        payload = load_json(path)
        if isinstance(payload, dict):
            payload.setdefault("version", INDEX_VERSION)
            payload.setdefault("tokenOverrides", DEFAULT_TOKEN_OVERRIDES)
            payload.setdefault("labelOverrides", {})
            return payload

    payload = {
        "version": INDEX_VERSION,
        "tokenOverrides": DEFAULT_TOKEN_OVERRIDES,
        "labelOverrides": {},
    }
    write_json(path, payload)
    return payload


def token_to_label(token: str, token_overrides: Dict[str, str]) -> str:
    normalized = clean_text(token).lower()
    if not normalized:
        return ""

    if normalized in token_overrides:
        return clean_text(token_overrides[normalized]) or token

    if re.search(r"\d", normalized):
        if len(normalized) <= 4:
            return normalized.upper()
        return normalized.title()

    return normalized.replace("-", " ").title()


def key_to_label(key: str, node_id: str, overrides: Dict[str, object]) -> str:
    label_overrides = overrides.get("labelOverrides", {})
    token_overrides = overrides.get("tokenOverrides", {})
    if isinstance(label_overrides, dict) and node_id in label_overrides:
        custom = clean_text(label_overrides[node_id])
        if custom:
            return custom

    tokens = [token for token in clean_text(key).split("_") if token]
    parts = [token_to_label(token, token_overrides if isinstance(token_overrides, dict) else {}) for token in tokens]
    label = " ".join([part for part in parts if part]).strip()
    return label or clean_text(key)


def compile_nodes(
    tree: Dict[str, object],
    overrides: Dict[str, object],
) -> Tuple[List[Dict[str, object]], Dict[str, Dict[str, object]], str]:
    nodes: List[Dict[str, object]] = []
    by_id: Dict[str, Dict[str, object]] = {}
    sort_counter = 0

    def visit(node_key: str, node_value: object, parent_id: str | None, path_ids: List[str], path_labels: List[str]) -> str:
        nonlocal sort_counter
        node_id = node_key if not parent_id else f"{parent_id}.{node_key}"
        label = key_to_label(node_key, node_id, overrides)
        depth = len(path_ids)
        sort_counter += 1

        node_payload = {
            "id": node_id,
            "key": node_key,
            "label": label,
            "parentId": parent_id,
            "depth": depth,
            "sortOrder": sort_counter,
            "pathIds": path_ids + [node_id],
            "pathLabels": path_labels + [label],
            "children": [],
        }
        nodes.append(node_payload)
        by_id[node_id] = node_payload

        child_dict = node_value if isinstance(node_value, dict) else {}
        for child_key, child_value in child_dict.items():
            child_id = visit(
                clean_text(child_key),
                child_value,
                node_id,
                node_payload["pathIds"],
                node_payload["pathLabels"],
            )
            node_payload["children"].append(child_id)
        return node_id

    root_value = tree.get(ROOT_KEY, {}) if isinstance(tree, dict) else {}
    if not isinstance(root_value, dict):
        root_value = {}

    # Ensure canonical fallback path exists in the compiled hierarchy.
    if FALLBACK_PARENT_KEY not in root_value:
        root_value[FALLBACK_PARENT_KEY] = {FALLBACK_LEAF_KEY: {}}
    else:
        fallback_parent = root_value.get(FALLBACK_PARENT_KEY)
        if isinstance(fallback_parent, dict) and FALLBACK_LEAF_KEY not in fallback_parent:
            fallback_parent[FALLBACK_LEAF_KEY] = {}

    root_id = visit(ROOT_KEY, root_value, None, [], [])
    return nodes, by_id, root_id


def build_paths(nodes: List[Dict[str, object]], root_id: str) -> List[Dict[str, object]]:
    path_nodes: List[Dict[str, object]] = []
    for node in nodes:
        if clean_text(node.get("id")) == root_id:
            continue
        path_nodes.append(
            {
                "id": node["id"],
                "key": node["key"],
                "label": node["label"],
                "parentId": node["parentId"],
                "depth": node["depth"],
                "sortOrder": node["sortOrder"],
                "pathIds": list(node["pathIds"]),
                "pathLabels": list(node["pathLabels"]),
            }
        )
    return path_nodes


def run() -> None:
    overrides = ensure_label_overrides(OUTPUT_LABEL_OVERRIDES_PATH)
    source_payload = load_json(HIERARCHY_SOURCE_PATH)
    if not isinstance(source_payload, dict):
        raise ValueError(f"Expected object payload in {HIERARCHY_SOURCE_PATH}")

    nodes, by_id, root_id = compile_nodes(source_payload, overrides)
    fallback_node_id = f"{ROOT_KEY}.{FALLBACK_PARENT_KEY}.{FALLBACK_LEAF_KEY}"
    fallback_parent_id = f"{ROOT_KEY}.{FALLBACK_PARENT_KEY}"
    fallback_path_ids = [fallback_parent_id, fallback_node_id]
    fallback_path_labels = [
        clean_text(by_id.get(fallback_parent_id, {}).get("label")) or "Other Classes",
        clean_text(by_id.get(fallback_node_id, {}).get("label")) or "Unmapped",
    ]
    top_level_ids = [
        node_id
        for node_id in by_id[root_id]["children"]
        if clean_text(node_id)
    ]

    index_payload = {
        "version": INDEX_VERSION,
        "generatedAt": now_iso_utc(),
        "sourceFile": str(HIERARCHY_SOURCE_PATH),
        "labelOverridesFile": str(OUTPUT_LABEL_OVERRIDES_PATH),
        "rootId": root_id,
        "topLevelIds": top_level_ids,
        "fallbackNodeId": fallback_node_id,
        "fallbackPathIds": fallback_path_ids,
        "fallbackPathLabels": fallback_path_labels,
        "nodes": nodes,
    }
    write_json(OUTPUT_INDEX_PATH, index_payload)

    paths_payload = {
        "version": INDEX_VERSION,
        "generatedAt": now_iso_utc(),
        "sourceFile": str(HIERARCHY_SOURCE_PATH),
        "rootId": root_id,
        "fallbackNodeId": fallback_node_id,
        "paths": build_paths(nodes, root_id),
    }
    write_json(OUTPUT_PATHS_PATH, paths_payload)

    print("Main hierarchy compile complete.")
    print(f"- Nodes: {len(nodes)}")
    print(f"- Root ID: {root_id}")
    print(f"- Index: {OUTPUT_INDEX_PATH}")
    print(f"- Paths: {OUTPUT_PATHS_PATH}")
    print(f"- Label overrides: {OUTPUT_LABEL_OVERRIDES_PATH}")


if __name__ == "__main__":
    run()
