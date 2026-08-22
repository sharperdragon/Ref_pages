"""Shared exact-match class-label blacklist helpers for Pharm builders."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from difflib import get_close_matches
from pathlib import Path
from typing import Any, Iterable


def normalize_class_label(value: Any) -> str:
    """Normalize presentation noise without changing medically meaningful tokens."""
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    text = text.replace("\u2010", "-").replace("\u2011", "-").replace("\u2012", "-").replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"[,;\s]+$", "", text)
    return re.sub(r"\s+", " ", text).casefold()


def load_class_blacklist(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected an object in {path}")
    result: dict[str, Any] = {"rawLabels": {}}
    for key in ("hardBlacklist", "broadClassBlacklist"):
        values = payload.get(key, [])
        if not isinstance(values, list):
            raise ValueError(f"Expected {key} array in {path}")
        raw_labels = [str(value).strip() for value in values if normalize_class_label(value)]
        result["rawLabels"][key] = raw_labels
        result[key] = {normalize_class_label(value) for value in raw_labels}
    return result


def is_hard_blacklisted_class(label: Any, blacklist: dict[str, Any]) -> bool:
    return normalize_class_label(label) in blacklist["hardBlacklist"]


def is_broad_class(label: Any, blacklist: dict[str, Any]) -> bool:
    return normalize_class_label(label) in blacklist["broadClassBlacklist"]


def filter_class_candidates(labels: Iterable[Any], blacklist: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    """Return valid labels, hard removals, and broad labels in source order."""
    valid: list[str] = []
    hard_removed: list[str] = []
    broad: list[str] = []
    seen: set[str] = set()
    for label in labels:
        cleaned = str(label or "").strip()
        key = normalize_class_label(cleaned)
        if not cleaned or not key or key in seen:
            continue
        seen.add(key)
        if is_hard_blacklisted_class(cleaned, blacklist):
            hard_removed.append(cleaned)
        else:
            valid.append(cleaned)
            if is_broad_class(cleaned, blacklist):
                broad.append(cleaned)
    return valid, hard_removed, broad


def blacklist_vocabulary_audit(raw_blacklist: dict[str, Any], known_labels: Iterable[Any]) -> dict[str, Any]:
    known_by_normalized: dict[str, set[str]] = {}
    for label in known_labels:
        cleaned, key = str(label or "").strip(), normalize_class_label(label)
        if cleaned and key:
            known_by_normalized.setdefault(key, set()).add(cleaned)
    report: dict[str, Any] = {}
    for key in ("hardBlacklist", "broadClassBlacklist"):
        configured_labels = raw_blacklist.get("rawLabels", {}).get(key, [])
        found = sorted(label for label in configured_labels if normalize_class_label(label) in known_by_normalized)
        not_found = sorted(label for label in configured_labels if normalize_class_label(label) not in known_by_normalized)
        spelling_or_case_mismatches = []
        near_duplicates = []
        for label in configured_labels:
            normalized = normalize_class_label(label)
            matching_known = sorted(known_by_normalized.get(normalized, set()))
            if matching_known and label not in matching_known:
                spelling_or_case_mismatches.append({"blacklistLabel": label, "knownLabels": matching_known})
            if not matching_known:
                close = get_close_matches(normalized, known_by_normalized, n=3, cutoff=0.88)
                if close:
                    near_duplicates.append({"blacklistLabel": label, "knownLabels": [sorted(known_by_normalized[item])[0] for item in close]})
        report[key] = {
            "found": found,
            "notFound": not_found,
            "spellingOrCaseMismatches": spelling_or_case_mismatches,
            "nearDuplicateLabels": near_duplicates,
        }
    trailing = sorted({label for labels in known_by_normalized.values() for label in labels if label.rstrip().endswith((",", ";"))})
    near_duplicates = [sorted(labels) for labels in known_by_normalized.values() if len(labels) > 1]
    return {"knownClassVocabularyCount": len(known_by_normalized), "blacklistEntries": report, "knownLabelsWithTrailingPunctuation": trailing, "nearDuplicateKnownLabels": near_duplicates}


def top_labels(values: Iterable[str], limit: int = 20) -> list[dict[str, Any]]:
    labels = [str(value).strip() for value in values if normalize_class_label(value)]
    counts = Counter(normalize_class_label(value) for value in labels)
    display = {normalize_class_label(value): value for value in labels}
    return [{"label": display[label], "count": count} for label, count in counts.most_common(limit)]
