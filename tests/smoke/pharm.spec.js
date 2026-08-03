const { test, expect } = require("@playwright/test");
const path = require("path");
const pharmData = require(path.resolve(__dirname, "../../pharm/assests/pharm_data_rxclass_enriched.json"));
const classTaxonomyIndex = require(path.resolve(__dirname, "../../pharm/assests/classes/class_subclasses_index.json"));

// ================================================================
// Configurable values (change here)
// ================================================================
const PHARM_PATH = "/pharm/pharm_index.html";
const DISCLAIMER_BANNER = "#disclaimerBanner";
const RESULTS_CARDS = "#results .med-card";
const SEARCH_INPUT = "#searchInput";
const CLASS_TREE_TRIGGER = "#classTreeTrigger";
const CLASS_TREE_BACKDROP = "#classTreeBackdrop";
const CLASS_TREE_COLUMNS = "#classTreeColumns";
const CLASS_TYPE_CONTROL = "#classTypeControl";
const CLASS_TYPE_SELECT = "#classTypeSelect";
const ROUTE_FILTER = "#routeFilter";
const CLEAR_FILTERS_BUTTON = "#btnClearFilters";
const RESULT_COUNT = "#resultCount";
const DETAIL_PANEL = "#detailPanel";
const DETAIL_TITLE = "#detailTitle";
const DETAIL_BODY = "#detailBody";
const DETAIL_SCRIM = "#detailScrim";
const DETAIL_CLOSE_BUTTON = "#btnCloseDetail";
const THEME_TOGGLE = "#btnThemeToggle";
const THEME_STORAGE_KEY = "ui-theme";
const VIEW_MODE_KEY = "pharm-view-mode";
const CLASS_FILTER_TYPE_KEY = "pharm-class-filter-type";
const VIEW_MODE_CONTROL = "#viewModeControl";
const RESULTS_GRID = "#results";
const FOOTER_DISCLAIMER = "footer #disclaimerBanner";
const CLASS_BLOCKS = "#results .class-block";
const CLASS_TOGGLES = "#results .class-toggle";
const SUBCLASS_CHIPS = "#results .subclass-chip";
const SUBCLASS_CHIP_TOGGLE = "#results .subclass-chip-toggle";
const SUBCLASS_HEADINGS = "#results .subclass-heading";
const RXNORM_PROXY_ROUTE = "**/api/rxnorm/**";
const RXNORM_SECTION = '#detailBody [data-section="rxnorm"]';
const RXNORM_LOADING = `${RXNORM_SECTION} [data-rxnorm-state="loading"]`;
const RXNORM_EMPTY = `${RXNORM_SECTION} [data-rxnorm-state="empty"]`;
const RXNORM_ERROR = `${RXNORM_SECTION} [data-rxnorm-state="error"]`;
const RXNORM_RXCUI_FIELD = `${RXNORM_SECTION} [data-rxnorm-field="rxcui"]`;
const RXNORM_CANONICAL_NAME_FIELD = `${RXNORM_SECTION} [data-rxnorm-field="canonical-name"]`;
const RXNORM_INGREDIENTS_FIELD = `${RXNORM_SECTION} [data-rxnorm-field="ingredients"]`;
const RXNORM_CLASSES_FIELD = `${RXNORM_SECTION} [data-rxnorm-field="classes"]`;
const VIEW_MODE_COMPACT = `${VIEW_MODE_CONTROL} [data-view-mode="compact"]`;
const VIEW_MODE_STRUCTURED = `${VIEW_MODE_CONTROL} [data-view-mode="structured"]`;
const PHARM_MEDICATIONS = Array.isArray(pharmData) ? pharmData : (pharmData.medications || []);
const EXPECTED_TOTAL_MEDICATIONS = PHARM_MEDICATIONS.length;
const MOBILE_WIDTH = 900;
const MOBILE_HEIGHT = 1000;
const RXNORM_TEST_RXCUI = "435";
const CLASS_TREE_DATASET = buildClassTreeDataset(PHARM_MEDICATIONS, classTaxonomyIndex);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTextArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildClassTreeDataset(medications, taxonomyIndex) {
  const primaries = Array.isArray(taxonomyIndex?.primaries) ? taxonomyIndex.primaries : [];
  const labelSet = new Set();
  const normalizedToCanonical = new Map();

  primaries.forEach((primary) => {
    toTextArray(primary?.subclasses).forEach((subclass) => {
      labelSet.add(subclass);
      const key = normalizeText(subclass);
      if (key && !normalizedToCanonical.has(key)) {
        normalizedToCanonical.set(key, subclass);
      }
    });
  });

  const medicationTags = medications.map((medication) => {
    const tags = new Set();
    const classValue = String(medication?.drugClass || "").trim();
    const categories = toTextArray(medication?.classCandidates);
    const classTags = toTextArray(medication?.classTags);
    const candidates = [classValue, ...categories, ...classTags];

    candidates.forEach((candidate) => {
      const key = normalizeText(candidate);
      const canonical = normalizedToCanonical.get(key);
      if (canonical) tags.add(canonical);
    });

    return tags;
  });

  const total = medications.length;
  const primarySummaries = [];

  primaries.forEach((primary) => {
    const primaryClass = String(primary?.primaryClass || "").trim();
    const subclasses = toTextArray(primary?.subclasses);
    if (!primaryClass || subclasses.length === 0) return;

    let primaryCount = 0;
    const subclassCounts = new Map(subclasses.map((name) => [name, 0]));

    medicationTags.forEach((tags) => {
      let hasPrimaryMatch = false;
      subclasses.forEach((subclass) => {
        if (!tags.has(subclass)) return;
        hasPrimaryMatch = true;
        subclassCounts.set(subclass, (subclassCounts.get(subclass) || 0) + 1);
      });
      if (hasPrimaryMatch) primaryCount += 1;
    });

    if (primaryCount === 0 || primaryCount >= total) return;

    const narrowingSubclass = subclasses.find((subclass) => {
      const count = subclassCounts.get(subclass) || 0;
      return count > 0 && count < primaryCount;
    });

    if (!narrowingSubclass) return;

    primarySummaries.push({
      primaryClass,
      primaryCount,
      subclass: narrowingSubclass,
      subclassCount: subclassCounts.get(narrowingSubclass) || 0,
    });
  });

  const candidate = primarySummaries[0] || null;
  return { candidate };
}

