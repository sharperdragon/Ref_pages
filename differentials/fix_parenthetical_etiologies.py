#!/usr/bin/env python3
"""Repair malformed parenthetical etiologies in the clinical index JSON."""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]

# -----------------------------
# USER SETTINGS
# Update these in VS Code.
# -----------------------------
INPUT_PATH = REPO_ROOT / "differentials" / "clinical_presentation_index.json"
OUTPUT_PATH = REPO_ROOT / "differentials" / "clinical_presentation_index.json"
APPLY_CHANGES = False  # Set True to write OUTPUT_PATH, False for dry-run.
JSON_INDENT = 2
SKIP_AMBIGUOUS_KEYS = {
    "• (common in Chinese populations)",
    "Vitamin A deﬁciency (common in underdeveloped countries)",
}
REPORT_PATH_LIMIT = 40


FREQ_KEYS = ("freq", "frequency", "rank")
TOP_LEVEL_SYMPTOM_RE = re.compile(r'^"[^"]+":\s*\{\s*$')
CLOSING_WITH_COMMA_RE = re.compile(r"^\s*}\s*,\s*$")
PAREN_GROUP_RE = re.compile(r"\(([^()]*)\)")


@dataclass
class StructuralSummary:
    inserted_before_top_keys: int = 0
    appended_final_closers: int = 0
    removed_trailing_over_closers: int = 0
    inserted_before_lines: list[int] = field(default_factory=list)


@dataclass
class NormalizeSummary:
    transformed_paths: list[tuple[str, ...]] = field(default_factory=list)
    skipped_paths: list[tuple[str, ...]] = field(default_factory=list)
    collision_paths: list[tuple[str, ...]] = field(default_factory=list)
    resolved_collision_paths: list[tuple[str, ...]] = field(default_factory=list)


def path_text(path: tuple[str, ...]) -> str:
    return " > ".join(path)


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s{2,}", " ", text.strip())


def extract_freq(meta: dict[str, Any]) -> Any:
    for key in FREQ_KEYS:
        value = meta.get(key)
        if value is not None and value != "":
            return value
    return None


def is_freq_leaf(node: Any) -> bool:
    return isinstance(node, dict) and extract_freq(node) is not None


def scan_depth_state(line: str, depth: int, in_string: bool, escaped: bool) -> tuple[int, bool, bool]:
    for ch in line:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
    return depth, in_string, escaped


def structural_prepass(raw_text: str) -> tuple[str, StructuralSummary]:
    summary = StructuralSummary()
    out_lines: list[str] = []

    depth = 0
    in_string = False
    escaped = False

    for line_no, line in enumerate(raw_text.splitlines(), start=1):
        stripped = line.strip()
        if stripped and set(stripped) == {"}"}:
            keep = min(depth, len(stripped))
            removed = len(stripped) - keep
            if removed > 0:
                summary.removed_trailing_over_closers += removed
            if keep == 0:
                continue
            if removed > 0:
                line = "}" * keep

        if TOP_LEVEL_SYMPTOM_RE.match(line):
            while depth > 1:
                if out_lines and CLOSING_WITH_COMMA_RE.match(out_lines[-1]):
                    out_lines.insert(len(out_lines) - 1, "}")
                else:
                    out_lines.append("}")
                depth -= 1
                summary.inserted_before_top_keys += 1
                summary.inserted_before_lines.append(line_no)

        out_lines.append(line)
        depth, in_string, escaped = scan_depth_state(line, depth, in_string, escaped)
        if depth < 0:
            raise ValueError(f"Unexpected extra closing brace/bracket near line {line_no}.")

    while depth > 0:
        out_lines.append("}")
        depth -= 1
        summary.appended_final_closers += 1

    if depth != 0:
        raise ValueError("Failed to rebalance JSON structural depth.")

    repaired = "\n".join(out_lines)
    if raw_text.endswith("\n"):
        repaired += "\n"
    return repaired, summary


