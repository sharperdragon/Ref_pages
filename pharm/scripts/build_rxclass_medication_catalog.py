#!/usr/bin/env python3
"""
Build a DrugBank-free medication catalog for the pharm page.

This script is designed for VS Code task execution and writes:
1) a static pharm dataset JSON (pharm_data_rxclass_enriched.json)
2) a build report JSON (rxclass_catalog_report.json)

The pipeline is RxClass-first and supports two intake modes:
- seed CSV mode (default): use prebuilt RxClass-derived sandbox CSV files
- live mode (optional): query RxClass endpoints directly for EPC IN members
"""

from __future__ import annotations

import csv
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

try:
    import requests
except ModuleNotFoundError:
    requests = None


# ================================================================
# USER SETTINGS (edit)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]

# Inputs
SEED_EPC_POOL_PATH = PHARM_DIR / "assests" / "rxclass_seed" / "prescribable_epc_in_pool_sandbox.csv"
SEED_NERVOUS_SYSTEM_PATH = PHARM_DIR / "assests" / "rxclass_seed" / "nervous_system_agents_sandbox.csv"
SEED_PRESCRIBABLE_EPC_AGENTS_PATH = PHARM_DIR / "assests" / "rxclass_seed" / "prescribable_epc_in_agents_sandbox.csv"
PSYCH_MEDS_JSON_PATH = PHARM_DIR / "assests" / "pysch_meds.json"

# Outputs
OUTPUT_DATASET_PATH = PHARM_DIR / "assests" / "pharm_data_rxclass_enriched.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "rxclass_catalog_report.json"

# Intake toggles
USE_SEED_EPC_POOL = True
USE_SEED_NERVOUS_SYSTEM = True
USE_SEED_PRESCRIBABLE_EPC_AGENTS = True
INCLUDE_UNRESOLVED_PSYCH_HINTS = True

# Optional live retrieval (disabled by default for deterministic offline rebuilds)
ENABLE_LIVE_EPC_FETCH = False
RXCLASS_ALL_CLASSES_URL = "https://rxnav.nlm.nih.gov/REST/rxclass/allClasses.json"
RXCLASS_CLASS_MEMBERS_URL = "https://rxnav.nlm.nih.gov/REST/rxclass/classMembers.json"
EPC_CLASS_TYPE = "EPC"
EPC_RELA_SOURCE = "DAILYMED"
EPC_RELA = "has_epc"
EPC_TTYS = "IN"
REQUEST_TIMEOUT_SECONDS = 30
SLEEP_BETWEEN_REQUESTS_SECONDS = 0.02
LIVE_PROGRESS_EVERY = 50

# Optional text enrichment from openFDA (off in v1)
ENABLE_OPENFDA_ENRICHMENT = False
OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
OPENFDA_LIMIT = 5

# Output shaping
MAX_BRANDS_PER_DRUG = 2
MAX_PEARL_CLASS_CANDIDATES = 8
FALLBACK_CLASS_NAME = "Unclassified EPC Ingredient"
FALLBACK_MOA = "Mechanism data not available in current static build."
FALLBACK_INDICATION = "Therapeutic indication varies by formulation and clinical context."
FALLBACK_CONTRAINDICATION = "Review official prescribing information for contraindications."
FALLBACK_ADVERSE_EFFECT = "Review official prescribing information for adverse-effect profile."
FALLBACK_INTERACTION = "Review official prescribing information for major drug interactions."
FALLBACK_MONITORING = "Monitor based on indication, comorbidities, and concurrent therapy."
DEFAULT_ROUTE = "PO"
SORT_OUTPUT_BY_NAME = True

# Class behavior
BROAD_CLASS_LABELS = {
    "therapeutic categories",
    "established pharmacologic classes",
    "nervous system agent",
    "nervous system agents",
    "central nervous system agent",
    "central nervous system agents",
}

