# Surgery Calculators Backlog

This backlog is specific to the current `Ref-pages_v3` structure, where calculators live in a single client-side registry inside [pages/calculators.html](../pages/calculators.html) and browser checks run through Playwright smoke specs plus VS Code tasks.

## Current Slice

### Phase 1: Perioperative foundation

- [x] Add checklist-style form support in [pages/calculators.html](../pages/calculators.html) so surgical risk tools do not require awkward numeric stand-ins.
- [x] Wire the existing calculator search input so the growing registry remains usable.
- [x] Add `Revised Cardiac Risk Index (RCRI)`.
- [x] Add `STOP-Bang`.
- [x] Add `Apfel PONV Score`.
- [x] Add `Child-Pugh`.
- [x] Add dedicated smoke coverage in `tests/smoke/`.
- [x] Add a dedicated VS Code task for calculator smoke validation.

### Phase 1 acceptance criteria

- The first four surgery calculators appear in the calculator sidebar without breaking the existing math calculators.
- Each tool updates live and produces both a score and a plain-language risk interpretation.
- Checkbox inputs are keyboard accessible and copy-result behavior still works.
- The search field filters calculator titles/subtitles in real time.
- A focused Playwright smoke test validates one representative scenario for each of the first four calculators.

## Next Slice

### Phase 2: High-yield surgery expansion

- [ ] Add `Caprini VTE Risk Score`.
  Files: `pages/calculators.html`, `tests/smoke/calculators.spec.js`
  Notes: this will lean heavily on checkbox groups and should reuse the boolean field support added in Phase 1.

- [ ] Add `MELD 3.0`.
  Files: `pages/calculators.html`, `tests/smoke/calculators.spec.js`
  Notes: expose the exact lab inputs and keep the notes explicit about cirrhosis-specific surgical risk context.

- [ ] Add `ARISCAT`.
  Files: `pages/calculators.html`, `tests/smoke/calculators.spec.js`
  Notes: requires a mix of numeric inputs and categorical selects; good fit for the existing registry model.

- [ ] Add `mFI-5` frailty score.
  Files: `pages/calculators.html`, `tests/smoke/calculators.spec.js`
  Notes: low implementation cost and high perioperative usefulness.

### Phase 3: External-link risk tools

- [ ] Add a small “External calculators” section or linked cards for `ACS NSQIP Surgical Risk Calculator` and `Gupta/NSQIP MICA` instead of cloning them locally.
  Files: `pages/calculators.html`
  Notes: these are high-value but procedure-driven and not good candidates for a lightweight local reimplementation.

## Repo Follow-Through

- [ ] Update the home/README copy if the calculators page becomes a stronger perioperative planning surface instead of a generic bedside math page.
- [ ] If the calculator registry grows past roughly 12-15 tools, split `CALCS` into a separate data file or module.
- [ ] If more checklist scores are added, introduce optional grouped headings inside the form renderer so longer surgical scores stay scannable.
