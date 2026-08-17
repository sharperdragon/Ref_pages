const { test, expect } = require("@playwright/test");

// ================================================================
// Configurable values (change here)
// ================================================================
const NOTEWRITER_PATH = "/v1_writer/writer.html";
const SUBJECTIVE_TAB = { role: "button", name: "Subjective" };
const ROS_TAB = { role: "button", name: "ROS" };
const MSE_TAB = { role: "button", name: "MSE" };
const CLEAR_SECTION_BUTTON = "#clearSectionBtn";
const COPY_SECTION_BUTTON = "#copyBtn";
const COPY_FULL_BUTTON = "#copyFullBtn";
const CLEAR_NOTE_BUTTON = "#clearAllBtn";
const COMPLETE_NOTE_TEXTAREA = "#completeOut";
const COMPLETE_NOTE_VIEW = "#completeOutView";
const SECTION_OUTPUT_TEXTAREA = "#out";
const SECTION_PREVIEW_SCOPE = "#sectionPreviewScope";
const HPI_ONSET_INPUT = '[data-field-id="hpi_onset"]';
const VISIT_NOTE_INPUT = '[data-field-id="subj_visit_note"]';
const CHIEF_COMPLAINT_INPUT = '[data-field-id="subj_chief_complaint"]';
const FIRST_ROS_CHIP = "#grid .chip";
const FIRST_ROS_CHIP_MINUS = "#grid .chip .aff.minus";
const MSE_ANY_CHIP = "#grid .chip";
const MSE_COOPERATIVE_CHECKBOX = '#grid .cb:has-text("cooperative")';
const MSE_SUICIDAL_IDEATION_DENIES_CHECKBOX = '#grid .cb:has-text("denies suicidal ideation")';
const MSE_SUICIDAL_IDEATION_PRESENT_CHECKBOX = '#grid .cb:has-text("suicidal ideation present")';
const MSE_NO_PSYCHOMOTOR_AGITATION_CHECKBOX = '#grid .cb:has-text("no psychomotor agitation")';
const MSE_NORMAL_SPEECH_RATE_CHECKBOX = '#grid .cb:has-text("normal speech rate")';
const MSE_INSIGHT_NOT_IMPAIRED_CHECKBOX = '#grid .cb:has-text("insight not impaired")';
const MSE_AGITATED_CHECKBOX = '#grid .cb:has-text("agitated")';
const MSE_SLOW_SPEECH_CHECKBOX = '#grid .cb:has-text("slow speech")';
const MSE_POOR_INSIGHT_CHECKBOX = '#grid .cb:has-text("poor insight")';
const MSE_POOR_JUDGMENT_CHECKBOX = '#grid .cb:has-text("poor judgment")';
const MSE_DYSPHORIC_MOOD_CHECKBOX = '#grid .cb:has-text("dysphoric mood")';
const MSE_COHERENT_THOUGHT_PROCESS_LABEL = /^coherent thought process$/i;
const MSE_COMMAND_AUDITORY_HALLUCINATIONS_CHECKBOX = '#grid .cb:has-text("command auditory hallucinations")';
const MSE_LOOSE_ASSOCIATIONS_LABEL = /^loose associations$/i;
const MSE_ORIENTED_X3_CHECKBOX = '#grid .cb:has-text("oriented x3")';
const MSE_ORIENTED_PERSON_CHECKBOX = '#grid .cb:has-text("oriented to person")';
const MSE_ORIENTED_PLACE_CHECKBOX = '#grid .cb:has-text("oriented to place")';
const MSE_ORIENTED_TIME_CHECKBOX = '#grid .cb:has-text("oriented to time")';
const MSE_ORIENTED_SITUATION_CHECKBOX = '#grid .cb:has-text("oriented to situation")';
const MSE_PANEL_HEADERS = "#grid .panel-header";
const MSE_THOUGHT_PROCESS_ASSOCIATIONS_PANEL_HEADER = '#grid .panel-header:has-text("Thought Process: Associations")';
const MSE_PERCEPTION_AUDIO_VISUAL_PANEL_HEADER = '#grid .panel-header:has-text("Perception: Auditory & Visual")';
const MSE_IMPULSE_DECISION_PANEL_HEADER = '#grid .panel-header:has-text("Impulse Control, Decision-Making & Engagement")';
const MSE_THOUGHT_PROCESS_ASSOCIATIONS_PANEL = '#grid .panel:has(.panel-header:has-text("Thought Process: Associations"))';
const MSE_ORIENTATION_PANEL = '#grid .panel:has(.panel-header:has-text("Orientation"))';
const MSE_IMPULSE_DECISION_PANEL = '#grid .panel:has(.panel-header:has-text("Impulse Control, Decision-Making & Engagement"))';
const MSE_EXPECTED_PANEL_COUNT = 22;
const EXPECT_TIMEOUT_MS = 4000;
const LEGACY_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const LEGACY_MSE_TEMPLATE_FIXTURE = {
  modes: ["MSE"],
  sectionsByMode: { MSE: ["General"] },
  sectionDefs: {
    "MSE:General": {
      headerItems: [],
      panels: [
        {
          title: "Appearance & Behavior",
          checkboxes: [{ id: "mse_well_groomed", label: "well-groomed" }],
          chips: [
            {
              id: "mse_agitated",
              label: "agitated",
              abnText: "agitated",
              negText: "no psychomotor agitation",
            },
          ],
        },
        {
          title: "Thought Content & Safety",
          checkboxes: [{ id: "mse_tc_reality_based", label: "reality-based thought content" }],
          chips: [
            {
              id: "mse_si",
              label: "suicidal ideation",
              abnText: "suicidal ideation present",
              negText: "denies suicidal ideation",
            },
          ],
        },
      ],
    },
  },
};

