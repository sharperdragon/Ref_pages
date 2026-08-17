# VS Code Task Runbook

This workspace is set up for one-click runs from VS Code. The task list below is the current source of truth for routine builds, content refreshes, deploy work, and smoke testing.

## Recommended Daily Tasks

1. `Daily Run: Quick Smoke`
2. `Daily Run: Full Rebuild + Smoke`

## Setup, Preview, and Deploy

| Task | Purpose | Typical Result |
|---|---|---|
| `Setup: Environment Check` | Verifies local tools and expected repo files before rebuild or test work. | Pass/fail summary for Python, Node, Playwright, `pdftotext`, and required files. |
| `UI Tests: Install Dependencies` | Installs Node dependencies and Playwright browser support using a workspace-local npm cache. | Dependency install logs and completion message. |
| `UI Tests: Local Static Server` | Serves the repo locally for browser checks without ad hoc terminal commands. | Local static site available at `http://127.0.0.1:4173`. |
| `Deploy: Build Static Bundle` | Builds the `dist/` folder used for static deploys. | Fresh `dist/` output. |
| `Deploy: Preview (Wrangler)` | Runs the Cloudflare preview workflow. | Local Wrangler preview session. |
| `Deploy: Cloudflare Workers` | Deploys the current static bundle through Wrangler. | Cloudflare deployment output. |

## UI Tests

| Task | Purpose | Typical Result |
|---|---|---|
| `UI Tests: Smoke (Headless)` | Runs the full Playwright smoke suite. | Pass/fail summary across homepage, NoteWriter, Differentials, and Pharm. |
| `UI Tests: Smoke (Headed)` | Runs the same suite with a visible browser. | Headed smoke test run for local debugging. |
| `Pharm: Smoke Tests` | Runs the Pharm-only Playwright suite. | Pass/fail Pharm test summary. |
| `Calculators: Smoke Tests` | Runs the dedicated calculator smoke suite, including perioperative risk tools. | Pass/fail calculator test summary. |

## Pharm Tasks

| Task | Purpose | Typical Result |
|---|---|---|
| `Pharm: Import DrugBank TSV` | Matches DrugBank rows onto the local pharm schema. | Writes DrugBank-enriched pharm data and an import report. |
| `Pharm: Expand DrugBank Catalog` | Appends additional DrugBank-derived medications not already curated. | Updates the enriched dataset and writes a catalog report. |
| `Pharm: Build Class Subclasses` | Builds curated subclass taxonomy artifacts for class filtering. | Writes subclass files and the subclass index under `pharm/assests/classes/`. |
| `Pharm: Build RxClass Catalog` | Builds `pharm_data_rxclass_enriched.json` and its report. | Writes dataset and report under `pharm/assests/`. |
| `Pharm: Compile Main Class Hierarchy` | Builds hierarchy index and path artifacts from `MAIN_PHARM_CLASS_HIERARCHY.json`. | Writes files under `pharm/assests/classes/`. |
| `Pharm: Build Main Class Mapping` | Builds runtime medication-to-class mappings from the compiled hierarchy. | Writes mapping output and mapping report in class assets. |
| `Pharm: Audit Clinical Fields` | Audits mechanism, indication, and contraindication coverage in the generated pharm dataset. | Writes `clinical_field_audit_report.json` under `pharm/assests/`. |
| `Pharm: Full Pharm Rebuild` | Runs the standard pharm rebuild sequence used by daily validation. | Full rebuild output from the main pharm build steps. |

## Other Content Tasks

| Task | Purpose | Typical Result |
|---|---|---|
| `Writer: Build Tabs Manifest` | Generates the NoteWriter tabs manifest from templates. | Writes `v1_writer/tabs.json`. |
| `Differentials: Fill Clinical Todo From PDF` | Fills clinical TODO HPI fields from the source PDF when optional source inputs are present. | Updates clinical presentation JSON files. |
| `Differentials: Write Presentation` | Rebuilds individual differential presentation files from source settings. | Writes updated presentation JSON and a summary report. |
| `Differentials: Fix Parenthetical Etiologies` | Repairs malformed parenthetical keys in the clinical presentation index. | Dry-run or rewritten clinical index, depending on script settings. |

## User-Tunable Script Settings

Change values only inside each script's `USER SETTINGS` block.

- [py/setup_check.py](../py/setup_check.py)
- [scripts/run_static_server.py](../scripts/run_static_server.py)
- [scripts/build_static_deploy.js](../scripts/build_static_deploy.js)
- [py/make_tab_manifest.py](../py/make_tab_manifest.py)
- [pharm/scripts/import_drugbank_tsv.py](../pharm/scripts/import_drugbank_tsv.py)
- [pharm/scripts/expand_drugbank_catalog.py](../pharm/scripts/expand_drugbank_catalog.py)
- [pharm/scripts/build_class_subclasses.py](../pharm/scripts/build_class_subclasses.py)
- [pharm/scripts/build_rxclass_medication_catalog.py](../pharm/scripts/build_rxclass_medication_catalog.py)
- [pharm/scripts/audit_clinical_fields.py](../pharm/scripts/audit_clinical_fields.py)
- [pharm/scripts/compile_main_hierarchy.py](../pharm/scripts/compile_main_hierarchy.py)
- [pharm/scripts/build_main_class_mapping.py](../pharm/scripts/build_main_class_mapping.py)
- [differentials/fill_clinical_todo_from_pdf.py](../differentials/fill_clinical_todo_from_pdf.py)
- [differentials/write_presentation.py](../differentials/write_presentation.py)
- [differentials/fix_parenthetical_etiologies.py](../differentials/fix_parenthetical_etiologies.py)

## Notes

- Python tasks publish traceback locations to the Problems panel through task problem matching.
- npm-based tasks now use a workspace-local cache so they do not depend on a healthy global npm cache.
- If `Setup: Environment Check` fails, resolve those items first, then rerun the daily tasks.