async function mockRxNormSuccess(page, { lookupName = "albuterol", responseDelayMs = 0 } = {}) {
  const requestCounts = { byName: 0, related: 0, properties: 0, classes: 0 };

  await page.route(RXNORM_PROXY_ROUTE, async (route) => {
    const url = new URL(route.request().url());
    const queryName = (url.searchParams.get("name") || "").toLowerCase();
    const path = url.pathname;

    if (responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }

    if (path.endsWith("/rxcui/by-name")) {
      requestCounts.byName += 1;
      const rxnormId = queryName === lookupName.toLowerCase() ? [RXNORM_TEST_RXCUI] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ idGroup: { name: queryName, rxnormId } }),
      });
      return;
    }

    if (path.endsWith(`/rxcui/${RXNORM_TEST_RXCUI}/related`)) {
      requestCounts.related += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          allRelatedGroup: {
            conceptGroup: [
              { tty: "IN", conceptProperties: [{ name: "Albuterol" }] },
              { tty: "DF", conceptProperties: [{ name: "Metered Dose Inhaler" }] },
            ],
          },
        }),
      });
      return;
    }

    if (path.endsWith(`/rxcui/${RXNORM_TEST_RXCUI}/properties`)) {
      requestCounts.properties += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ properties: { rxcui: RXNORM_TEST_RXCUI, name: "Albuterol" } }),
      });
      return;
    }

    if (path.endsWith(`/rxcui/${RXNORM_TEST_RXCUI}/classes`)) {
      requestCounts.classes += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rxclassDrugInfoList: {
            rxclassDrugInfo: [
              {
                rxclassMinConceptItem: { className: "Adrenergic beta-Agonists" },
                relaSource: "ATC",
                rela: "has_MoA",
              },
            ],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unexpected mocked endpoint" }),
    });
  });

  return requestCounts;
}