CLASS_NORMALIZATION_MAP = {
    "ssri": "Selective serotonin reuptake inhibitor",
    "snri": "Serotonin norepinephrine reuptake inhibitor",
    "maoi": "Monoamine oxidase inhibitor",
    "ndri": "Norepinephrine dopamine reuptake inhibitor",
    "atypical antipsychotic": "Atypical antipsychotic",
    "typical antipsychotic": "Typical antipsychotic",
    "other antipsychotics": "Other antipsychotic",
    "other antipsychotic": "Other antipsychotic",
    "central nervous system stimulant": "Central Nervous System Stimulant",
    "central nervous system stimulants": "Central Nervous System Stimulant",
    "benzodiazepines": "Benzodiazepine",
    "benzodiazepine": "Benzodiazepine",
    "tricyclic antidepressants": "Tricyclic antidepressant",
    "monoamine oxidase inhibitors": "Monoamine oxidase inhibitor",
    "antiemetics": "Antiemetic",
    "barbiturates": "Barbiturate",
    "gabapentinoids": "Gabapentinoid",
    "alpha-2 agonists": "Alpha-2 adrenergic agonist",
    "orexin antagonist": "Orexin receptor antagonist",
    "muscarinic antagonists": "Muscarinic antagonist",
    "norepinephrine reuptake inhibitors": "Norepinephrine reuptake inhibitor",
    "opioid use disorder agents": "Opioid use disorder agent",
    "alcohol use disorder agents": "Alcohol use disorder agent",
    "illicit drugs": "Illicit psychoactive substance",
}

PSYCH_CATEGORY_CLASS_HINT_MAP = {
    "first-generation antipsychotic (fgas)": "Typical antipsychotic",
    "second-generation antipsychotic (sga)": "Atypical antipsychotic",
    "ssri": "Selective serotonin reuptake inhibitor",
    "snri": "Serotonin norepinephrine reuptake inhibitor",
    "serotonin modulators": "Serotonin modulator",
    "atypical antidepressants": "Atypical antidepressant",
    "monoamine oxidase inhibitors": "Monoamine oxidase inhibitor",
    "tricyclic antidepressants": "Tricyclic antidepressant",
    "antiepileptics": "Anti-epileptic Agent",
    "benzodiazepines": "Benzodiazepine",
    "nonbenzodiazepine hypnotics": "Nonbenzodiazepine hypnotic",
    "barbituates": "Barbiturate",
    "melatonin agonists": "Melatonin receptor agonist",
    "orexin antagonist": "Orexin receptor antagonist",
    "psychostimulants": "Central Nervous System Stimulant",
    "alpha-2 agonists": "Alpha-2 adrenergic agonist",
    "norepinephrine reuptake inhibitors": "Norepinephrine reuptake inhibitor",
    "mood stabilizers": "Mood Stabilizer",
    "dopamine precursors": "Dopamine precursor",
    "decarboxylase inhibitors": "Aromatic L-amino acid decarboxylase inhibitor",
    "non-ergot dopamine agonists": "Dopamine agonist",
    "ergot dopamine agonists": "Dopamine agonist",
    "comt inhibitors": "Catechol-O-methyltransferase inhibitor",
    "mao-b inhibitors": "Monoamine oxidase-B inhibitor",
    "nmda antagonist": "NMDA receptor antagonist",
    "cholinesterase inhibitors": "Cholinesterase inhibitor",
    "muscarinic antagonists": "Muscarinic antagonist",
    "vmat2 inhibitors": "VMAT2 inhibitor",
    "first generation h1-antihistamine": "H1 antihistamine",
    "beta-blocker": "Beta blocker",
    "gabapentinoids": "Gabapentinoid",
    "opioid use disorder agents": "Opioid use disorder agent",
    "alcohol use disorder agents": "Alcohol use disorder agent",
    "illicit drugs": "Illicit psychoactive substance",
}

