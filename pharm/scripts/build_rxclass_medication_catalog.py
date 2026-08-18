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
INCLUDE_UNRESOLVED_PSYCH_HINTS = False

# Scope trimming
GENERAL_SURGERY_ONLY = True
GENERAL_SURGERY_CLASS_INCLUDE_KEYWORDS = [
    "antibacterial",
    "antimicrobial",
    "anesthetic",
    "general anesthetic",
    "local anesthetic",
    "neuromuscular blocker",
    "opioid agonist",
    "nonsteroidal anti-inflammatory drug",
    "serotonin-3 receptor antagonist",
    "proton pump inhibitor",
    "histamine-2 receptor antagonist",
    "low molecular weight heparin",
    "insulin analog",
    "vasopressin receptor agonist",
]
GENERAL_SURGERY_CLASS_EXCLUDE_KEYWORDS = [
    "allergen",
    "allergenic extract",
    "vaccine",
    "antipsychotic",
    "antidepressant",
    "psychoactive substance",
    "stimulant",
    "hypnotic",
    "hepatitis",
    "human immunodeficiency virus",
    "hiv",
    "influenza",
    "herpes zoster",
    "contraceptive",
    "fertility",
    "migraine",
    "parkinson",
    "dementia",
    "protease inhibitor",
    "integrase strand transfer",
    "neuraminidase inhibitor",
    "proteasome inhibitor",
    "plasma kallikrein inhibitor",
    "antimycobacterial",
    "antiparasitic",
    "pediculicide",
    "ectoparasiticide",
]
GENERAL_SURGERY_NAME_INCLUDE_KEYWORDS = [
    "acetaminophen",
    "ampicillin",
    "atracurium",
    "aztreonam",
    "bupivacaine",
    "cefazolin",
    "cefepime",
    "cefoxitin",
    "ceftriaxone",
    "cisatracurium",
    "clindamycin",
    "dexamethasone",
    "dexmedetomidine",
    "desflurane",
    "diazepam",
    "dobutamine",
    "dopamine",
    "enoxaparin",
    "ephedrine",
    "etomidate",
    "famotidine",
    "fentanyl",
    "flumazenil",
    "granisetron",
    "heparin",
    "hydrocodone",
    "hydromorphone",
    "ibuprofen",
    "insulin",
    "isoflurane",
    "ketamine",
    "ketorolac",
    "lidocaine",
    "lorazepam",
    "metronidazole",
    "methylprednisolone",
    "midazolam",
    "morphine",
    "naloxone",
    "neostigmine",
    "norepinephrine",
    "ofirmev",
    "omeprazole",
    "ondansetron",
    "oxycodone",
    "palonosetron",
    "pantoprazole",
    "penicillin",
    "phenylephrine",
    "piperacillin",
    "prednisone",
    "propofol",
    "protamine",
    "rocuronium",
    "ropivacaine",
    "sevoflurane",
    "sugammadex",
    "succinylcholine",
    "terlipressin",
    "tramadol",
    "vancomycin",
    "vasopressin",
    "vecuronium",
]
GENERAL_SURGERY_NAME_EXCLUDE_KEYWORDS = [
    "alcohol",
    "cannabis",
    "difelikefalin",
    "ghb",
    "loperamide",
    "mescaline",
    "methadone",
    "phencyclidine",
    "psilocybin",
]
GENERAL_SURGERY_SUPPLEMENTAL_ROWS = [
    {
        "name": "acetaminophen",
        "class_candidates": ["Nonopioid Analgesic", "Antipyretic"],
    },
    {
        "name": "ampicillin / sulbactam",
        "class_candidates": ["Penicillin-class Antibacterial", "Antibacterial", "Antimicrobial"],
    },
    {
        "name": "heparin",
        "class_candidates": ["Anticoagulant", "Hematology Agent"],
    },
    {
        "name": "piperacillin / tazobactam",
        "class_candidates": ["Penicillin-class Antibacterial", "Antibacterial", "Antimicrobial"],
    },
    {
        "name": "sugammadex",
        "class_candidates": ["Neuromuscular Blockade Reversal Agent", "Reversal Agent"],
    },
    {
        "name": "vasopressin",
        "class_candidates": ["Vasopressin Receptor Agonist", "Cardiovascular Agent"],
    },
]

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