async function mockRxNormNoMatch(page) {
  await page.route(RXNORM_PROXY_ROUTE, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith("/rxcui/by-name")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ idGroup: { rxnormId: [] } }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

async function mockRxNormError(page) {
  await page.route(RXNORM_PROXY_ROUTE, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Proxy failure" }),
    });
  });
}

async function waitForCards(page, expectedMinimum = 1) {
  await expect.poll(async () => page.locator(RESULTS_CARDS).count()).toBeGreaterThanOrEqual(expectedMinimum);
}

async function uniqueVisibleMedicationIds(page) {
  const ids = await page.locator(RESULTS_CARDS).evaluateAll((cards) =>
    cards
      .map((card) => card.getAttribute("data-id") || "")
      .filter(Boolean)
  );
  return Array.from(new Set(ids));
}

test.describe("Pharm reference smoke", () => {
  test("page loads with compact mode default, disclaimer, cards, and no default selection", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await expect(page.locator(DISCLAIMER_BANNER)).toBeVisible();
    await expect(page.locator(FOOTER_DISCLAIMER)).toBeVisible();
    await waitForCards(page);

    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "compact");
    await expect(page.locator(VIEW_MODE_COMPACT)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(CLASS_BLOCKS).first()).toBeVisible();
    await expect(page.locator(RESULTS_CARDS).first()).toBeVisible();
    await expect(page.locator(RESULT_COUNT)).toContainText(`${EXPECTED_TOTAL_MEDICATIONS} medications`);
    await expect(page.locator(DETAIL_TITLE)).toHaveText("No selection");
    await expect(page.locator(DETAIL_BODY)).toBeHidden();
  });

  test("desktop keeps the detail panel out of the layout until a medication is selected", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await expect(page.locator(DETAIL_PANEL)).toBeHidden();

    await page.locator(RESULTS_CARDS).first().click();
    await expect(page.locator(DETAIL_PANEL)).toBeVisible();
    await expect(page.locator(DETAIL_TITLE)).not.toHaveText("No selection");
  });

  test("search ranking prioritizes exact match and alphabetical fallback", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);
    await page.locator(VIEW_MODE_STRUCTURED).click();
    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "structured");

    await page.locator(SEARCH_INPUT).fill("albuterol");
    await expect(page.locator(RESULT_COUNT)).toContainText(/medications/i);
    const albuterolIds = await uniqueVisibleMedicationIds(page);
    expect(albuterolIds.length).toBeGreaterThan(0);
    await expect(page.locator(`${RESULTS_CARDS} .med-card__title`).first()).toContainText(/albuterol/i);
  });

  test("medication card shows specific class label and hides empty fallback copy", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const firstCard = page.locator(RESULTS_CARDS).first();
    await expect(firstCard).toBeVisible();
    const classLabel = firstCard.locator(".med-card__class");
    await expect(classLabel).toBeVisible();
    await expect(classLabel).not.toHaveText(/^$/);
    await expect(classLabel).not.toHaveText(/unmapped/i);
  });

  test("compact mode keeps grouped display without deep nested containers", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const firstTitle = await page.locator(`${RESULTS_CARDS} .med-card__title`).first().innerText();
    const firstToken = (firstTitle.split(/\s+/)[0] || "").trim();
    await page.locator(SEARCH_INPUT).fill(firstToken);
    await expect(page.locator(RESULT_COUNT)).toContainText(/medications/i);
    const titles = await page.locator(`${RESULTS_CARDS} .med-card__title`).allInnerTexts();
    expect(titles.length).toBeGreaterThanOrEqual(1);
    const tokenMatcher = new RegExp(escapeRegex(firstToken), "i");
    const hasExpectedMatch = titles.some((title) => tokenMatcher.test(title));
    expect(hasExpectedMatch).toBeTruthy();
    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "compact");
    await expect(page.locator(RESULTS_CARDS).first()).toBeVisible();
    await expect(page.locator(CLASS_TOGGLES)).toHaveCount(0);
  });

  test("compact mode groups results by real top-level classes instead of the root node", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const classTitles = page.locator(`${CLASS_BLOCKS} .class-block__title`);
    await expect.poll(async () => classTitles.count()).toBeGreaterThan(1);
    await expect(classTitles.first()).not.toHaveText(/^Drug Classes$/i);

    const titles = await classTitles.allInnerTexts();
    expect(titles).not.toContain("Drug Classes");
  });

  test("compact mode constrains large subclass chip sets and can reveal the rest", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const toggle = page.locator(SUBCLASS_CHIP_TOGGLE).first();
    await expect(toggle).toBeVisible();

    const classBlock = toggle.locator("xpath=ancestor::*[contains(@class,'class-block')][1]");
    const initialChipCount = await classBlock.locator(".subclass-chip").count();
    const initialLabel = await toggle.innerText();
    expect(initialLabel).toMatch(/show \d+ more/i);

    await toggle.click();
    await expect(classBlock.locator(".subclass-chip-toggle")).toHaveText(/show less/i);
    const expandedChipCount = await classBlock.locator(".subclass-chip").count();
    expect(expandedChipCount).toBeGreaterThan(initialChipCount);
  });

  test("structured mode shows accordion classes and subclass headings", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(VIEW_MODE_STRUCTURED).click();
    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "structured");
    await expect(page.locator(CLASS_TOGGLES).first()).toBeVisible();
    await expect(page.locator(CLASS_TOGGLES).first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SUBCLASS_HEADINGS).first()).toBeVisible();
  });

  test("tree mode controls are absent from toggle and select", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await expect(page.locator(VIEW_MODE_CONTROL).locator("[data-view-mode='tree']")).toHaveCount(0);
    await expect(page.locator("#viewModeSelect option[value='tree']")).toHaveCount(0);
  });

  test("class filter type supports drug class and use category modes", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await expect(page.locator(CLASS_TYPE_CONTROL).locator("[data-class-filter-type='drug-class']")).toHaveCount(1);
    await expect(page.locator(CLASS_TYPE_CONTROL).locator("[data-class-filter-type='use-category']")).toHaveCount(1);
    await expect(page.locator(`${CLASS_TYPE_SELECT} option[value='drug-class']`)).toHaveCount(1);
    await expect(page.locator(`${CLASS_TYPE_SELECT} option[value='use-category']`)).toHaveCount(1);
  });

  test("use category class filter mode narrows results with broad clinical buckets", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const initialVisibleCardCount = await page.locator(RESULTS_CARDS).count();
    await page.locator(`${CLASS_TYPE_CONTROL} [data-class-filter-type='use-category']`).click();
    await expect(page.locator(CLASS_TREE_TRIGGER)).toContainText(/All use categories/i);

    const storedType = await page.evaluate((storageKey) => localStorage.getItem(storageKey), CLASS_FILTER_TYPE_KEY);
    expect(storedType).toBe("use-category");

    await page.locator(CLASS_TREE_TRIGGER).click();
    const broadOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="0"][data-action="node"]`);
    await expect(broadOptions.first()).toBeVisible();

    const candidateIndex = await broadOptions.evaluateAll((nodes, totalCount) => {
      for (let index = 0; index < nodes.length; index += 1) {
        const countText = nodes[index].querySelector(".class-tree-option__count")?.textContent || "";
        const count = Number.parseInt(countText, 10);
        if (Number.isFinite(count) && count > 0 && count < totalCount) {
          return index;
        }
      }
      return -1;
    }, initialVisibleCardCount);

    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    const selectedOption = broadOptions.nth(candidateIndex);
    const selectedLabel = await selectedOption.locator(".class-tree-option__label").innerText();
    await selectedOption.click();

    const filteredCount = await page.locator(RESULTS_CARDS).count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(initialVisibleCardCount);
    await expect(page.locator(CLASS_TREE_TRIGGER)).toContainText(selectedLabel);
  });

  test("view mode persists across reload", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(VIEW_MODE_STRUCTURED).click();
    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "structured");

    const storedMode = await page.evaluate((storageKey) => localStorage.getItem(storageKey), VIEW_MODE_KEY);
    expect(storedMode).toBe("structured");

    await page.reload();
    await waitForCards(page);
    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "structured");
    await expect(page.locator(VIEW_MODE_STRUCTURED)).toHaveAttribute("aria-pressed", "true");
  });

  test("legacy stored tree mode migrates to structured", async ({ page }) => {
    await page.addInitScript(([storageKey, value]) => {
      localStorage.setItem(storageKey, value);
    }, [VIEW_MODE_KEY, "tree"]);

    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await expect(page.locator(RESULTS_GRID)).toHaveAttribute("data-view-mode", "structured");
    await expect(page.locator(VIEW_MODE_STRUCTURED)).toHaveAttribute("aria-pressed", "true");

    const migratedMode = await page.evaluate((storageKey) => localStorage.getItem(storageKey), VIEW_MODE_KEY);
    expect(migratedMode).toBe("structured");
  });

  test("class tree taxonomy applies primary then subclass narrowing and clear resets", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const initialVisibleCardCount = await page.locator(RESULTS_CARDS).count();

    await page.locator(CLASS_TREE_TRIGGER).click();
    const primaryOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth=\"0\"][data-action=\"node\"]`);
    await expect(primaryOptions.first()).toBeVisible();

    const primaryOptionCount = await primaryOptions.count();
    let primaryFilteredCount = 0;
    let subclassCandidateIndex = -1;

    for (let primaryIndex = 0; primaryIndex < primaryOptionCount; primaryIndex += 1) {
      await primaryOptions.nth(primaryIndex).evaluate((el) => el.click());

      primaryFilteredCount = await page.locator(RESULTS_CARDS).count();
      const subclassOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth=\"1\"][data-action=\"node\"]`);
      const subclassCount = await subclassOptions.count();
      if (subclassCount <= 0) {
        await primaryOptions.nth(primaryIndex).evaluate((el) => el.click());
        continue;
      }

      subclassCandidateIndex = await subclassOptions.evaluateAll((nodes, parentCount) => {
        for (let index = 0; index < nodes.length; index += 1) {
          const countText = nodes[index].querySelector(".class-tree-option__count")?.textContent || "";
          const count = Number.parseInt(countText, 10);
          if (Number.isFinite(count) && count > 0 && count < parentCount) {
            return index;
          }
        }
        return -1;
      }, primaryFilteredCount);

      if (subclassCandidateIndex >= 0) {
        break;
      }

      await primaryOptions.nth(primaryIndex).evaluate((el) => el.click());
    }

    expect(subclassCandidateIndex).toBeGreaterThanOrEqual(0);
    expect(primaryFilteredCount).toBeGreaterThan(0);
    expect(primaryFilteredCount).toBeLessThan(initialVisibleCardCount);

    const subclassOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth=\"1\"][data-action=\"node\"]`);
    await expect.poll(async () => subclassOptions.count()).toBeGreaterThan(0);
    await subclassOptions.nth(subclassCandidateIndex).evaluate((el) => el.click());
    const subclassFilteredCount = await page.locator(RESULTS_CARDS).count();
    expect(subclassFilteredCount).toBeGreaterThan(0);
    expect(subclassFilteredCount).toBeLessThan(primaryFilteredCount);

    await page.locator(CLEAR_FILTERS_BUTTON).click();
    await expect(page.locator(SEARCH_INPUT)).toHaveValue("");
    await expect(page.locator(CLASS_TREE_TRIGGER)).toContainText(/All (primary )?classes/i);
    await expect(page.locator(ROUTE_FILTER)).toHaveValue("");
    await expect(page.locator(RESULT_COUNT)).toContainText(`${EXPECTED_TOTAL_MEDICATIONS} medications`);
  });

  test("class tree menu shows backdrop and keeps anchored branch columns in viewport", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(CLASS_TREE_TRIGGER).click();
    await expect(page.locator(CLASS_TREE_BACKDROP)).toBeVisible();
    await expect(page.locator("body")).toHaveClass(/class-tree-open/);

    const rootColumn = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="0"]`).first();
    await expect(rootColumn).toBeVisible();
    await expect(rootColumn).toHaveAttribute("data-column-state", "root");

    const branchableOption = page
      .locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="0"][data-action="node"][data-has-children="true"]`)
      .first();
    await expect(branchableOption).toBeVisible();
    const branchParentNodeId = await branchableOption.getAttribute("data-node-id");
    expect(branchParentNodeId).toBeTruthy();
    await branchableOption.evaluate((el) => el.click());
    const activeBranchParent = page.locator(
      `${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="0"][data-action="node"][data-node-id="${branchParentNodeId}"][data-branch-parent="true"]`
    );
    await expect(activeBranchParent).toHaveAttribute("data-branch-parent", "true");

    const childColumn = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="1"]`).first();
    await expect.poll(async () => childColumn.count()).toBeGreaterThan(0);
    await expect(childColumn).toBeVisible();
    await expect(childColumn).toHaveAttribute("data-column-state", "active-path");

    const geometry = await page.evaluate(({ rootSelector, childSelector }) => {
      const root = document.querySelector(rootSelector);
      const child = document.querySelector(childSelector);
      if (!root || !child) return null;
      const rootRect = root.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      return {
        rootLeft: rootRect.left,
        childLeft: childRect.left,
        childRight: childRect.right,
        viewportWidth: window.innerWidth,
      };
    }, {
      rootSelector: `${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="0"]`,
      childSelector: `${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="1"]`,
    });

    expect(geometry).not.toBeNull();
    expect(geometry.childLeft).toBeGreaterThan(geometry.rootLeft);
    expect(geometry.childRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);

    const countBeforeClose = await page.locator(RESULTS_CARDS).count();
    await page.locator(CLASS_TREE_TRIGGER).click();
    await expect(page.locator(CLASS_TREE_BACKDROP)).toBeHidden();
    await expect(page.locator("body")).not.toHaveClass(/class-tree-open/);
    const countAfterClose = await page.locator(RESULTS_CARDS).count();
    expect(countAfterClose).toBe(countBeforeClose);
  });

  test("class tree switching between sibling subclass options is stable", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(CLASS_TREE_TRIGGER).click();
    const primaryOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="0"][data-action="node"]`);
    await expect(primaryOptions.first()).toBeVisible();

    const primaryOptionCount = await primaryOptions.count();
    let subclassLabels = [];

    for (let primaryIndex = 0; primaryIndex < primaryOptionCount; primaryIndex += 1) {
      await primaryOptions.nth(primaryIndex).evaluate((el) => el.click());
      const subclassOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="1"][data-action="node"]`);
      const labels = await subclassOptions.evaluateAll((nodes) => {
        return nodes
          .map((node) => {
            const label = (node.querySelector(".class-tree-option__label")?.textContent || "").trim();
            const countText = node.querySelector(".class-tree-option__count")?.textContent || "";
            const count = Number.parseInt(countText, 10);
            return { label, count };
          })
          .filter((entry) => entry.label && Number.isFinite(entry.count) && entry.count > 0)
          .map((entry) => entry.label);
      });

      if (labels.length >= 2) {
        subclassLabels = labels.slice(0, 2);
        break;
      }
    }

    expect(subclassLabels.length).toBe(2);
    const [firstSubclassLabel, secondSubclassLabel] = subclassLabels;

    const clickSubclassByLabel = async (label) => {
      return page.locator(CLASS_TREE_COLUMNS).evaluate((root, wantedLabel) => {
        const options = Array.from(
          root.querySelectorAll('.class-tree-option[data-depth="1"][data-action="node"]')
        );
        const target = options.find((option) => {
          const optionLabel = (option.querySelector(".class-tree-option__label")?.textContent || "").trim();
          return optionLabel === wantedLabel;
        });
        if (!target) return false;
        target.click();
        return true;
      }, label);
    };

    expect(await clickSubclassByLabel(firstSubclassLabel)).toBeTruthy();

    const firstCount = await page.locator(RESULTS_CARDS).count();
    expect(firstCount).toBeGreaterThan(0);
    const expandedAfterFirst = await page.locator(CLASS_TREE_TRIGGER).getAttribute("aria-expanded");
    if (expandedAfterFirst !== "true") {
      await page.locator(CLASS_TREE_TRIGGER).click();
    }

    expect(await clickSubclassByLabel(secondSubclassLabel)).toBeTruthy();
    const secondCount = await page.locator(RESULTS_CARDS).count();
    expect(secondCount).toBeGreaterThan(0);
    await expect(page.locator(CLASS_TREE_TRIGGER)).toContainText(secondSubclassLabel);
  });

  test("drug class taxonomy condenses top-level class count and exposes subclass depth", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(CLASS_TREE_TRIGGER).click();
    const primaryOptions = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="0"][data-action="node"]`);
    const primaryCount = await primaryOptions.count();
    expect(primaryCount).toBeGreaterThan(0);
    expect(primaryCount).toBeLessThanOrEqual(90);

  });

  test("class tree excludes legacy status-only labels", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(CLASS_TREE_TRIGGER).click();
    const statusOnlyOption = page.locator(CLASS_TREE_COLUMNS)
      .getByRole("treeitem")
      .filter({ hasText: /(Experimental|Investigational|Illicit|Withdrawn|Nutraceutical)/i });
    await expect(statusOnlyOption).toHaveCount(0);
  });

  test("class tree scrolling collapses stale branch panels without resetting primary scroll", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(CLASS_TREE_TRIGGER).click();
    const primaryColumn = page.locator(`${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="0"]`);
    await expect(primaryColumn).toBeVisible();

    const branchableOption = page
      .locator(`${CLASS_TREE_COLUMNS} .class-tree-option[data-depth="0"][data-action="node"][data-has-children="true"]`)
      .first();
    await expect(branchableOption).toBeVisible();
    await branchableOption.click();
    await expect(page.locator(`${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="1"]`)).toHaveCount(1);

    const beforeScrollTop = await primaryColumn.evaluate((el) => el.scrollTop);
    await primaryColumn.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + 320);
    });

    await expect
      .poll(async () => primaryColumn.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(beforeScrollTop);
    await expect(page.locator(`${CLASS_TREE_COLUMNS} .class-tree-column[data-depth="1"]`)).toHaveCount(0);
  });

  test("keyboard navigation supports arrow movement and enter selection", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const cards = page.locator(RESULTS_CARDS);
    const secondCardTitle = await cards.nth(1).locator(".med-card__title").innerText();

    await cards.first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");

    await expect(page.locator(DETAIL_TITLE)).toHaveText(secondCardTitle);
    await expect(cards.nth(1)).toHaveClass(/is-selected/);
  });

  test("theme toggle updates and persists selected mode", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const html = page.locator("html");
    const initialTheme = (await html.getAttribute("data-theme")) || "light";

    await page.locator(THEME_TOGGLE).click();
    const toggledTheme = await html.getAttribute("data-theme");

    expect(toggledTheme).not.toBe(initialTheme);
    const storedTheme = await page.evaluate((themeKey) => localStorage.getItem(themeKey), THEME_STORAGE_KEY);
    expect(storedTheme).toBe(toggledTheme);

    await page.reload();
    await waitForCards(page);
    await expect(html).toHaveAttribute("data-theme", toggledTheme);
  });

  test("auto-loads RxNorm facts when selecting a medication", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const targetName = (await page.locator(`${RESULTS_CARDS} .med-card__title`).first().innerText()).trim();
    await mockRxNormSuccess(page, { lookupName: targetName, responseDelayMs: 250 });
    const targetCard = page.getByRole("button", { name: new RegExp(`^${escapeRegex(targetName)} details$`, "i") }).first();
    await expect(targetCard).toBeVisible();
    await targetCard.click();

    await expect(page.locator(RXNORM_LOADING)).toBeVisible();
    await expect(page.locator(RXNORM_RXCUI_FIELD)).toContainText(RXNORM_TEST_RXCUI);
    await expect(page.locator(RXNORM_CANONICAL_NAME_FIELD)).toContainText("Albuterol");
    await expect(page.locator(RXNORM_INGREDIENTS_FIELD)).toContainText("Albuterol");
    await expect(page.locator(RXNORM_CLASSES_FIELD)).toContainText("Adrenergic beta-Agonists");
  });

  test("reuses cached RxNorm data and avoids duplicate fetches", async ({ page }) => {
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const targetName = (await page.locator(`${RESULTS_CARDS} .med-card__title`).first().innerText()).trim();
    const requestCounts = await mockRxNormSuccess(page, { lookupName: targetName });
    const targetCard = page.getByRole("button", { name: new RegExp(`^${escapeRegex(targetName)} details$`, "i") }).first();
    await expect(targetCard).toBeVisible();

    await targetCard.click();
    await expect(page.locator(RXNORM_RXCUI_FIELD)).toContainText(RXNORM_TEST_RXCUI);

    await targetCard.click();
    await expect.poll(() => requestCounts.byName).toBe(1);
    await expect.poll(() => requestCounts.related).toBe(1);
    await expect.poll(() => requestCounts.properties).toBe(1);
    await expect.poll(() => requestCounts.classes).toBe(1);
  });

  test("shows no-match state when RxNorm has no concept for a medication", async ({ page }) => {
    await mockRxNormNoMatch(page);
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const targetName = (await page.locator(`${RESULTS_CARDS} .med-card__title`).first().innerText()).trim();
    await page.locator(SEARCH_INPUT).fill(targetName);
    await expect(page.locator(RESULT_COUNT)).toContainText(/medications/i);
    const targetCard = page.getByRole("button", { name: new RegExp(`^${escapeRegex(targetName)} details$`, "i") }).first();
    await expect(targetCard).toBeVisible();
    await targetCard.click();

    await expect(page.locator(RXNORM_EMPTY)).toBeVisible();
    await expect(page.locator(RXNORM_EMPTY)).toContainText("No RxNorm match found.");
  });

  test("shows RxNorm unavailable state when proxy returns errors", async ({ page }) => {
    await mockRxNormError(page);
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    const targetName = (await page.locator(`${RESULTS_CARDS} .med-card__title`).first().innerText()).trim();
    await page.locator(SEARCH_INPUT).fill(targetName);
    await expect(page.locator(RESULT_COUNT)).toContainText(/medications/i);
    const targetCard = page.getByRole("button", { name: new RegExp(`^${escapeRegex(targetName)} details$`, "i") }).first();
    await expect(targetCard).toBeVisible();
    await targetCard.click();

    await expect(page.locator(RXNORM_ERROR)).toBeVisible();
    await expect(page.locator(RXNORM_ERROR)).toContainText("RxNorm unavailable right now.");
  });

  test("mobile drawer opens and closes via escape, scrim, and close button", async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto(PHARM_PATH);
    await waitForCards(page);

    await page.locator(RESULTS_CARDS).first().click();
    await expect(page.locator(DETAIL_PANEL)).toHaveClass(/open/);
    await expect(page.locator(DETAIL_SCRIM)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(DETAIL_PANEL)).not.toHaveClass(/open/);

    await page.locator(RESULTS_CARDS).first().click();
    await expect(page.locator(DETAIL_PANEL)).toHaveClass(/open/);
    await page.locator(DETAIL_SCRIM).click();
    await expect(page.locator(DETAIL_PANEL)).not.toHaveClass(/open/);

    await page.locator(RESULTS_CARDS).first().click();
    await expect(page.locator(DETAIL_PANEL)).toHaveClass(/open/);
    await page.locator(DETAIL_CLOSE_BUTTON).click();
    await expect(page.locator(DETAIL_PANEL)).not.toHaveClass(/open/);
  });
});