def extract_base_and_note(parent_key: str, continuation_key: str | None) -> tuple[str, str | None]:
    key = parent_key.strip()

    if continuation_key:
        open_idx = key.rfind("(")
        continuation_text = continuation_key.strip()
        if continuation_text.endswith(")"):
            continuation_text = continuation_text[:-1].strip()

        if open_idx == -1:
            return normalize_spaces(key), normalize_spaces(continuation_text) or None

        prefix = key[:open_idx].rstrip()
        start_piece = key[open_idx + 1 :].strip()
        note = normalize_spaces(f"{start_piece} {continuation_text}".strip())
        return normalize_spaces(prefix), (note or None)

    groups = list(PAREN_GROUP_RE.finditer(key))
    if not groups:
        return normalize_spaces(key), None

    # Use the last (...) segment as the note; preserve earlier (...) segments in the base.
    note_match = groups[-1]
    note = normalize_spaces(note_match.group(1))
    base = normalize_spaces((key[: note_match.start()] + key[note_match.end() :]).strip())
    return (base or normalize_spaces(key)), (note or None)


def build_completed_parent_key(parent_key: str, continuation_key: str | None) -> str:
    if continuation_key:
        return normalize_spaces(f"{parent_key.strip()} {continuation_key.strip()}".strip())
    return normalize_spaces(parent_key)


def build_collision_key(base_key: str, value: Any) -> str:
    if isinstance(value, dict):
        note = value.get("freq_note")
        if isinstance(note, str) and note.strip():
            return normalize_spaces(f"{base_key} ({note.strip()})")
    return normalize_spaces(f"{base_key} (duplicate)")


def clear_malformed_candidate(path: tuple[str, ...], key: str, value: Any) -> bool:
    # Restrict transforms to etiology-level maps (not top-level symptom->system labels).
    if len(path) < 2:
        return False
    if "(" not in key:
        return False
    if not isinstance(value, dict) or not value:
        return False
    if extract_freq(value) is not None:
        return False

    children = list(value.items())
    if not children:
        return False
    return all(is_freq_leaf(child_meta) for _, child_meta in children)


def flatten_malformed_entry(key: str, value: dict[str, Any]) -> tuple[list[tuple[str, Any]], str]:
    child_items = list(value.items())
    first_freq = None
    for _, child_meta in child_items:
        first_freq = extract_freq(child_meta)
        if first_freq is not None:
            break
    if first_freq is None:
        return [(key, value)], build_completed_parent_key(key, None)

    continuation_key = None
    if key.count("(") > key.count(")") and child_items:
        first_child_key, first_child_meta = child_items[0]
        if is_freq_leaf(first_child_meta) and first_child_key.strip().endswith(")"):
            continuation_key = first_child_key

    base_name, freq_note = extract_base_and_note(key, continuation_key)
    parent_meta: dict[str, Any] = {"freq": first_freq}
    if freq_note:
        parent_meta["freq_note"] = freq_note

    out_entries: list[tuple[str, Any]] = [(base_name, parent_meta)]
    for child_key, child_meta in child_items:
        if continuation_key and child_key == continuation_key:
            continue
        out_entries.append((child_key, child_meta))
    return out_entries, build_completed_parent_key(key, continuation_key)


def insert_or_record(
    target: dict[str, Any],
    key: str,
    value: Any,
    context_path: tuple[str, ...],
    summary: NormalizeSummary,
) -> bool:
    if key in target and target[key] != value:
        summary.collision_paths.append(context_path + (key,))
        alternate_key = build_collision_key(key, value)
        if alternate_key in target:
            if target[alternate_key] == value:
                return True
            return False
        target[alternate_key] = value
        summary.resolved_collision_paths.append(context_path + (alternate_key,))
        return True
    target[key] = value
    return True


