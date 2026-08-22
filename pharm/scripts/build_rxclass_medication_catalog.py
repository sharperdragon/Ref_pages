#!/usr/bin/env python3
"""Build the single static Pharm medication dataset.

Filled_classes is authoritative for taxonomy. The previous RxClass catalog is
only an identity-metadata source. Cached FDA label sections are the only
clinical source used by this offline build; missing label data stays empty.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from class_blacklist import (
    blacklist_vocabulary_audit,
    filter_class_candidates,
    is_broad_class,
    is_hard_blacklisted_class,
    load_class_blacklist,
    top_labels,
)


# ================================================================
# USER SETTINGS (edit)
# ================================================================
PHARM_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = PHARM_DIR.parent
TAXONOMY_DIR = PHARM_DIR / "Filled_classes"
LEGACY_DATASET_PATH = PHARM_DIR / "assests" / "pharm_data_rxclass_enriched.json"
OPENFDA_LABEL_CACHE_PATH = PHARM_DIR / "assests" / "openfda_label_cache.json"
CLASS_BLACKLIST_PATH = PHARM_DIR / "assests" / "classes" / "class_blacklist.json"
HPO_INDEX_PATH = PHARM_DIR / "assests" / "hpo_index.json"
OUTPUT_DATASET_PATH = PHARM_DIR / "assests" / "pharm_data_rxclass_enriched.json"
OUTPUT_REPORT_PATH = PHARM_DIR / "assests" / "rxclass_catalog_report.json"

EXCLUDED_TAXONOMY_FILES = {
    "dermatologic.json": "Expected dermatologic taxonomy, found an antiviral hierarchy instead.",
}
EXPECTED_ROOTS = {
    "antibiotic_combos.json": {"antimicrobials"}, "antibiotics.json": {"antibiotics"},
    "antifungals_antiparasitics.json": {"antifungals", "antiparasitics"}, "antivirals.json": {"antivirals"},
    "cardiovascular.json": {"cardiovascular"}, "central_nervous_system.json": {"central_nervous_system"},
    "dermatologic.json": {"dermatologic"}, "endocrine.json": {"endocrine"}, "gastrointestinal.json": {"gastrointestinal"},
    "genitourinary_repro.json": {"genitourinary_and_reproductive"}, "respiratory.json": {"respiratory"},
}
CLINICAL_FIELDS = ("moa", "indications", "contraindications", "adverseEffects", "majorInteractions", "monitoring", "pearls")
HPO_ANNOTATED_FIELDS = ("adverseEffects", "indications", "contraindications")
LABEL_FIELD_MAP = {"moa": "mechanism", "indications": "indications", "contraindications": "contraindications", "adverseEffects": "adverse_effects", "majorInteractions": "major_interactions", "monitoring": "monitoring"}
MAX_ITEMS_PER_LABEL_FIELD = 4
MAX_LABEL_ITEM_CHARS = 260
VALID_ROUTES = {"PO", "IV", "IM", "SC", "SL", "TOP", "INH", "IN", "PR", "PV", "OPH", "OTIC", "TD", "BUCCAL", "ID", "IT", "EPIDURAL"}
FALLBACK_PREFIXES = ("therapy class and common inpatient use:", "common inpatient use:", "therapeutic indication varies by formulation and clinical context.", "review official prescribing information", "monitor for medication-specific adverse effects", "monitor based on indication", "monitor per indication", "none listed.")
LABEL_OVERRIDES = {"5ht3": "5-HT3", "ace": "ACE", "cmv": "CMV", "dpp4": "DPP4", "enac": "ENaC", "gaba": "GABA", "glp1": "GLP-1", "h2": "H2", "hcv": "HCV", "hiv": "HIV", "maob": "MAO-B", "nk1": "NK1", "nmda": "NMDA", "nnrtis": "NNRTIs", "nrtis": "NRTIs", "rsv": "RSV", "sglt2": "SGLT2", "sv2a": "SV2A"}


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    value = unicodedata.normalize("NFKD", clean_text(value)).encode("ascii", "ignore").decode("ascii")
    value = value.casefold().replace("&", " and ").replace("_", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


def slugify(value: Any) -> str:
    return normalize_text(value).replace(" ", "-") or "medication"


def timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def unique_text(values: Iterable[Any]) -> list[str]:
    output, seen = [], set()
    for value in values:
        cleaned, key = clean_text(value), normalize_text(value)
        if cleaned and key and key not in seen:
            output.append(cleaned)
            seen.add(key)
    return output


def text_list(value: Any) -> list[str]:
    return unique_text(value if isinstance(value, list) else [value])


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


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_taxonomy(blacklist: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    audit: dict[str, Any] = {"files": [], "excludedFiles": [], "rootMismatches": [], "malformedEntries": [], "emptyBranches": [], "duplicateEntriesWithinIdenticalPaths": [], "identicalCategoryFiles": [], "hardBlacklistedClassPaths": []}
    hashes: dict[str, list[str]] = defaultdict(list)
    for path in sorted(TAXONOMY_DIR.glob("*.json")):
        file_entries: list[dict[str, Any]] = []
        malformed, empty, duplicates = [], [], []
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
                    visit(child, [*keys, key], [*labels, display_label(key)])
            elif isinstance(value, list):
                if not value:
                    empty.append(labels)
                for index, medication in enumerate(value):
                    if not isinstance(medication, str) or not clean_text(medication):
                        malformed.append({"path": labels, "index": index, "reason": "Terminal medication entry must be a non-empty string."})
                        continue
                    name, name_key = clean_text(medication), normalize_text(medication)
                    if name_key in seen_by_path[tuple(keys)]:
                        duplicates.append({"path": labels, "medication": name})
                        continue
                    seen_by_path[tuple(keys)].add(name_key)
                    if any(is_hard_blacklisted_class(label, blacklist) for label in labels):
                        audit["hardBlacklistedClassPaths"].append({"file": path.name, "medication": name, "path": labels})
                        file_entries.append({"name": name, "normalizedName": name_key, "classPath": [], "sourceFile": path.name})
                    else:
                        file_entries.append({"name": name, "normalizedName": name_key, "classPath": labels, "sourceFile": path.name})
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


def empty_external_class_audit() -> dict[str, list[str]]:
    return {
        "knownSourceLabels": [],
        "hardRemoved": [],
        "broadSuppressed": [],
        "onlyBlacklisted": [],
        "affectedHardMedications": [],
        "affectedBroadMedications": [],
    }


def load_legacy_identity_metadata(blacklist: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]], dict[str, list[str]]]:
    external_class_audit = empty_external_class_audit()
    if not LEGACY_DATASET_PATH.exists():
        return {}, [], external_class_audit
    payload = read_json(LEGACY_DATASET_PATH)
    rows = payload if isinstance(payload, list) else payload.get("medications", []) if isinstance(payload, dict) else []
    metadata: dict[str, dict[str, Any]] = {}
    conflicts: list[dict[str, str]] = []
    for index, row in enumerate(rows if isinstance(rows, list) else []):
        if not isinstance(row, dict) or not normalize_text(row.get("name")):
            continue
        key = normalize_text(row["name"])
        rxnorm_payload = row.get("rxnorm")
        rxnorm: dict[str, Any] = rxnorm_payload if isinstance(rxnorm_payload, dict) else {}
        raw_class_labels = [
            clean_text(row.get("drugClass")),
            clean_text(row.get("specificClassLabel")),
            *text_list(row.get("classCandidates")),
            *text_list(row.get("classTags")),
        ]
        raw_class_labels = [label for label in raw_class_labels if label]
        valid_external_classes, hard_removed, broad_classes = filter_class_candidates(raw_class_labels, blacklist)
        external_class_audit["knownSourceLabels"].extend(raw_class_labels)
        external_class_audit["hardRemoved"].extend(hard_removed)
        external_class_audit["broadSuppressed"].extend(broad_classes)
        if hard_removed:
            external_class_audit["affectedHardMedications"].append(clean_text(row["name"]))
        if broad_classes:
            external_class_audit["affectedBroadMedications"].append(clean_text(row["name"]))
        if raw_class_labels and not valid_external_classes:
            external_class_audit["onlyBlacklisted"].append(clean_text(row["name"]))
        item = {"name": clean_text(row["name"]), "genericName": clean_text(row.get("genericName")) or clean_text(row["name"]), "routes": [route for route in text_list(row.get("routes")) if route.upper() in VALID_ROUTES], "aliases": text_list(row.get("aliases")), "brandExamples": text_list(row.get("brandExamples")), "externalClassCandidates": valid_external_classes, "rxcui": clean_text(rxnorm.get("rxcui")), "sourceIndex": index}
        existing = metadata.get(key)
        if existing and existing["rxcui"] and item["rxcui"] and existing["rxcui"] != item["rxcui"]:
            conflicts.append({"normalizedName": key, "firstRxcui": existing["rxcui"], "secondRxcui": item["rxcui"]})
        if existing:
            for field in ("routes", "aliases", "brandExamples", "externalClassCandidates"):
                existing[field] = unique_text([*existing[field], *item[field]])
        else:
            metadata[key] = item
    return metadata, conflicts, external_class_audit


def load_cached_fda_labels() -> dict[str, dict[str, Any]]:
    if not OPENFDA_LABEL_CACHE_PATH.exists():
        return {}
    payload = read_json(OPENFDA_LABEL_CACHE_PATH)
    entries = payload.get("entries", {}) if isinstance(payload, dict) else {}
    return {normalize_text(key): value for key, value in entries.items() if normalize_text(key) and isinstance(value, dict)}


def load_hpo_index() -> dict[str, Any]:
    if not HPO_INDEX_PATH.exists():
        raise FileNotFoundError(f"Missing HPO index: {HPO_INDEX_PATH}. Run build_hpo_index.py before the medication catalog build.")
    payload = read_json(HPO_INDEX_PATH)
    if not isinstance(payload, dict) or not isinstance(payload.get("concepts"), dict) or not isinstance(payload.get("lookups"), dict):
        raise ValueError(f"Invalid HPO index: {HPO_INDEX_PATH}")
    return payload


def empty_hpo_audit(index: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": index.get("audit", {}),
        "clinicalTermsEvaluated": 0,
        "exactLabelMatches": 0,
        "exactSynonymMatches": 0,
        "xrefMatches": 0,
        "ambiguousMatches": 0,
        "unmatchedTerms": 0,
        "ambiguousExamples": [],
        "unmatchedExamples": [],
    }


def add_hpo_audit_example(target: list[dict[str, Any]], value: dict[str, Any]) -> None:
    if len(target) < 25:
        target.append(value)


def hpo_match_term(value: str, index: dict[str, Any]) -> tuple[list[dict[str, str]], str]:
    """Return exact HPO matches only; fuzzy terminology is deliberately excluded."""
    raw, normalized = clean_text(value), normalize_text(value)
    lookups = index.get("lookups", {})
    concepts = index.get("concepts", {})
    source_ids: list[str] = []
    match_type = ""
    if normalized:
        source_ids = lookups.get("byPreferredLabel", {}).get(normalized, [])
        match_type = "exact-label" if source_ids else ""
    if not source_ids and normalized:
        source_ids = lookups.get("bySynonym", {}).get(normalized, [])
        match_type = "exact-synonym" if source_ids else ""
    if not source_ids:
        xref = clean_text(raw).upper()
        if xref.startswith("SNOMEDCT_US:"):
            source_ids = lookups.get("bySnomedCt", {}).get(xref.split(":", 1)[1], [])
            match_type = "xref-snomed" if source_ids else ""
        elif xref.startswith("UMLS:"):
            source_ids = lookups.get("byUmls", {}).get(xref.split(":", 1)[1], [])
            match_type = "xref-umls" if source_ids else ""
    matches = [{"id": concept_id, "label": clean_text(concepts.get(concept_id, {}).get("label")), "matchType": match_type} for concept_id in source_ids if concept_id in concepts]
    return matches, match_type


def annotate_hpo_concepts(clinical: dict[str, Any], index: dict[str, Any], audit: dict[str, Any], medication_name: str) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    annotations: dict[str, list[dict[str, Any]]] = {}
    search_synonyms: list[str] = []
    concepts = index.get("concepts", {})
    for field in HPO_ANNOTATED_FIELDS:
        values = text_list(clinical.get(field))
        if not values:
            continue
        field_annotations = []
        for value in values:
            audit["clinicalTermsEvaluated"] += 1
            matches, match_type = hpo_match_term(value, index)
            if match_type == "exact-label":
                audit["exactLabelMatches"] += 1
            elif match_type == "exact-synonym":
                audit["exactSynonymMatches"] += 1
            elif match_type:
                audit["xrefMatches"] += 1
            if len(matches) > 1:
                audit["ambiguousMatches"] += 1
                add_hpo_audit_example(audit["ambiguousExamples"], {"medication": medication_name, "field": field, "text": value, "hpoIds": [match["id"] for match in matches]})
            if not matches:
                audit["unmatchedTerms"] += 1
                add_hpo_audit_example(audit["unmatchedExamples"], {"medication": medication_name, "field": field, "text": value})
            else:
                # Search expansion only uses a single, exact, active concept.
                if len(matches) == 1 and match_type in {"exact-label", "exact-synonym"}:
                    concept = concepts[matches[0]["id"]]
                    search_synonyms.extend([concept.get("label"), *concept.get("synonyms", [])])
            field_annotations.append({"text": value, "hpo": matches})
        annotations[field] = field_annotations
    return annotations, unique_text(search_synonyms)


def build_search_terms(name: str, metadata: dict[str, Any], class_paths: list[list[str]], clinical: dict[str, Any], hpo_synonyms: list[str]) -> list[str]:
    terms: list[Any] = [name, metadata.get("genericName"), *metadata.get("aliases", []), *metadata.get("brandExamples", [])]
    terms.extend(part for path in class_paths for part in path)
    for field in ("moa", "indications", "contraindications", "adverseEffects", "majorInteractions", "monitoring", "pearls"):
        value = clinical.get(field, "" if field == "moa" else [])
        terms.extend(text_list(value))
    return unique_text([*terms, *hpo_synonyms])


def invalid_clinical_value(value: str, field: str, taxonomy_labels: set[str]) -> bool:
    normalized = normalize_text(value)
    return not normalized or any(normalized.startswith(normalize_text(prefix)) for prefix in FALLBACK_PREFIXES) or (field in {"indications", "moa"} and normalized in taxonomy_labels)


def clean_label_values(value: Any, field: str, taxonomy_labels: set[str]) -> list[str]:
    cleaned = []
    for item in text_list(value):
        item = re.sub(r"\s+", " ", item).strip()
        if len(item) > MAX_LABEL_ITEM_CHARS:
            item = item[:MAX_LABEL_ITEM_CHARS].rsplit(" ", 1)[0].rstrip(";,. ") + "."
        if not invalid_clinical_value(item, field, taxonomy_labels):
            cleaned.append(item)
    return unique_text(cleaned)[:MAX_ITEMS_PER_LABEL_FIELD]


def build_clinical_fields(label_entry: dict[str, Any] | None, taxonomy_labels: set[str]) -> tuple[dict[str, Any], dict[str, list[str]], dict[str, str]]:
    clinical: dict[str, Any] = {"moa": "", "indications": [], "contraindications": [], "adverseEffects": [], "majorInteractions": [], "monitoring": [], "pearls": []}
    provenance = {field: [] for field in CLINICAL_FIELDS}
    status = {field: "missing" for field in CLINICAL_FIELDS}
    if not label_entry:
        return clinical, provenance, status
    for field, cache_key in LABEL_FIELD_MAP.items():
        value = clean_label_values(label_entry.get(cache_key), field, taxonomy_labels)
        value = value[0] if field == "moa" and value else "" if field == "moa" else value
        if value:
            clinical[field], provenance[field], status[field] = value, ["openfda-label-cache"], "verified"
    return clinical, provenance, status


def build_records(taxonomy_entries: list[dict[str, Any]], identity: dict[str, dict[str, Any]], labels: dict[str, dict[str, Any]], blacklist: dict[str, Any], hpo_index: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    paths: dict[str, list[list[str]]] = defaultdict(list)
    taxonomy_names: dict[str, str] = {}
    for entry in taxonomy_entries:
        if entry["classPath"] and entry["classPath"] not in paths[entry["normalizedName"]]:
            paths[entry["normalizedName"]].append(entry["classPath"])
        taxonomy_names.setdefault(entry["normalizedName"], entry["name"])
    records, used_ids = [], Counter()
    hpo_audit = empty_hpo_audit(hpo_index)
    for key in sorted(taxonomy_names):
        metadata = identity.get(key, {})
        name, class_paths = metadata.get("name") or taxonomy_names[key], paths.get(key, [])
        labels_for_drug = {normalize_text(part) for path in class_paths for part in path}
        clinical, clinical_provenance, clinical_status = build_clinical_fields(labels.get(key), labels_for_drug)
        clinical_concepts, hpo_search_synonyms = annotate_hpo_concepts(clinical, hpo_index, hpo_audit, name)
        base_id = f"rxclass-{metadata['rxcui']}" if metadata.get("rxcui", "").isdigit() else f"rxclass-{slugify(name)}"
        used_ids[base_id] += 1
        med_id = base_id if used_ids[base_id] == 1 else f"{base_id}-{used_ids[base_id]}"
        external_candidates = metadata.get("externalClassCandidates", [])
        external_specific = next((label for label in external_candidates if not is_broad_class(label, blacklist)), "")
        fallback_class = external_specific or (external_candidates[0] if external_candidates else "")
        drug_class = max(class_paths, key=len)[-1] if class_paths else fallback_class
        classification_status = "taxonomy-curated" if class_paths else "external-specific" if external_specific else "external-broad" if fallback_class else "unclassified"
        provenance = {"identity": ["legacy-rxclass-dataset"] if metadata else ["filled_classes"], "taxonomy": ["filled_classes"] if class_paths else [], "routes": ["legacy-rxclass-dataset"] if metadata.get("routes") else [], "aliases": ["legacy-rxclass-dataset"] if metadata.get("aliases") else [], "brandExamples": ["legacy-rxclass-dataset"] if metadata.get("brandExamples") else [], **clinical_provenance}
        records.append({"id": med_id, "name": name, "genericName": metadata.get("genericName") or name, "classPaths": class_paths, "drugClass": drug_class, "specificClassLabel": drug_class, "classificationStatus": classification_status, "routes": metadata.get("routes", []), "aliases": metadata.get("aliases", []), "brandExamples": metadata.get("brandExamples", []), "rxnorm": {"rxcui": metadata.get("rxcui", ""), "source": "legacy-rxclass-dataset" if metadata.get("rxcui") else ""}, **clinical, "clinicalConcepts": clinical_concepts, "searchTerms": build_search_terms(name, metadata, class_paths, clinical, hpo_search_synonyms), "classCandidates": [path[-1] for path in class_paths] if class_paths else external_candidates, "classTags": unique_text(part for path in class_paths for part in path) if class_paths else external_candidates, "externalClassCandidates": external_candidates, "provenance": provenance, "clinicalDataStatus": clinical_status, "sourceFlags": ["filled_classes_taxonomy"] if class_paths else ["legacy-rxclass-classification"] if fallback_class else []})
    records.sort(key=lambda record: normalize_text(record["name"]))
    return records, {"taxonomyMedicationReferences": len(taxonomy_entries), "medicationsWithTaxonomyMembership": sum(bool(record["classPaths"]) for record in records), "medicationsWithMultipleTaxonomyMemberships": sum(len(record["classPaths"]) > 1 for record in records), "unclassifiedTaxonomyMedications": sum(not record["classPaths"] for record in records), "legacyIdentityRecordsWithoutTaxonomy": [identity[key]["name"] for key in sorted(set(identity) - set(taxonomy_names))]}, hpo_audit


def validate_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    fallback_hits, empty_array_hits, missing_provenance = [], [], []
    field_counts = {field: 0 for field in CLINICAL_FIELDS}
    for record in records:
        for field in CLINICAL_FIELDS:
            value = record[field]
            values = [value] if field == "moa" and value else ([] if field == "moa" else value)
            if value:
                field_counts[field] += 1
                if not record["provenance"].get(field):
                    missing_provenance.append({"name": record["name"], "field": field})
            for item in values:
                if not clean_text(item):
                    empty_array_hits.append({"name": record["name"], "field": field})
                if invalid_clinical_value(clean_text(item), field, set()):
                    fallback_hits.append({"name": record["name"], "field": field, "value": clean_text(item)})
    return {"clinicalFieldCounts": field_counts, "fallbackClinicalValues": fallback_hits, "emptyClinicalArrayValues": empty_array_hits, "missingProvenance": missing_provenance, "passesValidation": not fallback_hits and not empty_array_hits and not missing_provenance}


def main() -> int:
    blacklist = load_class_blacklist(CLASS_BLACKLIST_PATH)
    taxonomy_entries, taxonomy_audit = load_taxonomy(blacklist)
    identity, identifier_conflicts, external_class_audit = load_legacy_identity_metadata(blacklist)
    hpo_index = load_hpo_index()
    records, counts, hpo_audit = build_records(taxonomy_entries, identity, load_cached_fda_labels(), blacklist, hpo_index)
    validation = validate_records(records)
    known_class_labels = [part for entry in taxonomy_entries for part in entry["classPath"]]
    taxonomy_hard_paths = taxonomy_audit["hardBlacklistedClassPaths"]
    taxonomy_hard_labels = [part for item in taxonomy_hard_paths for part in item["path"] if is_hard_blacklisted_class(part, blacklist)]
    known_class_labels.extend(part for item in taxonomy_hard_paths for part in item["path"])
    known_class_labels.extend(external_class_audit["knownSourceLabels"])
    class_blacklist_audit = {
        "hardBlacklistCount": len(blacklist["hardBlacklist"]),
        "broadBlacklistCount": len(blacklist["broadClassBlacklist"]),
        "hardBlacklistedAssociationsRemoved": len(external_class_audit["hardRemoved"]) + len(taxonomy_hard_labels),
        "broadClassesSuppressedAsSpecificClass": len(external_class_audit["broadSuppressed"]),
        "medicationsWithOnlyBlacklistedExternalClasses": len(unique_text(external_class_audit["onlyBlacklisted"])),
        "topHardBlacklistedLabels": top_labels([*external_class_audit["hardRemoved"], *taxonomy_hard_labels]),
        "topSuppressedBroadLabels": top_labels(external_class_audit["broadSuppressed"]),
        "hardBlacklistMedicationExamples": unique_text([*external_class_audit["affectedHardMedications"], *(item["medication"] for item in taxonomy_hard_paths)])[:20],
        "broadSuppressionMedicationExamples": unique_text(external_class_audit["affectedBroadMedications"])[:20],
        "blacklistVocabularyValidation": blacklist_vocabulary_audit(blacklist, known_class_labels),
    }
    dataset = {"version": 2, "generatedAt": timestamp(), "medications": records}
    report = {"generatedAt": dataset["generatedAt"], "pipeline": ["load taxonomy", "build normalized medication identity list", "filter external class labels", "merge RxNorm/RxClass identity metadata", "merge cached FDA label fields", "annotate verified clinical terminology with HPO", "remove fallback prose", "validate", "write pharm_data_rxclass_enriched.json"], "inputFiles": {"taxonomy": "Filled_classes/*.json", "classBlacklist": str(CLASS_BLACKLIST_PATH.relative_to(PHARM_DIR)), "hpoIndex": str(HPO_INDEX_PATH.relative_to(PHARM_DIR)), "legacyIdentityMetadata": str(LEGACY_DATASET_PATH.relative_to(PHARM_DIR)), "fdaLabelCache": str(OPENFDA_LABEL_CACHE_PATH.relative_to(PHARM_DIR))}, "outputFiles": {"dataset": str(OUTPUT_DATASET_PATH.relative_to(PHARM_DIR)), "report": str(OUTPUT_REPORT_PATH.relative_to(PHARM_DIR))}, "counts": {"totalMedications": len(records), **counts, **validation["clinicalFieldCounts"], "medicationsWithAnyClinicalInformation": sum(any(record[field] for field in CLINICAL_FIELDS) for record in records), "medicationsWithNoClinicalInformation": sum(not any(record[field] for field in CLINICAL_FIELDS) for record in records)}, "taxonomyAudit": taxonomy_audit, "classBlacklistAudit": class_blacklist_audit, "hpoAudit": hpo_audit, "identifierConflicts": identifier_conflicts, "validation": validation}
    write_json(OUTPUT_DATASET_PATH, dataset)
    write_json(OUTPUT_REPORT_PATH, report)
    print(f"Built {OUTPUT_DATASET_PATH.relative_to(PHARM_DIR)}: {len(records)} medications")
    print(f"Verified label fields: {validation['clinicalFieldCounts']}")
    print(f"Wrote {OUTPUT_REPORT_PATH.relative_to(PHARM_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