async function readCompleteNote(page) {
  return page.locator(COMPLETE_NOTE_TEXTAREA).inputValue();
}

test.describe("NoteWriter smoke", () => {
  test("header exposes distinct note actions and updates section preview scope", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await expect(page.locator(COPY_SECTION_BUTTON)).toHaveText("Copy Section");
    await expect(page.locator(COPY_FULL_BUTTON)).toHaveText("Copy Full Note");
    await expect(page.locator(CLEAR_NOTE_BUTTON)).toHaveText("Clear Note");
    await expect(page.locator(SECTION_PREVIEW_SCOPE)).toContainText("Subjective");

    await page.getByRole(MSE_TAB.role, { name: MSE_TAB.name }).click();
    await expect(page.locator(SECTION_PREVIEW_SCOPE)).toContainText("MSE");
  });

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
    await expect(page.locator(MSE_PANEL_HEADERS)).toHaveCount(MSE_EXPECTED_PANEL_COUNT);
    await expect(page.locator(MSE_THOUGHT_PROCESS_ASSOCIATIONS_PANEL_HEADER)).toHaveCount(1);
    await expect(page.locator(MSE_PERCEPTION_AUDIO_VISUAL_PANEL_HEADER)).toHaveCount(1);
    await expect(page.locator(MSE_IMPULSE_DECISION_PANEL_HEADER)).toHaveCount(1);
    await expect(page.locator(MSE_ANY_CHIP)).toHaveCount(0);
    await expect(page.locator(MSE_NO_PSYCHOMOTOR_AGITATION_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_NORMAL_SPEECH_RATE_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_INSIGHT_NOT_IMPAIRED_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_AGITATED_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_SLOW_SPEECH_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_POOR_INSIGHT_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_POOR_JUDGMENT_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_DYSPHORIC_MOOD_CHECKBOX)).toHaveCount(1);
    await expect(page.locator("#grid .cb").filter({ hasText: MSE_COHERENT_THOUGHT_PROCESS_LABEL })).toHaveCount(1);
    await expect(page.locator(MSE_COMMAND_AUDITORY_HALLUCINATIONS_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_ORIENTED_X3_CHECKBOX)).toHaveCount(1);
    await expect(
      page.locator(MSE_THOUGHT_PROCESS_ASSOCIATIONS_PANEL).locator(".cb").filter({ hasText: MSE_LOOSE_ASSOCIATIONS_LABEL })
    ).toHaveCount(1);
    await expect(page.locator(MSE_ORIENTATION_PANEL).locator('.cb:has-text("oriented x3")')).toHaveCount(1);
    await expect(
      page.locator(MSE_IMPULSE_DECISION_PANEL).locator('.cb:has-text("poor engagement with treatment")')
    ).toHaveCount(1);

    await page.locator(MSE_COOPERATIVE_CHECKBOX).click();
    await page.locator(MSE_SUICIDAL_IDEATION_DENIES_CHECKBOX).click();

    await expect.poll(() => page.locator(SECTION_OUTPUT_TEXTAREA).inputValue(), { timeout: EXPECT_TIMEOUT_MS }).toContain(
      "Interpersonal & Demeanor: Cooperative."
    );
    await expect.poll(() => page.locator(SECTION_OUTPUT_TEXTAREA).inputValue(), { timeout: EXPECT_TIMEOUT_MS }).toContain(
      "Thought Content: Safety & Themes: Denies suicidal ideation."
    );
    await expect.poll(() => readCompleteNote(page), { timeout: EXPECT_TIMEOUT_MS }).toContain("MSE:");
  });

  test("MSE output combines repeated predicates into a single line", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    await page.getByRole(MSE_TAB.role, { name: MSE_TAB.name }).click();
    await page.locator(MSE_ORIENTED_PERSON_CHECKBOX).click();
    await page.locator(MSE_ORIENTED_PLACE_CHECKBOX).click();
    await page.locator(MSE_ORIENTED_TIME_CHECKBOX).click();
    await page.locator(MSE_ORIENTED_SITUATION_CHECKBOX).click();

    await expect.poll(() => page.locator(SECTION_OUTPUT_TEXTAREA).inputValue(), { timeout: EXPECT_TIMEOUT_MS }).toContain(
      "Orientation: Oriented to person, place, time, and situation."
    );
    await expect.poll(() => page.locator(SECTION_OUTPUT_TEXTAREA).inputValue(), { timeout: EXPECT_TIMEOUT_MS }).not.toContain(
      "Oriented to person; Oriented to place; Oriented to time; Oriented to situation."
    );
  });

  test("legacy cached MSE chips are converted into checkbox options", async ({ page }) => {
    await page.goto(NOTEWRITER_PATH);

    const templateKey = await page.evaluate(() => {
      return Object.keys(localStorage).find(k => k.startsWith("ct.templates.")) || null;
    });
    expect(templateKey).toBeTruthy();

    await page.evaluate(({ templateKey, legacyTemplate, ttl }) => {
      const key = String(templateKey || "");
      if (!key) return;
      const raw = localStorage.getItem(key);
      let bucket = {};
      try {
        bucket = raw ? JSON.parse(raw)?.v || {} : {};
      } catch {
        bucket = {};
      }
      bucket.MSE = legacyTemplate;
      localStorage.setItem(key, JSON.stringify({ v: bucket, t: Date.now(), ttl }));
    }, { templateKey, legacyTemplate: LEGACY_MSE_TEMPLATE_FIXTURE, ttl: LEGACY_CACHE_TTL_MS });

    await page.reload();
    await page.getByRole(MSE_TAB.role, { name: MSE_TAB.name }).click();

    await expect(page.locator(MSE_ANY_CHIP)).toHaveCount(0);
    await expect(page.locator("#grid .cb").filter({ hasText: /^agitated$/i })).toHaveCount(1);
    await expect(page.locator(MSE_NO_PSYCHOMOTOR_AGITATION_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_SUICIDAL_IDEATION_DENIES_CHECKBOX)).toHaveCount(1);
    await expect(page.locator(MSE_SUICIDAL_IDEATION_PRESENT_CHECKBOX)).toHaveCount(1);
  });
});