COMMON_SALT_SUFFIXES = {
    "acetate",
    "besylate",
    "citrate",
    "fumarate",
    "hydrochloride",
    "lactate",
    "maleate",
    "mesylate",
    "nitrate",
    "pamoate",
    "phosphate",
    "potassium",
    "sodium",
    "succinate",
    "tartrate",
}

DISTINCT_DERIVATIVES = {
    "aripiprazole lauroxil",
    "gabapentin enacarbil",
    "paliperidone palmitate",
    "haloperidol decanoate",
    "fosphenytoin",
    "divalproex sodium",
}

PREFERRED_CLASS_KEYWORDS = [
    "selective serotonin reuptake inhibitor",
    "serotonin norepinephrine reuptake inhibitor",
    "monoamine oxidase inhibitor",
    "atypical antipsychotic",
    "typical antipsychotic",
    "tricyclic antidepressant",
    "central nervous system stimulant",
    "benzodiazepine",
    "nonbenzodiazepine hypnotic",
    "antimanic",
    "mood stabilizer",
    "dopamine agonist",
    "norepinephrine reuptake inhibitor",
]


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_generic(value: str) -> str:
    return re.sub(r"\s+", " ", clean_text(value).lower()).strip()


def normalize_generic_name(name: str) -> str:
    normalized = normalize_generic(name)
    if not normalized:
        return ""

    for derivative in sorted(DISTINCT_DERIVATIVES, key=len, reverse=True):
        if normalized == derivative or normalized.startswith(f"{derivative} "):
            return derivative

    tokens = normalized.split()
    while len(tokens) > 1 and tokens[-1] in COMMON_SALT_SUFFIXES:
        tokens.pop()

    return " ".join(tokens).strip()


def split_semicolon(value: Any) -> List[str]:
    raw = clean_text(value)
    if not raw:
        return []
    return [clean_text(part) for part in raw.split(";") if clean_text(part)]


def uniq_casefold(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for value in values:
        cleaned = clean_text(value)
        key = cleaned.casefold()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def clean_class_label(value: Any) -> str:
    cleaned = clean_text(value)
    cleaned = re.sub(r"\s*\[[^\]]+\]\s*$", "", cleaned).strip()
    if cleaned.isupper() and len(cleaned) > 4:
        cleaned = cleaned.title()
    return cleaned


def normalize_class_label(value: Any) -> str:
    cleaned = clean_class_label(value)
    key = normalize_generic(cleaned)
    if key in CLASS_NORMALIZATION_MAP:
        return CLASS_NORMALIZATION_MAP[key]
    return cleaned


def is_broad_class(value: str) -> bool:
    key = normalize_generic(normalize_class_label(value))
    return key in BROAD_CLASS_LABELS


def class_specificity_score(value: str) -> Tuple[int, int, int, str]:
    normalized = normalize_generic(normalize_class_label(value))
    keyword_rank = 0
    for index, keyword in enumerate(PREFERRED_CLASS_KEYWORDS):
        if keyword in normalized:
            keyword_rank = len(PREFERRED_CLASS_KEYWORDS) - index
            break

    token_count = len([token for token in normalized.split(" ") if token])
    other_penalty = -1 if "other" in normalized else 0
    umbrella_penalty = -1 if is_broad_class(normalized) else 0
    return (keyword_rank, token_count, other_penalty + umbrella_penalty, normalized)


def choose_most_specific_class(candidates: Iterable[str]) -> str:
    cleaned_candidates = [normalize_class_label(item) for item in candidates if clean_text(item)]
    cleaned_candidates = [item for item in cleaned_candidates if item and not is_broad_class(item)]
    if not cleaned_candidates:
        return ""

    ranked = sorted(
        cleaned_candidates,
        key=lambda item: class_specificity_score(item),
        reverse=True,
    )
    return ranked[0]


def choose_more_specific_class(current_class: str, incoming_class: str) -> str:
    current_clean = normalize_class_label(current_class) or FALLBACK_CLASS_NAME
    incoming_clean = normalize_class_label(incoming_class) or FALLBACK_CLASS_NAME

    if is_broad_class(current_clean) and not is_broad_class(incoming_clean):
        return incoming_clean

    current_score = class_specificity_score(current_clean)
    incoming_score = class_specificity_score(incoming_clean)
    if incoming_score > current_score:
        return incoming_clean
    if incoming_score == current_score and incoming_clean.casefold() < current_clean.casefold():
        return incoming_clean
    return current_clean


def text_quality_score(text: str) -> int:
    return len(clean_text(text))


def slugify(value: str) -> str:
    text = normalize_generic(value)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "unknown"


def infer_routes(*parts: str) -> List[str]:
    text = " ".join(clean_text(part) for part in parts).lower()
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
    if re.search(r"\btopical\b|\bdermal\b|\btransdermal\b|\bophthalmic\b|\botic\b", text):
        add("Topical")
    if re.search(r"\bsubcutaneous\b|\bsubcutan", text):
        add("SQ")
    if re.search(r"\bintramuscular\b|\bim\b", text):
        add("IM")
    if re.search(r"\bintravenous\b|\biv\b|\binfusion\b|\binject", text):
        add("IV")
    if re.search(r"\boral\b|\btablet\b|\bcapsule\b|\bby mouth\b", text):
        add("PO")

    if not routes:
        routes.append(DEFAULT_ROUTE)

    priority = ["PO", "IV", "IM", "SQ", "INH", "IN", "SL", "Topical", "PR"]
    order = {route: idx for idx, route in enumerate(priority)}
    routes.sort(key=lambda route: order.get(route, len(priority)))
    return routes


def trim_text(text: str, max_chars: int) -> str:
    cleaned = clean_text(text)
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 3].rstrip() + "..."


