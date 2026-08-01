# VS Code Task Runbook

This workspace is configured for one-click task runs from VS Code.

## Recommended Daily Tasks

1. `Daily Run: Quick Smoke`
2. `Daily Run: Full Rebuild + Smoke`

## Setup and Validation Tasks

| Task | Purpose | Typical Result |
|---|---|---|
| `Setup: Environment Check` | Verifies local tools and required repo files before rebuild/test work. | Pass/fail summary for Python, Node, Playwright, `pdftotext`, and required files. |
| `UI Tests: Install Dependencies` | Installs Node dependencies and Playwright browser support. | Dependency install logs and completion message. |

## Pharm Tasks

| Task | Purpose | Typical Result |
|---|---|---|
| `Pharm: Build RxClass Catalog` | Builds `pharm_data_rxclass_enriched.json` and its report. | Writes dataset and report under `pharm/assests/`. |
| `Pharm: Compile Main Class Hierarchy` | Builds hierarchy index/path artifacts. | Writes files under `pharm/assests/classes/`. |
| `Pharm: Build Main Class Mapping` | Builds runtime class mapping. | Writes mapping output in class assets. |
| `Pharm: Full Pharm Rebuild` | Runs the 3 pharm build tasks in sequence. | Full rebuild output from all pharm build steps. |
| `Pharm: Smoke Tests` | Runs the Pharm Playwright smoke suite. | Pass/fail test summary. |

## Other Content Tasks

| Task | Purpose | Typical Result |
|---|---|---|
| `Writer: Build Tabs Manifest` | Generates NoteWriter tabs manifest from templates. | Writes `v1_writer/tabs.json`. |
| `Differentials: Fill Clinical Todo From PDF` | Fills clinical TODO HPI fields from the source PDF. | Updates JSON files if source inputs are present. |

## User-Tunable Script Settings

Update values only inside each script's `USER SETTINGS` section.

- [setup_check.py](../py/setup_check.py)
- [build_rxclass_medication_catalog.py](../pharm/scripts/build_rxclass_medication_catalog.py)
- [make_tab_manifest.py](../py/make_tab_manifest.py)
- [fill_clinical_todo_from_pdf.py](../differentials/fill_clinical_todo_from_pdf.py)

## Notes

- Python tasks now publish traceback locations to the Problems panel through task problem matching.
- If `Setup: Environment Check` fails, resolve those items first, then run the daily tasks again.