def normalize_node(node: Any, path: tuple[str, ...], summary: NormalizeSummary) -> Any:
    if isinstance(node, list):
        return [normalize_node(item, path, summary) for item in node]

    if not isinstance(node, dict):
        return node

    out: dict[str, Any] = {}
    for key, value in node.items():
        if clear_malformed_candidate(path, key, value):
            if key in SKIP_AMBIGUOUS_KEYS:
                summary.skipped_paths.append(path + (key,))
                insert_or_record(out, key, value, path, summary)
                continue

            flattened, fallback_parent_key = flatten_malformed_entry(key, value)
            summary.transformed_paths.append(path + (key,))
            for idx, (new_key, new_value) in enumerate(flattened):
                normalized_value = normalize_node(new_value, path + (new_key,), summary)
                target_key = new_key
                if target_key in out and out[target_key] != normalized_value and idx == 0:
                    target_key = fallback_parent_key
                insert_or_record(out, target_key, normalized_value, path, summary)
            continue

        normalized_value = normalize_node(value, path + (key,), summary)
        insert_or_record(out, key, normalized_value, path, summary)

    return out


def collect_remaining_candidates(node: Any, path: tuple[str, ...] = ()) -> list[tuple[str, ...]]:
    found: list[tuple[str, ...]] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if clear_malformed_candidate(path, key, value):
                found.append(path + (key,))
            found.extend(collect_remaining_candidates(value, path + (key,)))
    elif isinstance(node, list):
        for item in node:
            found.extend(collect_remaining_candidates(item, path))
    return found


def should_apply_from_cli() -> bool:
    if "--dry-run" in sys.argv:
        return False
    if "--apply" in sys.argv:
        return True
    return APPLY_CHANGES


def print_path_sample(label: str, paths: list[tuple[str, ...]]) -> None:
    print(f"{label}: {len(paths)}")
    if not paths:
        return
    for path in paths[:REPORT_PATH_LIMIT]:
        print(f"  - {path_text(path)}")
    extra = len(paths) - REPORT_PATH_LIMIT
    if extra > 0:
        print(f"  ... {extra} more")


def main() -> int:
    apply_changes = should_apply_from_cli()

    raw_text = INPUT_PATH.read_text(encoding="utf-8")
    repaired_text, structural_summary = structural_prepass(raw_text)

    data = json.loads(repaired_text)
    normalize_summary = NormalizeSummary()
    normalized_data = normalize_node(data, (), normalize_summary)

    remaining = collect_remaining_candidates(normalized_data)
    remaining_unskipped = [p for p in remaining if p[-1] not in SKIP_AMBIGUOUS_KEYS]

    output_text = json.dumps(normalized_data, ensure_ascii=False, indent=JSON_INDENT) + "\n"
    changed = output_text != raw_text

    print("=== Structural Pre-pass ===")
    print(f"inserted_before_top_keys: {structural_summary.inserted_before_top_keys}")
    print(f"appended_final_closers:   {structural_summary.appended_final_closers}")
    print(f"removed_over_closers:     {structural_summary.removed_trailing_over_closers}")
    if structural_summary.inserted_before_lines:
        lines = ", ".join(str(n) for n in structural_summary.inserted_before_lines[:REPORT_PATH_LIMIT])
        print(f"inserted_before_lines:    {lines}")

    print("\n=== Normalization Summary ===")
    print_path_sample("transformed_entries", normalize_summary.transformed_paths)
    print_path_sample("skipped_entries", normalize_summary.skipped_paths)
    print_path_sample("collision_entries", normalize_summary.collision_paths)
    print_path_sample("resolved_collision_entries", normalize_summary.resolved_collision_paths)
    print_path_sample("remaining_candidates", remaining)
    print_path_sample("remaining_unskipped", remaining_unskipped)

    print("\n=== File Summary ===")
    print(f"input_path:  {INPUT_PATH}")
    print(f"output_path: {OUTPUT_PATH}")
    print(f"changed:     {changed}")
    print(f"mode:        {'apply' if apply_changes else 'dry-run'}")

    if remaining_unskipped:
        print("\nERROR: unhandled malformed candidates remain.")
        return 1

    if apply_changes:
        OUTPUT_PATH.write_text(output_text, encoding="utf-8")
        print("\nWROTE: updated output file.")
    else:
        print("\nDRY-RUN: no file written.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