# Optional text enrichment from openFDA label data
ENABLE_OPENFDA_ENRICHMENT = True
OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
OPENFDA_LIMIT = 5
OPENFDA_LABEL_CACHE_PATH = PHARM_DIR / "assests" / "openfda_label_cache.json"
OPENFDA_ENRICHMENT_FORCE_REFRESH = False
OPENFDA_REFRESH_LOW_QUALITY_CACHE = True
OPENFDA_ENRICHMENT_PROGRESS_EVERY = 50
OPENFDA_ENRICHMENT_MAX_SENTENCES = 5
OPENFDA_ENRICHMENT_BATCH_SIZE = 0
OPENFDA_ENRICHMENT_SAVE_EVERY = 25

# Optional brand validation/enrichment from openFDA NDC
ENABLE_OPENFDA_BRAND_VALIDATION = True
ENABLE_OPENFDA_BRAND_ENRICHMENT = False
OPENFDA_NDC_URL = "https://api.fda.gov/drug/ndc.json"
OPENFDA_BRAND_VALIDATION_LIMIT = 5
OPENFDA_BRAND_ENRICHMENT_LIMIT = 100
MAX_OPENFDA_BRAND_CANDIDATES = 12
MAX_OPENFDA_VERIFIED_BRANDS_PER_DRUG = 6

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

