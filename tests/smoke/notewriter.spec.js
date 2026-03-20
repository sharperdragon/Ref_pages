const { test, expect } = require("@playwright/test");

// ================================================================
// Configurable values (change here)
// ================================================================
const NOTEWRITER_PATH = "/v1_writer/writer.html";
const SUBJECTIVE_TAB = { role: "button", name: "Subjective" };
const ROS_TAB = { role: "button", name: "ROS" };
const MSE_TAB = { role: "button", name: "MSE" };
const CLEAR_SECTION_BUTTON = "#clearSectionBtn";
const COMPLETE_NOTE_TEXTAREA = "#completeOut";
const COMPLETE_NOTE_VIEW = "#completeOutView";
const SECTION_OUTPUT_TEXTAREA = "#out";
const HPI_ONSET_INPUT = '[data-field-id="hpi_onset"]';
const VISIT_NOTE_INPUT = '[data-field-id="subj_visit_note"]';
const CHIEF_COMPLAINT_INPUT = '[data-field-id="subj_chief_complaint"]';
const FIRST_ROS_CHIP = "#grid .chip";
const FIRST_ROS_CHIP_MINUS = "#grid .chip .aff.minus";
const MSE_COOPERATIVE_CHECKBOX = '#grid .cb:has-text("cooperative")';
const MSE_SUICIDAL_IDEATION_CHIP = '#grid .chip:has-text("suicidal ideation")';
const MSE_THOUGHT_CONTENT_PANEL_HEADER = '#grid .panel-header:has-text("Thought Content & Safety")';
const MSE_COGNITION_PANEL_HEADER = '#grid .panel-header:has-text("Cognition & Orientation")';
const EXPECT_TIMEOUT_MS = 4000;

async function readCompleteNote(page) {
  return page.locator(COMPLETE_NOTE_TEXTAREA).inputValue();
}

test.describe("NoteWriter smoke", () => {
  test("complete note text stays plain text (no HTML tags)", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await page.locator(VISIT_NOTE_INPUT).fill("Follow-up");
    await page.locator(CHIEF_COMPLAINT_INPUT).fill("Headache");
    await page.locator(HPI_ONSET_INPUT).fill("Started yesterday");

    await expect.poll(() => readCompleteNote(page), { timeout: EXPECT_TIMEOUT_MS }).toContain("Subjective:");
    const value = await readCompleteNote(page);
    expect(value).not.toContain("<br>");
  });

  test("subjective heading renders as section header", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await page.locator(HPI_ONSET_INPUT).fill("Started yesterday");

    const subjectiveHeader = page.locator(`${COMPLETE_NOTE_VIEW} .section-head.head-h1`, {
      hasText: "Subjective",
    });
    await expect(subjectiveHeader).toHaveCount(1);
  });

  test("clear section keeps complete note content from other modes", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await page.locator(HPI_ONSET_INPUT).fill("Started yesterday");
    await page.getByRole(ROS_TAB.role, { name: ROS_TAB.name }).click();
    await page.locator(FIRST_ROS_CHIP).first().click({ button: "left" });
    await page.getByRole(SUBJECTIVE_TAB.role, { name: SUBJECTIVE_TAB.name }).click();

    await page.locator(CLEAR_SECTION_BUTTON).click();

    await expect.poll(() => readCompleteNote(page), { timeout: EXPECT_TIMEOUT_MS }).toContain("ROS:");
    await expect.poll(() => readCompleteNote(page), { timeout: EXPECT_TIMEOUT_MS }).not.toContain("Onset:");
  });

  test("minus chip control sets chip to normal state", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await page.getByRole(ROS_TAB.role, { name: ROS_TAB.name }).click();
    await page.locator(FIRST_ROS_CHIP_MINUS).first().click();

    await expect(page.locator(FIRST_ROS_CHIP).first()).toHaveAttribute("data-state", "normal");
  });

  test("MSE tab renders full panels and contributes to section and complete outputs", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await page.getByRole(MSE_TAB.role, { name: MSE_TAB.name }).click();
    await expect(page.locator(MSE_THOUGHT_CONTENT_PANEL_HEADER)).toHaveCount(1);
    await expect(page.locator(MSE_COGNITION_PANEL_HEADER)).toHaveCount(1);

    await page.locator(MSE_COOPERATIVE_CHECKBOX).click();
    await page.locator(MSE_SUICIDAL_IDEATION_CHIP).click({ button: "left" });

    await expect.poll(() => page.locator(SECTION_OUTPUT_TEXTAREA).inputValue(), { timeout: EXPECT_TIMEOUT_MS }).toContain(
      "Appearance & Behavior: Cooperative."
    );
    await expect.poll(() => page.locator(SECTION_OUTPUT_TEXTAREA).inputValue(), { timeout: EXPECT_TIMEOUT_MS }).toContain(
      "Denies suicidal ideation."
    );
    await expect.poll(() => readCompleteNote(page), { timeout: EXPECT_TIMEOUT_MS }).toContain("MSE:");
  });
});