def first_sentence(text: str, max_chars: int = 380) -> str:
    cleaned = clean_text(text)
    if not cleaned:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+", cleaned, maxsplit=1)[0]
    return trim_text(sentence, max_chars)


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def fetch_live_epc_pool_rows() -> List[Dict[str, Any]]:
    if requests is None:
        raise RuntimeError("Live EPC fetch requires the 'requests' package.")

    session = requests.Session()

    params = {"classTypes": EPC_CLASS_TYPE}
    response = session.get(RXCLASS_ALL_CLASSES_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    concepts = as_list(payload.get("rxclassMinConceptList", {}).get("rxclassMinConcept"))

    classes: List[Tuple[str, str]] = []
    seen_class_ids: Set[str] = set()
    for concept in concepts:
        if not isinstance(concept, dict):
            continue
        class_id = clean_text(concept.get("classId"))
        class_name = clean_class_label(concept.get("className"))
        class_type = clean_text(concept.get("classType")).upper()
        if not class_id or not class_name:
            continue
        if class_type and class_type != EPC_CLASS_TYPE:
            continue
        if class_id in seen_class_ids:
            continue
        seen_class_ids.add(class_id)
        classes.append((class_id, class_name))

    members_by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
    total_classes = len(classes)

    for index, (class_id, class_name) in enumerate(classes, start=1):
        params = {
            "classId": class_id,
            "relaSource": EPC_RELA_SOURCE,
            "rela": EPC_RELA,
            "ttys": EPC_TTYS,
        }
        try:
            response = session.get(RXCLASS_CLASS_MEMBERS_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            payload = response.json()
        except Exception:
            if index % LIVE_PROGRESS_EVERY == 0 or index == total_classes:
                print(f"Live EPC progress: {index}/{total_classes} classes processed")
            continue

        drug_members = as_list(payload.get("drugMemberGroup", {}).get("drugMember"))
        for member in drug_members:
            if not isinstance(member, dict):
                continue
            concept = member.get("minConcept") or member.get("conceptProperties") or {}
            if not isinstance(concept, dict):
                continue
            rxcui = clean_text(concept.get("rxcui"))
            name = clean_text(concept.get("name"))
            tty = clean_text(concept.get("tty")).upper()
            if tty != "IN" or not rxcui or not name:
                continue

            key = (rxcui, normalize_generic(name))
            if key not in members_by_key:
                members_by_key[key] = {
                    "rxcui": rxcui,
                    "name": name,
                    "class_candidates": set(),
                    "brands": set(),
                    "adverse": "",
                    "mechanism": "",
                    "source": set(),
                }
            members_by_key[key]["class_candidates"].add(class_name)
            members_by_key[key]["source"].add("rxclass_live_epc")

        if index % LIVE_PROGRESS_EVERY == 0 or index == total_classes:
            print(f"Live EPC progress: {index}/{total_classes} classes processed")
        if SLEEP_BETWEEN_REQUESTS_SECONDS > 0:
            time.sleep(SLEEP_BETWEEN_REQUESTS_SECONDS)

    return list(members_by_key.values())


def load_epc_pool_seed(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []

    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            generic_name = clean_text(row.get("Generic"))
            if not generic_name:
                continue
            rxcui = clean_text(row.get("RxCUI"))
            class_candidates = split_semicolon(row.get("EPC class candidates"))
            rows.append(
                {
                    "rxcui": rxcui,
                    "name": generic_name,
                    "class_candidates": class_candidates,
                    "brands": [],
                    "adverse": "",
                    "mechanism": "",
                    "source": ["epc_pool_seed"],
                }
            )
    return rows


def load_prescribable_epc_agents_seed(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []

    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            generic_name = clean_text(row.get("Generic"))
            if not generic_name:
                continue
            rows.append(
                {
                    "rxcui": "",
                    "name": generic_name,
                    "class_candidates": [clean_text(row.get("Class"))],
                    "brands": split_semicolon(row.get("Brand")),
                    "adverse": clean_text(row.get("Adverse reactions")),
                    "mechanism": clean_text(row.get("Mechanism")),
                    "source": ["prescribable_epc_agents_seed"],
                }
            )
    return rows


def load_nervous_system_seed(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []

    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            generic_name = clean_text(row.get("Generic"))
            if not generic_name:
                continue
            rows.append(
                {
                    "rxcui": "",
                    "name": generic_name,
                    "class_candidates": [clean_text(row.get("Class"))],
                    "brands": split_semicolon(row.get("Brand")),
                    "adverse": clean_text(row.get("Adverse reactions")),
                    "mechanism": clean_text(row.get("Mechanism")),
                    "source": ["nervous_system_seed"],
                }
            )
    return rows


def load_psych_hint_map(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}

    payload = load_json(path)
    if not isinstance(payload, dict):
        return {}

    psych_payload = payload.get("Psychiatric_medications")
    if not isinstance(psych_payload, dict):
        return {}

    hint_map: Dict[str, str] = {}
    for category, meds in psych_payload.items():
        category_key = normalize_generic(category)
        class_hint = clean_text(PSYCH_CATEGORY_CLASS_HINT_MAP.get(category_key)) or clean_class_label(category)
        if not class_hint:
            continue
        for med_name in as_list(meds):
            med_clean = clean_text(med_name)
            if not med_clean:
                continue
            hint_map[normalize_generic_name(med_clean)] = normalize_class_label(class_hint)

    return hint_map


def ensure_requests_session() -> requests.Session:
    if requests is None:
        raise RuntimeError("openFDA enrichment requires the 'requests' package.")
    return requests.Session()


def fetch_openfda_label_record(session: requests.Session, generic_name: str, brands: List[str]) -> Optional[Dict[str, Any]]:
    query_names = [generic_name] + brands[:MAX_BRANDS_PER_DRUG]
    for query_name in query_names:
        escaped = query_name.replace('"', '\\"')
        params = {
            "search": f'openfda.generic_name:"{escaped}"',
            "limit": OPENFDA_LIMIT,
        }
        try:
            response = session.get(OPENFDA_LABEL_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
            if response.status_code == 404:
                continue
            response.raise_for_status()
            payload = response.json()
        except Exception:
            continue

        results = payload.get("results") if isinstance(payload, dict) else None
        if isinstance(results, list) and results:
            return results[0]
    return None


def extract_openfda_section(record: Optional[Dict[str, Any]], key: str, max_chars: int) -> str:
    if not isinstance(record, dict):
        return ""
    values = record.get(key)
    if not isinstance(values, list):
        return ""
    joined = " ".join(clean_text(item) for item in values if clean_text(item))
    return trim_text(joined, max_chars)


def merge_input_rows(source_rows: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}

    for source_row in source_rows:
        name = clean_text(source_row.get("name"))
        if not name:
            continue

        generic_key = normalize_generic_name(name)
        if not generic_key:
            continue

        incoming_class_candidates = [
            normalize_class_label(item)
            for item in as_list(source_row.get("class_candidates"))
            if clean_text(item)
        ]
        incoming_class = choose_most_specific_class(incoming_class_candidates)
        incoming_brands = uniq_casefold(as_list(source_row.get("brands")))
        incoming_adverse = clean_text(source_row.get("adverse"))
        incoming_mechanism = clean_text(source_row.get("mechanism"))
        incoming_sources = {clean_text(item) for item in as_list(source_row.get("source")) if clean_text(item)}
        incoming_rxcui = clean_text(source_row.get("rxcui"))

        if generic_key not in merged:
            merged[generic_key] = {
                "name": name,
                "generic_key": generic_key,
                "rxcui": incoming_rxcui,
                "class_name": incoming_class or FALLBACK_CLASS_NAME,
                "class_candidates": set(incoming_class_candidates),
                "brands": set(incoming_brands),
                "adverse": incoming_adverse,
                "mechanism": incoming_mechanism,
                "sources": set(incoming_sources),
            }
            continue

        target = merged[generic_key]
        if incoming_rxcui and not clean_text(target.get("rxcui")):
            target["rxcui"] = incoming_rxcui

        if len(name) > len(clean_text(target.get("name"))):
            target["name"] = name

        target["class_name"] = choose_more_specific_class(target.get("class_name", ""), incoming_class)
        target["class_candidates"].update(incoming_class_candidates)
        target["brands"].update(incoming_brands)
        target["sources"].update(incoming_sources)

        if text_quality_score(incoming_adverse) > text_quality_score(target.get("adverse", "")):
            target["adverse"] = incoming_adverse
        if text_quality_score(incoming_mechanism) > text_quality_score(target.get("mechanism", "")):
            target["mechanism"] = incoming_mechanism

    return merged


def apply_psych_hints(merged: Dict[str, Dict[str, Any]], hint_map: Dict[str, str]) -> Tuple[int, int]:
    updated_existing = 0
    added_new = 0

    for generic_key, class_hint in hint_map.items():
        if generic_key in merged:
            before = clean_text(merged[generic_key].get("class_name"))
            after = choose_more_specific_class(before, class_hint)
            merged[generic_key]["class_name"] = after
            merged[generic_key]["class_candidates"].add(class_hint)
            merged[generic_key]["sources"].add("psych_hint")
            if normalize_generic(before) != normalize_generic(after):
                updated_existing += 1
            continue

        if not INCLUDE_UNRESOLVED_PSYCH_HINTS:
            continue

        merged[generic_key] = {
            "name": generic_key,
            "generic_key": generic_key,
            "rxcui": "",
            "class_name": class_hint,
            "class_candidates": {class_hint},
            "brands": set(),
            "adverse": "",
            "mechanism": "",
            "sources": {"psych_hint_unresolved"},
        }
        added_new += 1

    return updated_existing, added_new


def build_pharm_record(item: Dict[str, Any], used_ids: Set[str]) -> Dict[str, Any]:
    name = clean_text(item.get("name")) or clean_text(item.get("generic_key"))
    generic_key = clean_text(item.get("generic_key")) or normalize_generic_name(name)
    rxcui = clean_text(item.get("rxcui"))

    class_candidates = [
        normalize_class_label(candidate)
        for candidate in item.get("class_candidates", set())
        if clean_text(candidate)
    ]
    class_candidates = [candidate for candidate in uniq_casefold(class_candidates) if not is_broad_class(candidate)]

    selected_class = choose_most_specific_class([item.get("class_name", "")] + class_candidates)
    if not selected_class:
        selected_class = FALLBACK_CLASS_NAME

    adverse_text = first_sentence(clean_text(item.get("adverse")), max_chars=430)
    mechanism_text = first_sentence(clean_text(item.get("mechanism")), max_chars=430)
    brands = sorted(uniq_casefold(item.get("brands", set())), key=lambda value: value.casefold())

    routes = infer_routes(name, selected_class, mechanism_text)

    base_id = f"rxclass-{rxcui}" if re.fullmatch(r"\d+", rxcui) else f"rxclass-{slugify(generic_key)}"
    med_id = base_id
    suffix = 2
    while med_id in used_ids:
        med_id = f"{base_id}-{suffix}"
        suffix += 1
    used_ids.add(med_id)

    pearls: List[str] = []
    if rxcui:
        pearls.append(f"RxCUI: {rxcui}")
    if class_candidates:
        pearl_candidates = class_candidates[:MAX_PEARL_CLASS_CANDIDATES]
        pearls.append("Class candidates: " + "; ".join(pearl_candidates))

    moa = mechanism_text or FALLBACK_MOA
    adverse_effects = [adverse_text] if adverse_text else [FALLBACK_ADVERSE_EFFECT]

    record = {
        "id": med_id,
        "name": name,
        "drugClass": selected_class,
        "specificClassLabel": selected_class,
        "routes": routes,
        "moa": moa,
        "indications": [FALLBACK_INDICATION],
        "contraindications": [FALLBACK_CONTRAINDICATION],
        "adverseEffects": adverse_effects,
        "majorInteractions": [FALLBACK_INTERACTION],
        "monitoring": [FALLBACK_MONITORING],
        "aliases": [],
        "brandExamples": brands[:MAX_BRANDS_PER_DRUG],
        "pearls": pearls,
        "classCandidates": class_candidates,
        "classTags": uniq_casefold([selected_class] + class_candidates),
        "rxnorm": {
            "rxcui": rxcui,
            "source": "rxclass",
        },
        "sourceFlags": sorted([clean_text(flag) for flag in item.get("sources", set()) if clean_text(flag)]),
    }

    return record


def maybe_enrich_with_openfda(merged: Dict[str, Dict[str, Any]]) -> int:
    if not ENABLE_OPENFDA_ENRICHMENT:
        return 0

    session = ensure_requests_session()
    enriched_count = 0

    for item in merged.values():
        generic_name = clean_text(item.get("name"))
        brands = sorted(uniq_casefold(item.get("brands", set())), key=lambda value: value.casefold())
        record = fetch_openfda_label_record(session, generic_name=generic_name, brands=brands)
        if not record:
            continue

        adverse = extract_openfda_section(record, "adverse_reactions", max_chars=1200)
        mechanism = extract_openfda_section(record, "mechanism_of_action", max_chars=600)

        if text_quality_score(adverse) > text_quality_score(item.get("adverse", "")):
            item["adverse"] = adverse
            enriched_count += 1
        if text_quality_score(mechanism) > text_quality_score(item.get("mechanism", "")):
            item["mechanism"] = mechanism
            enriched_count += 1

        if SLEEP_BETWEEN_REQUESTS_SECONDS > 0:
            time.sleep(SLEEP_BETWEEN_REQUESTS_SECONDS)

    return enriched_count


def run() -> None:
    source_rows: List[Dict[str, Any]] = []

    if USE_SEED_EPC_POOL:
        seed_rows = load_epc_pool_seed(SEED_EPC_POOL_PATH)
        source_rows.extend(seed_rows)
        print(f"Loaded EPC pool seed rows: {len(seed_rows)}")

    if USE_SEED_NERVOUS_SYSTEM:
        nervous_rows = load_nervous_system_seed(SEED_NERVOUS_SYSTEM_PATH)
        source_rows.extend(nervous_rows)
        print(f"Loaded nervous-system seed rows: {len(nervous_rows)}")

    if USE_SEED_PRESCRIBABLE_EPC_AGENTS:
        epc_agent_rows = load_prescribable_epc_agents_seed(SEED_PRESCRIBABLE_EPC_AGENTS_PATH)
        source_rows.extend(epc_agent_rows)
        print(f"Loaded prescribable EPC agent seed rows: {len(epc_agent_rows)}")

    if ENABLE_LIVE_EPC_FETCH:
        live_rows = fetch_live_epc_pool_rows()
        source_rows.extend(live_rows)
        print(f"Loaded live EPC rows: {len(live_rows)}")

    if not source_rows:
        raise RuntimeError("No source rows loaded. Enable seed files or live EPC fetch.")

    merged = merge_input_rows(source_rows)

    psych_hint_map = load_psych_hint_map(PSYCH_MEDS_JSON_PATH)
    psych_updated_existing, psych_added_new = apply_psych_hints(merged, psych_hint_map)

    openfda_enrichment_hits = maybe_enrich_with_openfda(merged)

    used_ids: Set[str] = set()
    records = [build_pharm_record(item, used_ids) for item in merged.values()]

    if SORT_OUTPUT_BY_NAME:
        records.sort(key=lambda item: normalize_generic(item.get("name", "")))

    fallback_count = sum(
        1
        for item in records
        if normalize_generic(item.get("drugClass", "")) == normalize_generic(FALLBACK_CLASS_NAME)
    )

    payload = {
        "version": "1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "medications": records,
    }
    write_json(OUTPUT_DATASET_PATH, payload)

    report = {
        "generatedAt": payload["generatedAt"],
        "inputFiles": {
            "seedEpcPool": str(SEED_EPC_POOL_PATH),
            "seedNervousSystem": str(SEED_NERVOUS_SYSTEM_PATH),
            "seedPrescribableEpcAgents": str(SEED_PRESCRIBABLE_EPC_AGENTS_PATH),
            "psychMeds": str(PSYCH_MEDS_JSON_PATH),
        },
        "outputFiles": {
            "dataset": str(OUTPUT_DATASET_PATH),
            "report": str(OUTPUT_REPORT_PATH),
        },
        "counts": {
            "sourceRows": len(source_rows),
            "mergedRows": len(merged),
            "finalRecords": len(records),
            "fallbackClassRecords": fallback_count,
            "psychHintsLoaded": len(psych_hint_map),
            "psychHintsUpdatedExisting": psych_updated_existing,
            "psychHintsAddedNew": psych_added_new,
            "openfdaEnrichmentHits": openfda_enrichment_hits,
        },
        "toggles": {
            "useSeedEpcPool": USE_SEED_EPC_POOL,
            "useSeedNervousSystem": USE_SEED_NERVOUS_SYSTEM,
            "useSeedPrescribableEpcAgents": USE_SEED_PRESCRIBABLE_EPC_AGENTS,
            "enableLiveEpcFetch": ENABLE_LIVE_EPC_FETCH,
            "enableOpenfdaEnrichment": ENABLE_OPENFDA_ENRICHMENT,
            "includeUnresolvedPsychHints": INCLUDE_UNRESOLVED_PSYCH_HINTS,
        },
    }
    write_json(OUTPUT_REPORT_PATH, report)

    print("RxClass medication catalog build completed.")
    print(f"- Source rows: {len(source_rows)}")
    print(f"- Merged rows: {len(merged)}")
    print(f"- Final records: {len(records)}")
    print(f"- Fallback class records: {fallback_count}")
    print(f"- Dataset: {OUTPUT_DATASET_PATH}")
    print(f"- Report: {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    run()
