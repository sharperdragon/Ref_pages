const { test, expect } = require("@playwright/test");

// ================================================================
// Configurable values (change here)
// ================================================================
const CALCULATORS_PATH = "/pages/calculators.html";
const CALC_LIST_ITEMS = "#calc-list .item";
const CALC_TITLE = "#calc-title";
const RESULT_VALUE = "#result-value";
const RESULT_EXTRA = "#result-extra";

async function openCalculator(page, title) {
  await page.goto(CALCULATORS_PATH);
  await page.locator(CALC_LIST_ITEMS).filter({ hasText: title }).click();
  await expect(page.locator(CALC_TITLE)).toHaveText(title);
}

test.describe("Calculators smoke", () => {
  test("RCRI computes expected class and risk band", async ({ page }) => {
    await openCalculator(page, "Revised Cardiac Risk Index (RCRI)");

    await page.getByLabel("High-risk surgery").check();
    await page.getByLabel("Diabetes treated with insulin").check();
    await page.getByLabel("Pre-op creatinine > 2.0 mg/dL").check();

    await expect(page.locator(RESULT_VALUE)).toHaveText("3 points");
    await expect(page.locator(RESULT_EXTRA)).toContainText("Class IV");
    await expect(page.locator(RESULT_EXTRA)).toContainText("11%");
  });

  test("STOP-Bang computes expected high-risk result", async ({ page }) => {
    await openCalculator(page, "STOP-Bang");

    await page.getByLabel("Snoring").check();
    await page.getByLabel("Tiredness").check();
    await page.getByLabel("Observed apnea").check();
    await page.getByLabel("Pressure").check();
    await page.getByLabel(/Body Mass Index/).fill("37");
    await page.getByLabel(/Age/).fill("67");
    await page.getByLabel(/Neck circumference/).fill("41");
    await page.getByLabel("Sex").selectOption("male");

    await expect(page.locator(RESULT_VALUE)).toHaveText("8 / 8");
    await expect(page.locator(RESULT_EXTRA)).toContainText("High risk for OSA");
  });

  test("Apfel score computes expected PONV estimate", async ({ page }) => {
    await openCalculator(page, "Apfel PONV Score");

    await page.getByLabel("Female sex").check();
    await page.getByLabel("History of PONV or motion sickness").check();
    await page.getByLabel("Nonsmoker").check();

    await expect(page.locator(RESULT_VALUE)).toHaveText("3 / 4");
    await expect(page.locator(RESULT_EXTRA)).toContainText("61%");
    await expect(page.locator(RESULT_EXTRA)).toContainText("High risk");
  });

  test("Child-Pugh computes expected class", async ({ page }) => {
    await openCalculator(page, "Child-Pugh");

    await page.getByLabel(/Total bilirubin/).fill("2.4");
    await page.getByLabel(/Albumin/).fill("3.1");
    await page.getByLabel("INR").fill("1.8");
    await page.getByLabel("Ascites").selectOption("mild");
    await page.getByLabel("Encephalopathy").selectOption("none");

    await expect(page.locator(RESULT_VALUE)).toHaveText("9 points");
    await expect(page.locator(RESULT_EXTRA)).toContainText("Class B");
  });
});
