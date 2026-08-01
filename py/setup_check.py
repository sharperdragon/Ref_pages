#!/usr/bin/env python3
"""Workspace setup check for one-click VS Code task runs.

This script validates required local tools and required repo files used by
the main rebuild and smoke-test tasks.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Sequence


# =======================
# USER SETTINGS (edit)
# =======================
REPO_ROOT = Path(__file__).resolve().parents[1]

# Required file inputs for core rebuild/smoke workflows.
REQUIRED_PATHS: Sequence[Path] = (
    REPO_ROOT / "pharm" / "scripts" / "build_rxclass_medication_catalog.py",
    REPO_ROOT / "pharm" / "scripts" / "compile_main_hierarchy.py",
    REPO_ROOT / "pharm" / "scripts" / "build_main_class_mapping.py",
    REPO_ROOT / "pharm" / "assests" / "rxclass_seed" / "prescribable_epc_in_pool_sandbox.csv",
    REPO_ROOT / "pharm" / "assests" / "rxclass_seed" / "nervous_system_agents_sandbox.csv",
    REPO_ROOT / "pharm" / "assests" / "rxclass_seed" / "prescribable_epc_in_agents_sandbox.csv",
    REPO_ROOT / "tests" / "smoke" / "pharm.spec.js",
    REPO_ROOT / "v1_writer" / "templates" / "template_subjective.json",
    REPO_ROOT / ".vscode" / "tasks.json",
)

# Optional paths used by specialty tasks.
OPTIONAL_PATHS: Sequence[Path] = (
    REPO_ROOT / "differentials" / "data" / "presentations" / "clinical" / "todo",
    REPO_ROOT / "differentials" / "source" / "Pocketbook of Differential Diagnosis (2021).pdf",
)


def run_cmd(args: Iterable[str], cwd: Path | None = None) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            list(args),
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return False, "command not found"

    output = (proc.stdout or proc.stderr or "").strip()
    if proc.returncode != 0:
        return False, output or f"exit {proc.returncode}"
    return True, output


def check_binary(name: str) -> tuple[bool, str]:
    path = shutil.which(name)
    if not path:
        return False, "not found in PATH"
    return True, path


def check_path_exists(path: Path) -> tuple[bool, str]:
    if path.exists():
        kind = "directory" if path.is_dir() else "file"
        return True, kind
    return False, "missing"


def print_header(title: str) -> None:
    print("")
    print(title)
    print("-" * len(title))


def main() -> int:
    failures = 0
    warnings = 0

    print("Workspace setup check")
    print(f"Repository: {REPO_ROOT}")

    print_header("Toolchain")
    ok, detail = run_cmd(["python3", "--version"])
    print(f"[{'PASS' if ok else 'FAIL'}] python3: {detail}")
    failures += int(not ok)

    ok, detail = run_cmd(["node", "--version"])
    print(f"[{'PASS' if ok else 'FAIL'}] node: {detail}")
    failures += int(not ok)

    ok, detail = run_cmd(["npx", "playwright", "--version"], cwd=REPO_ROOT)
    print(f"[{'PASS' if ok else 'FAIL'}] playwright: {detail}")
    failures += int(not ok)

    ok, detail = check_binary("pdftotext")
    print(f"[{'PASS' if ok else 'FAIL'}] pdftotext: {detail}")
    failures += int(not ok)

    print_header("Required Files")
    for path in REQUIRED_PATHS:
        ok, detail = check_path_exists(path)
        print(f"[{'PASS' if ok else 'FAIL'}] {path}: {detail}")
        failures += int(not ok)

    print_header("Optional Files")
    for path in OPTIONAL_PATHS:
        ok, detail = check_path_exists(path)
        state = "PASS" if ok else "WARN"
        print(f"[{state}] {path}: {detail}")
        warnings += int(not ok)

    print_header("Result")
    if failures:
        print(f"FAILED: {failures} required check(s) failed.")
        if warnings:
            print(f"Also found {warnings} optional warning(s).")
        return 1

    print("PASSED: all required checks succeeded.")
    if warnings:
        print(f"Optional warnings: {warnings}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
