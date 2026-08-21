# Ref Pages – Clinical Web Utilities

## Overview

**Ref Pages** is a collection of browser-based utilities for clinicians.
It includes several standalone web apps, each focused on a different workflow, while sharing common UI behavior through `core_app.js` and `core_style.css`.
The site is static-first and built to run locally or deploy as a static bundle.

### Included Apps

| Module | Description | Entry Point |
|:--|:--|:--|
| **NoteWriter** | Structured SOAP note builder with Subjective, ROS, PE, and MSE tabs. | `v1_writer/writer.html` |
| **Differential Explorer** | Symptom-based lookup of causes from the *Pocketbook of Differential Diagnosis*. | `differentials/differentials_index.html` |
| **Clinical Calculators** | Quick bedside calculators, perioperative risk tools, and common clinical conversions. | `pages/calculators.html` |
| **Pharm Reference** | Medication browser with hierarchy groupings, class filters, and RxNorm detail support. | `pharm/pharm_index.html` |

---

## Features

- Persistent theme settings shared across tools through `localStorage("ui-theme")`
- Static browser-first architecture with no application backend
- Shared app shell, settings behavior, and layout helpers
- Scripted pharm data build pipeline and Playwright smoke coverage
- One-click VS Code task workflow for rebuilds, tests, and deployment
- Perioperative calculator coverage for common adult surgery planning questions

---

## File Structure

```text
index.html                        - Home page linking all tools
core_app.js                       - Shared logic (theme, settings, utilities)
v1_writer/                        - NoteWriter app and templates
  writer.html
  js/app.js
  templates/...
differentials/                    - Differential Diagnosis Explorer
  differentials_index.html
  differentials_app.js
  data/presentations/...
pharm/                            - Pharmacology reference app and datasets
pages/calculators.html            - Clinical calculators page
styles.css, core_style.css        - Global styling and layout
assets/                           - Icons, JSON configs, and metadata
scripts/                          - Static deploy and local server helpers
```

---

## Local Workflow

1. Open the workspace in VS Code.
2. Run `Setup: Environment Check`.
3. Run `UI Tests: Install Dependencies` the first time on a machine.
4. Use `Daily Run: Quick Smoke` for routine update validation.
5. Use `Daily Run: Full Rebuild + Smoke` after Pharm data changes.
6. Use `Pre-Deploy: Validate + Preview` before publishing.
7. Use `UI Tests: Local Static Server` when you want to browse the site manually outside the smoke tasks.
8. Select a module from the home page to open it.

The current operational runbook lives in `docs/tasks.md`.

---

## Theme & Settings

- The selected theme is saved to `localStorage` under the key `ui-theme`.
- Default theme is **light** when no preference is set.
- The shared file `core_app.js` automatically applies the theme across all pages.
- To switch manually, use:

```js
setTheme("light");
setTheme("dark");
setTheme("system");
```

---

## Deployment

Deployment is built around the static bundle in `dist/` plus Cloudflare Wrangler.

Recommended path:

1. Run `Pre-Deploy: Validate + Preview`.
2. Run `Deploy: Cloudflare Workers` when ready to publish.

`wrangler.jsonc` points Wrangler at the generated `dist/` directory.

---

## Workflow Notes

- Direct-run scripts are expected to expose a `USER SETTINGS` block near the top.
- Optional differentials source inputs are checked by `py/setup_check.py` but are not required for routine smoke runs.
- The default daily VS Code build task now runs the full Playwright smoke suite across the site.
- Pharm data build steps and content maintenance tasks are intentionally exposed through VS Code tasks so routine work does not depend on terminal commands.

---

## License

© 2026 SharperDragon
For personal and educational use only.
Redistribution or commercial use is strictly prohibited.