SEED_IDENTITY_CONFLICT_SOURCES = {
    "nervous_system_seed",
    "prescribable_epc_agents_seed",
}

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

    normalized = re.sub(r"\s*(/|\+)\s*", " and ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    for derivative in sorted(DISTINCT_DERIVATIVES, key=len, reverse=True):
        if normalized == derivative or normalized.startswith(f"{derivative} "):
            return derivative

    tokens = normalized.split()
    while len(tokens) > 1 and tokens[-1] in COMMON_SALT_SUFFIXES:
        tokens.pop()

    return " ".join(tokens).strip()


def normalize_identity_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", normalize_generic(value)).strip()


def get_significant_name_tokens(name: str) -> List[str]:
    normalized = normalize_identity_text(name)
    tokens = [
        token
        for token in normalized.split()
        if len(token) >= 5 and token not in COMMON_SALT_SUFFIXES
    ]
    if not tokens:
        return []

    deduped: List[str] = []
    seen: Set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped


def text_supports_generic_identity(name: str, *parts: str) -> bool:
    combined = normalize_identity_text(" ".join(clean_text(part) for part in parts))
    if not combined:
        return False

    name_key = normalize_generic_name(name)
    if name_key and name_key in combined:
        return True

    for token in get_significant_name_tokens(name):
        if token in combined:
            return True
        singular = token[:-1] if token.endswith("s") else token
        plural = f"{token}s" if not token.endswith("s") else token
        if singular and singular in combined:
            return True
        if plural and plural in combined:
            return True

    return False


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


def text_matches_any_keyword(parts: Iterable[str], keywords: Iterable[str]) -> bool:
    normalized_parts = [normalize_generic(part) for part in parts if clean_text(part)]
    normalized_keywords = [normalize_generic(keyword) for keyword in keywords if clean_text(keyword)]
    return any(keyword and keyword in part for part in normalized_parts for keyword in normalized_keywords)


def is_general_surgery_relevant(item: Dict[str, Any]) -> Tuple[bool, str]:
    if not GENERAL_SURGERY_ONLY:
        return True, "filter_disabled"

    name = clean_text(item.get("name"))
    class_candidates = [
        normalize_class_label(candidate)
        for candidate in item.get("class_candidates", set())
        if clean_text(candidate)
    ]
    sources = {clean_text(source) for source in item.get("sources", set()) if clean_text(source)}

    explicit_include = text_matches_any_keyword([name], GENERAL_SURGERY_NAME_INCLUDE_KEYWORDS)
    class_include = text_matches_any_keyword(class_candidates, GENERAL_SURGERY_CLASS_INCLUDE_KEYWORDS)
    include_match = explicit_include or class_include

    if text_matches_any_keyword([name], GENERAL_SURGERY_NAME_EXCLUDE_KEYWORDS):
        return False, "name_excluded"
    if text_matches_any_keyword(class_candidates, GENERAL_SURGERY_CLASS_EXCLUDE_KEYWORDS) and not explicit_include:
        return False, "class_excluded"
    if sources and sources.issubset({"psych_hint", "psych_hint_unresolved"}) and not explicit_include:
        return False, "psych_only"
    if not include_match:
        return False, "no_surgery_signal"
    return True, "included"


def filter_general_surgery_relevant_items(
    merged: Dict[str, Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
    if not GENERAL_SURGERY_ONLY:
        return merged, {"retained": len(merged), "excluded": 0}

    filtered: Dict[str, Dict[str, Any]] = {}
    stats = {
        "retained": 0,
        "excluded": 0,
        "excludedByName": 0,
        "excludedByClass": 0,
        "excludedPsychOnly": 0,
        "excludedNoSignal": 0,
    }

    for generic_key, item in merged.items():
        keep, reason = is_general_surgery_relevant(item)
        if keep:
            filtered[generic_key] = item
            stats["retained"] += 1
            continue

        stats["excluded"] += 1
        if reason == "name_excluded":
            stats["excludedByName"] += 1
        elif reason == "class_excluded":
            stats["excludedByClass"] += 1
        elif reason == "psych_only":
            stats["excludedPsychOnly"] += 1
        else:
            stats["excludedNoSignal"] += 1

    return filtered, stats


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


def load_general_surgery_supplemental_rows() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in GENERAL_SURGERY_SUPPLEMENTAL_ROWS:
        name = clean_text(row.get("name"))
        if not name:
            continue
        rows.append(
            {
                "rxcui": clean_text(row.get("rxcui")),
                "name": name,
                "class_candidates": [
                    clean_text(value)
                    for value in as_list(row.get("class_candidates"))
                    if clean_text(value)
                ],
                "brands": [clean_text(value) for value in as_list(row.get("brands")) if clean_text(value)],
                "adverse": clean_text(row.get("adverse")),
                "mechanism": clean_text(row.get("mechanism")),
                "indications": uniq_casefold(as_list(row.get("indications"))),
                "contraindications": uniq_casefold(as_list(row.get("contraindications"))),
                "major_interactions": uniq_casefold(as_list(row.get("major_interactions"))),
                "monitoring": uniq_casefold(as_list(row.get("monitoring"))),
                "source": ["general_surgery_manual_seed"],
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


def load_openfda_label_cache(path: Path) -> Dict[str, Dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        payload = load_json(path)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        return {}
    return {clean_text(key): value for key, value in entries.items() if clean_text(key) and isinstance(value, dict)}


def write_openfda_label_cache(path: Path, cache: Dict[str, Dict[str, Any]]) -> None:
    write_json(
        path,
        {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "entries": cache,
        },
    )


def get_openfda_openfda_list(record: Dict[str, Any], key: str) -> List[str]:
    openfda = record.get("openfda")
    if not isinstance(openfda, dict):
        return []
    values = openfda.get(key)
    if not isinstance(values, list):
        return []
    return [clean_text(item) for item in values if clean_text(item)]


def openfda_record_indication_text(record: Dict[str, Any]) -> str:
    values = record.get("indications_and_usage")
    if not isinstance(values, list):
        return ""
    return " ".join(clean_text(item) for item in values if clean_text(item))


def openfda_record_route_score(record: Dict[str, Any]) -> int:
    route_values = get_openfda_openfda_list(record, "route")
    route_text = " ".join(route_values).upper()
    score = 0
    if "INTRAVENOUS" in route_text or "INTRAMUSCULAR" in route_text:
        score += 18
    if "INJECTION" in route_text:
        score += 10
    if "NASAL" in route_text:
        score -= 12
    return score


def openfda_record_perioperative_score(record: Dict[str, Any]) -> int:
    indication_text = normalize_generic(openfda_record_indication_text(record))
    if not indication_text:
        return 0

    score = 0
    if re.search(r"\b(preoperative|perioperative|surgery|surgical|anesthesia|sedation|procedure|intubation|shock)\b", indication_text):
        score += 25
    if re.search(r"\bseizure|epilep", indication_text):
        score -= 12
    return score


def score_openfda_label_record(record: Dict[str, Any], generic_key: str, brands: List[str]) -> int:
    generic_names = [
        normalize_generic_name(value)
        for value in get_openfda_openfda_list(record, "generic_name") + get_openfda_openfda_list(record, "substance_name")
        if clean_text(value)
    ]
    brand_names = [normalize_brand_name(value) for value in get_openfda_openfda_list(record, "brand_name") if clean_text(value)]
    score = 0

    if generic_key in generic_names:
        score += 100
    if any(generic_key and generic_key in value for value in generic_names):
        score += 35
    if any((" and " in value or "," in value) for value in generic_names) and " and " not in generic_key and "," not in generic_key:
        score -= 25

    normalized_brands = [normalize_brand_name(value) for value in brands if clean_text(value)]
    for brand in normalized_brands:
        if brand and brand in brand_names:
            score += 25

    if GENERAL_SURGERY_ONLY:
        score += openfda_record_route_score(record)
        score += openfda_record_perioperative_score(record)

    return score


def choose_best_openfda_label_record(
    records: List[Dict[str, Any]],
    generic_name: str,
    brands: List[str],
) -> Optional[Dict[str, Any]]:
    generic_key = normalize_generic_name(generic_name)
    if not generic_key:
        return records[0] if records else None

    ranked = sorted(
        (record for record in records if isinstance(record, dict)),
        key=lambda record: score_openfda_label_record(record, generic_key, brands),
        reverse=True,
    )
    return ranked[0] if ranked else None


def split_openfda_text_into_items(text: str, max_items: int, max_chars: int) -> List[str]:
    cleaned = clean_text(text)
    if not cleaned:
        return []

    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    raw_parts = re.split(r"(?<=[.!?])\s+|(?<=;)\s+", cleaned)
    items: List[str] = []
    seen: Set[str] = set()

    for raw_part in raw_parts:
        part = clean_text(raw_part)
        if not part:
            continue
        if len(part) < 18:
            continue
        part = trim_text(part, max_chars)
        key = normalize_generic(part)
        if not key or key in seen:
            continue
        seen.add(key)
        items.append(part)
        if len(items) >= max_items:
            break

    if items:
        return items
    return [trim_text(cleaned, max_chars)]


def is_plausible_clinical_item(text: str, section_key: str) -> bool:
    normalized = normalize_generic(text)
    if not normalized:
        return False

    if section_key == "indications_and_usage":
        if re.match(r"^(take|use|apply|insert|instill|administer|store|shake)\b", normalized):
            return False
    return True


def extract_openfda_section_items(record: Optional[Dict[str, Any]], key: str, max_items: int, max_chars: int) -> List[str]:
    if not isinstance(record, dict):
        return []
    values = record.get(key)
    if not isinstance(values, list):
        return []
    joined = " ".join(clean_text(item) for item in values if clean_text(item))
    return [
        item
        for item in split_openfda_text_into_items(joined, max_items=max_items, max_chars=max_chars)
        if is_plausible_clinical_item(item, key)
    ]


def extract_monitoring_items_from_openfda(record: Optional[Dict[str, Any]]) -> List[str]:
    warnings = extract_openfda_section_items(record, "warnings_and_precautions", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES * 2, max_chars=260)
    monitoring_items = [
        item
        for item in warnings
        if re.search(r"\bmonitor|\bcheck|\bassess|\bobserve|\btest|\bscreen|\becg\b|\bcbc\b|\bliver\b|\brenal\b|\bcreatinine\b|\bpressure\b", item, re.I)
    ]
    if monitoring_items:
        return monitoring_items[:OPENFDA_ENRICHMENT_MAX_SENTENCES]

    labs = extract_openfda_section_items(record, "laboratory_tests", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)
    return labs[:OPENFDA_ENRICHMENT_MAX_SENTENCES]


def extract_openfda_payload(record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    mechanism = extract_openfda_section(record, "mechanism_of_action", max_chars=600)
    if not mechanism:
        mechanism = extract_openfda_section(record, "clinical_pharmacology", max_chars=600)

    indications = extract_openfda_section_items(record, "indications_and_usage", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)
    if not indications:
        indications = extract_openfda_section_items(record, "purpose", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)

    contraindications = extract_openfda_section_items(record, "contraindications", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)
    if not contraindications:
        contraindications = extract_openfda_section_items(record, "do_not_use", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)

    adverse_effects = extract_openfda_section_items(record, "adverse_reactions", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)
    major_interactions = extract_openfda_section_items(record, "drug_interactions", max_items=OPENFDA_ENRICHMENT_MAX_SENTENCES, max_chars=260)
    monitoring = extract_monitoring_items_from_openfda(record)

    return {
        "mechanism": mechanism,
        "indications": indications,
        "contraindications": contraindications,
        "adverse_effects": adverse_effects,
        "major_interactions": major_interactions,
        "monitoring": monitoring,
    }


def cache_entry_needs_openfda_refresh(entry: Optional[Dict[str, Any]]) -> bool:
    if not OPENFDA_REFRESH_LOW_QUALITY_CACHE:
        return False
    if not isinstance(entry, dict):
        return True

    indications = [item for item in as_list(entry.get("indications")) if clean_text(item)]
    contraindications = [item for item in as_list(entry.get("contraindications")) if clean_text(item)]

    if not indications or not contraindications:
        return True
    if not all(is_plausible_clinical_item(item, "indications_and_usage") for item in indications):
        return True
    return False


def apply_openfda_payload_to_item(item: Dict[str, Any], payload: Dict[str, Any]) -> int:
    enriched_count = 0

    adverse_items = uniq_casefold(as_list(item.get("adverse_effects")) + as_list(payload.get("adverse_effects")))
    indications = uniq_casefold(as_list(item.get("indications")) + as_list(payload.get("indications")))
    contraindications = uniq_casefold(as_list(item.get("contraindications")) + as_list(payload.get("contraindications")))
    interactions = uniq_casefold(as_list(item.get("major_interactions")) + as_list(payload.get("major_interactions")))
    monitoring = uniq_casefold(as_list(item.get("monitoring")) + as_list(payload.get("monitoring")))
    mechanism = clean_text(payload.get("mechanism"))
    adverse_text = " ".join(adverse_items)

    if text_quality_score(adverse_text) > text_quality_score(item.get("adverse", "")):
        item["adverse"] = adverse_text
        enriched_count += 1
    if text_quality_score(mechanism) > text_quality_score(item.get("mechanism", "")):
        item["mechanism"] = mechanism
        enriched_count += 1
    if len(indications) > len(as_list(item.get("indications"))):
        item["indications"] = indications
        enriched_count += 1
    if len(contraindications) > len(as_list(item.get("contraindications"))):
        item["contraindications"] = contraindications
        enriched_count += 1
    if len(interactions) > len(as_list(item.get("major_interactions"))):
        item["major_interactions"] = interactions
        enriched_count += 1
    if len(monitoring) > len(as_list(item.get("monitoring"))):
        item["monitoring"] = monitoring
        enriched_count += 1

    if any(payload.get(key) for key in ("mechanism", "indications", "contraindications", "adverse_effects", "major_interactions", "monitoring")):
        item["sources"].add("openfda_label")

    return enriched_count


def fetch_openfda_label_record(session: requests.Session, generic_name: str, brands: List[str]) -> Optional[Dict[str, Any]]:
    generic_variants = [clean_text(generic_name)]
    normalized_generic = normalize_generic_name(generic_name)
    if normalized_generic and normalized_generic not in {normalize_generic(value) for value in generic_variants}:
        generic_variants.append(normalized_generic)

    query_specs = [
        ("openfda.generic_name", query_name)
        for query_name in uniq_casefold(generic_variants)
        if clean_text(query_name)
    ] + [
        ("openfda.brand_name", brand_name)
        for brand_name in brands[:MAX_BRANDS_PER_DRUG]
    ]
    candidate_records: List[Dict[str, Any]] = []
    for field_name, query_name in query_specs:
        escaped = query_name.replace('"', '\\"')
        params = {
            "search": f'{field_name}:"{escaped}"',
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
            candidate_records.extend([record for record in results if isinstance(record, dict)])

    return choose_best_openfda_label_record(candidate_records, generic_name, brands)


def extract_openfda_section(record: Optional[Dict[str, Any]], key: str, max_chars: int) -> str:
    if not isinstance(record, dict):
        return ""
    values = record.get(key)
    if not isinstance(values, list):
        return ""
    joined = " ".join(clean_text(item) for item in values if clean_text(item))
    return trim_text(joined, max_chars)


def sanitize_seed_rows(source_rows: List[Dict[str, Any]]) -> int:
    adjusted_rows = 0
    for row in source_rows:
        sources = {clean_text(item) for item in as_list(row.get("source")) if clean_text(item)}
        if not sources.intersection(SEED_IDENTITY_CONFLICT_SOURCES):
            continue

        name = clean_text(row.get("name"))
        mechanism = clean_text(row.get("mechanism"))
        adverse = clean_text(row.get("adverse"))
        brands = uniq_casefold(as_list(row.get("brands")))

        if not name:
            continue

        # Seed rows that carry narrative text for another drug tend to omit the
        # row's own generic name entirely; clear those enrichment fields rather
        # than propagating bad brand/generic links into the final catalog.
        if text_supports_generic_identity(name, mechanism, adverse):
            continue

        if not (mechanism or adverse or brands):
            continue

        row["brands"] = brands
        row["mechanism"] = ""
        row["adverse"] = ""
        row["source"] = sorted(sources | {"seed_identity_conflict"})
        adjusted_rows += 1

    return adjusted_rows


def escape_openfda_phrase(value: str) -> str:
    return clean_text(value).replace('"', '\\"')


def normalize_brand_name(value: str) -> str:
    return normalize_identity_text(value)


def is_generic_like_brand_term(generic_key: str, term: str) -> bool:
    generic_norm = normalize_identity_text(generic_key)
    term_norm = normalize_brand_name(term)
    if not term_norm:
        return True
    if term_norm == generic_norm:
        return True
    if generic_norm and generic_norm in term_norm:
        return True
    if term_norm and term_norm in generic_norm:
        return True
    return False


def brand_maps_to_generic(session: requests.Session, generic_key: str, brand_name: str) -> bool:
    escaped = escape_openfda_phrase(brand_name)
    params = {
        "search": f'brand_name:"{escaped}"',
        "limit": OPENFDA_BRAND_VALIDATION_LIMIT,
    }
    try:
        response = session.get(OPENFDA_NDC_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        if response.status_code == 404:
            return False
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return False

    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return False

    for result in results:
        if not isinstance(result, dict):
            continue
        result_generic = normalize_generic_name(clean_text(result.get("generic_name")))
        if not result_generic:
            continue
        if result_generic == generic_key:
            return True
        if generic_key in result_generic or result_generic in generic_key:
            return True
    return False


def fetch_openfda_brand_candidates(session: requests.Session, generic_name: str) -> List[str]:
    escaped = escape_openfda_phrase(generic_name)
    params = {
        "search": f'generic_name:"{escaped}"',
        "count": "brand_name.exact",
    }
    try:
        response = session.get(OPENFDA_NDC_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []

    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return []

    candidates: List[str] = []
    generic_key = normalize_generic_name(generic_name)
    for result in results[:MAX_OPENFDA_BRAND_CANDIDATES]:
        if not isinstance(result, dict):
            continue
        term = clean_text(result.get("term"))
        if not term or is_generic_like_brand_term(generic_key, term):
            continue
        candidates.append(term)
    return uniq_casefold(candidates)


def validate_and_enrich_brands(merged: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    stats = {
        "validated_existing_brands": 0,
        "dropped_existing_brands": 0,
        "added_brands_from_openfda": 0,
        "records_with_brand_updates": 0,
    }

    if not ENABLE_OPENFDA_BRAND_VALIDATION and not ENABLE_OPENFDA_BRAND_ENRICHMENT:
        return stats
    if requests is None:
        return stats

    session = ensure_requests_session()

    for item in merged.values():
        generic_name = clean_text(item.get("name")) or clean_text(item.get("generic_key"))
        generic_key = clean_text(item.get("generic_key")) or normalize_generic_name(generic_name)
        if not generic_name or not generic_key:
            continue

        current_brands = uniq_casefold(item.get("brands", set()))
        next_brands: List[str] = []
        record_changed = False
        used_network = False

        if ENABLE_OPENFDA_BRAND_VALIDATION and current_brands:
            for brand in current_brands:
                used_network = True
                if brand_maps_to_generic(session, generic_key, brand):
                    next_brands.append(brand)
                    stats["validated_existing_brands"] += 1
                else:
                    stats["dropped_existing_brands"] += 1
                    record_changed = True
        else:
            next_brands.extend(current_brands)

        if ENABLE_OPENFDA_BRAND_ENRICHMENT:
            for candidate in fetch_openfda_brand_candidates(session, generic_name):
                if len(next_brands) >= MAX_OPENFDA_VERIFIED_BRANDS_PER_DRUG:
                    break
                if any(candidate.casefold() == existing.casefold() for existing in next_brands):
                    continue
                used_network = True
                if brand_maps_to_generic(session, generic_key, candidate):
                    next_brands.append(candidate)
                    stats["added_brands_from_openfda"] += 1
                    record_changed = True

        item["brands"] = set(uniq_casefold(next_brands))
        if record_changed:
            item["sources"].add("openfda_brand_review")
            stats["records_with_brand_updates"] += 1

        if used_network and SLEEP_BETWEEN_REQUESTS_SECONDS > 0:
            time.sleep(SLEEP_BETWEEN_REQUESTS_SECONDS)

    return stats


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
        incoming_indications = uniq_casefold(as_list(source_row.get("indications")))
        incoming_contraindications = uniq_casefold(as_list(source_row.get("contraindications")))
        incoming_interactions = uniq_casefold(as_list(source_row.get("major_interactions")))
        incoming_monitoring = uniq_casefold(as_list(source_row.get("monitoring")))
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
                "indications": list(incoming_indications),
                "contraindications": list(incoming_contraindications),
                "major_interactions": list(incoming_interactions),
                "monitoring": list(incoming_monitoring),
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
        target["indications"] = uniq_casefold(as_list(target.get("indications")) + incoming_indications)
        target["contraindications"] = uniq_casefold(as_list(target.get("contraindications")) + incoming_contraindications)
        target["major_interactions"] = uniq_casefold(as_list(target.get("major_interactions")) + incoming_interactions)
        target["monitoring"] = uniq_casefold(as_list(target.get("monitoring")) + incoming_monitoring)

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
            "indications": [],
            "contraindications": [],
            "major_interactions": [],
            "monitoring": [],
            "sources": {"psych_hint_unresolved"},
        }
        added_new += 1

    return updated_existing, added_new


def build_pharm_record(item: Dict[str, Any], used_ids: Set[str]) -> Dict[str, Any]:
    name = clean_text(item.get("name")) or clean_text(item.get("generic_key"))
    generic_key = clean_text(item.get("generic_key")) or normalize_generic_name(name)
    generic_name = name or generic_key
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
    indications = uniq_casefold(as_list(item.get("indications")))
    contraindications = uniq_casefold(as_list(item.get("contraindications")))
    major_interactions = uniq_casefold(as_list(item.get("major_interactions")))
    monitoring = uniq_casefold(as_list(item.get("monitoring")))

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
        "name": generic_name,
        "genericName": generic_name,
        "drugClass": selected_class,
        "specificClassLabel": selected_class,
        "routes": routes,
        "moa": moa,
        "indications": indications[:OPENFDA_ENRICHMENT_MAX_SENTENCES] or [FALLBACK_INDICATION],
        "contraindications": contraindications[:OPENFDA_ENRICHMENT_MAX_SENTENCES] or [FALLBACK_CONTRAINDICATION],
        "adverseEffects": adverse_effects,
        "majorInteractions": major_interactions[:OPENFDA_ENRICHMENT_MAX_SENTENCES] or [FALLBACK_INTERACTION],
        "monitoring": monitoring[:OPENFDA_ENRICHMENT_MAX_SENTENCES] or [FALLBACK_MONITORING],
        "aliases": brands,
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
    cache = load_openfda_label_cache(OPENFDA_LABEL_CACHE_PATH)
    enriched_count = 0
    pending_items: List[Tuple[str, Dict[str, Any]]] = []

    for item in merged.values():
        generic_name = clean_text(item.get("name"))
        generic_key = clean_text(item.get("generic_key")) or normalize_generic_name(generic_name)
        if not generic_name or not generic_key:
            continue
        cached_entry = cache.get(generic_key)
        if OPENFDA_ENRICHMENT_FORCE_REFRESH or generic_key not in cache or cache_entry_needs_openfda_refresh(cached_entry):
            pending_items.append((generic_key, item))

    if OPENFDA_ENRICHMENT_BATCH_SIZE > 0:
        pending_items = pending_items[:OPENFDA_ENRICHMENT_BATCH_SIZE]

    fetched_count = 0
    total_to_fetch = len(pending_items)

    for generic_key, item in pending_items:
        generic_name = clean_text(item.get("name"))
        brands = sorted(uniq_casefold(item.get("brands", set())), key=lambda value: value.casefold())
        record = fetch_openfda_label_record(session, generic_name=generic_name, brands=brands)
        cache[generic_key] = {
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "brandQuery": brands[:MAX_BRANDS_PER_DRUG],
            **extract_openfda_payload(record),
        }
        fetched_count += 1

        if fetched_count % OPENFDA_ENRICHMENT_PROGRESS_EVERY == 0:
            print(f"openFDA label enrichment progress: {fetched_count}/{total_to_fetch}")
        if fetched_count % OPENFDA_ENRICHMENT_SAVE_EVERY == 0:
            write_openfda_label_cache(OPENFDA_LABEL_CACHE_PATH, cache)
        if SLEEP_BETWEEN_REQUESTS_SECONDS > 0:
            time.sleep(SLEEP_BETWEEN_REQUESTS_SECONDS)

    write_openfda_label_cache(OPENFDA_LABEL_CACHE_PATH, cache)

    if fetched_count and fetched_count % OPENFDA_ENRICHMENT_PROGRESS_EVERY != 0:
        print(f"openFDA label enrichment progress: {fetched_count}/{total_to_fetch}")

    for item in merged.values():
        generic_name = clean_text(item.get("name"))
        generic_key = clean_text(item.get("generic_key")) or normalize_generic_name(generic_name)
        if not generic_key:
            continue
        cached_entry = cache.get(generic_key)
        if not cached_entry:
            continue
        enriched_count += apply_openfda_payload_to_item(item, cached_entry)

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

    if GENERAL_SURGERY_ONLY:
        supplemental_rows = load_general_surgery_supplemental_rows()
        source_rows.extend(supplemental_rows)
        print(f"Loaded general-surgery supplemental rows: {len(supplemental_rows)}")

    if ENABLE_LIVE_EPC_FETCH:
        live_rows = fetch_live_epc_pool_rows()
        source_rows.extend(live_rows)
        print(f"Loaded live EPC rows: {len(live_rows)}")

    if not source_rows:
        raise RuntimeError("No source rows loaded. Enable seed files or live EPC fetch.")

    seed_identity_conflicts = sanitize_seed_rows(source_rows)
    merged = merge_input_rows(source_rows)
    merged_rows_before_filter = len(merged)

    psych_hint_map = load_psych_hint_map(PSYCH_MEDS_JSON_PATH)
    psych_updated_existing, psych_added_new = apply_psych_hints(merged, psych_hint_map)
    merged, surgery_filter_stats = filter_general_surgery_relevant_items(merged)

    brand_review_stats = validate_and_enrich_brands(merged)
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
            "mergedRowsBeforeSurgeryFilter": merged_rows_before_filter,
            "mergedRows": len(merged),
            "finalRecords": len(records),
            "fallbackClassRecords": fallback_count,
            "psychHintsLoaded": len(psych_hint_map),
            "psychHintsUpdatedExisting": psych_updated_existing,
            "psychHintsAddedNew": psych_added_new,
            "generalSurgeryRetained": surgery_filter_stats["retained"],
            "generalSurgeryExcluded": surgery_filter_stats["excluded"],
            "generalSurgeryExcludedByName": surgery_filter_stats.get("excludedByName", 0),
            "generalSurgeryExcludedByClass": surgery_filter_stats.get("excludedByClass", 0),
            "generalSurgeryExcludedPsychOnly": surgery_filter_stats.get("excludedPsychOnly", 0),
            "generalSurgeryExcludedNoSignal": surgery_filter_stats.get("excludedNoSignal", 0),
            "seedIdentityConflictsCleared": seed_identity_conflicts,
            "validatedExistingBrands": brand_review_stats["validated_existing_brands"],
            "droppedExistingBrands": brand_review_stats["dropped_existing_brands"],
            "addedBrandsFromOpenfda": brand_review_stats["added_brands_from_openfda"],
            "recordsWithBrandUpdates": brand_review_stats["records_with_brand_updates"],
            "openfdaEnrichmentHits": openfda_enrichment_hits,
        },
        "toggles": {
            "useSeedEpcPool": USE_SEED_EPC_POOL,
            "useSeedNervousSystem": USE_SEED_NERVOUS_SYSTEM,
            "useSeedPrescribableEpcAgents": USE_SEED_PRESCRIBABLE_EPC_AGENTS,
            "enableLiveEpcFetch": ENABLE_LIVE_EPC_FETCH,
            "enableOpenfdaBrandValidation": ENABLE_OPENFDA_BRAND_VALIDATION,
            "enableOpenfdaBrandEnrichment": ENABLE_OPENFDA_BRAND_ENRICHMENT,
            "enableOpenfdaEnrichment": ENABLE_OPENFDA_ENRICHMENT,
            "includeUnresolvedPsychHints": INCLUDE_UNRESOLVED_PSYCH_HINTS,
            "generalSurgeryOnly": GENERAL_SURGERY_ONLY,
            "generalSurgerySupplementalRows": len(GENERAL_SURGERY_SUPPLEMENTAL_ROWS),
        },
    }
    write_json(OUTPUT_REPORT_PATH, report)

    print("RxClass medication catalog build completed.")
    print(f"- Source rows: {len(source_rows)}")
    print(f"- Merged rows before surgery filter: {merged_rows_before_filter}")
    print(f"- Merged rows after surgery filter: {len(merged)}")
    print(f"- General surgery filter retained: {surgery_filter_stats['retained']}")
    print(f"- General surgery filter excluded: {surgery_filter_stats['excluded']}")
    print(f"- Final records: {len(records)}")
    print(f"- Fallback class records: {fallback_count}")
    print(f"- Seed identity conflicts cleared: {seed_identity_conflicts}")
    print(f"- Existing brands validated: {brand_review_stats['validated_existing_brands']}")
    print(f"- Existing brands dropped: {brand_review_stats['dropped_existing_brands']}")
    print(f"- Brand enrichments added: {brand_review_stats['added_brands_from_openfda']}")
    print(f"- Dataset: {OUTPUT_DATASET_PATH}")
    print(f"- Report: {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    run()
