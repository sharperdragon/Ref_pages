(function () {
  // ================================================================
  // Configurable values (change here)
  // ================================================================
  const CONFIG = {
    dataPath: "./assests/pharm_data_rxclass_enriched.json",
    classTaxonomyPath: "./assests/classes/class_subclasses_index.json",
    mainHierarchyIndexPath: "./assests/classes/main_hierarchy_index.json",
    mainHierarchyMappingPath: "./assests/classes/main_class_mapping.json",
    mainHierarchyMappingReportPath: "./assests/classes/main_hierarchy_mapping_report.json",
    mainHierarchySourcePath: "./assests/MAIN_PHARM_CLASS_HIERARCHY.json",
    useMainHierarchyClassSystem: true,
    useMainHierarchyCompatibilityFallback: true,
    warnUnmappedMedicationRatio: 0.25,
    warnTopUnmappedLabelFrequency: 20,
    searchDebounceMs: 170,
    classTreeHoverOpenEnabled: true,
    classTreeHoverCloseDelayMs: 140,
    classTreeHoverResumeDelayMs: 180,
    classTreeColumnAnchorOffsetPx: 6,
    classTreeColumnMinVisibleHeightPx: 180,
    classTreeColumnGapPx: 14,
    classTreeViewportPaddingPx: 12,
    classTreeColumnMinTopPx: 12,
    classTreeColumnMinBottomPx: 12,
    classTreeBranchStartDepth: 1,
    classTreeShowPrimaryCarets: false,
    compactSubclassChipLimit: 10,
    mobileBreakpointPx: 1080,
    emptyStateCopy: "No medications match the current filters.",
    noSelectionTitle: "No selection",
    noSelectionCopy: "Select a medication card to view high-yield details.",
    uncategorizedClassLabel: "Other Classes",
    themeKey: "ui-theme",
    viewModeKey: "pharm-view-mode",
    classFilterTypeKey: "pharm-class-filter-type",
    defaultViewMode: "compact",
    viewModes: ["compact", "structured"],
    defaultClassFilterType: "drug-class",
    classFilterTypes: ["drug-class", "use-category"],
    themeChangedEvent: "core-theme-changed",
    themeToggleLightLabel: "Light mode",
    themeToggleDarkLabel: "Dark mode",
    cardSnippetExcludedIndicationPrefixes: [],
    relevanceWeights: {
      exactName: 100,
      namePrefix: 80,
      aliasBrandPrefix: 60,
      nameContains: 45,
      classContains: 30,
      indicationMoaContains: 20,
      otherFieldsContains: 10,
    },
  };

  const RXNORM_PROXY_BASE_URL = "/api/rxnorm";
  const RXNORM_TIMEOUT_MS = 5500;
  const RXNORM_FETCH_ENABLED = true;
  const RXNORM_ENDPOINTS = {
    rxcuiByName: "/rxcui/by-name",
    relatedByRxcui: "/rxcui/{rxcui}/related",
    propertiesByRxcui: "/rxcui/{rxcui}/properties",
    classesByRxcui: "/rxcui/{rxcui}/classes",
  };
  const RXNORM_QUERY_KEYS = {
    name: "name",
    rxcui: "rxcui",
    tty: "tty",
  };
  const RXNORM_DEFAULT_RELATED_TTYS = "IN+MIN+PIN+DF+DFG";

  const SELECTORS = {
    searchInput: "#searchInput",
    classTreeControl: "#classTreeControl",
    classTreeControlLabel: "#classTreeControlLabel",
    classTypeControl: "#classTypeControl",
    classTypeSelect: "#classTypeSelect",
    classTreeTrigger: "#classTreeTrigger",
    classTreeTriggerText: "#classTreeTriggerText",
    classTreeMenu: "#classTreeMenu",
    classTreeColumns: "#classTreeColumns",
    classTreeBackdrop: "#classTreeBackdrop",
    routeFilter: "#routeFilter",
    clearFiltersButton: "#btnClearFilters",
    resultCount: "#resultCount",
    resultsGrid: "#results",
    layoutShell: ".layout-shell",
    detailPanel: "#detailPanel",
    detailCloseButton: "#btnCloseDetail",
    detailTitle: "#detailTitle",
    detailMeta: "#detailMeta",
    detailEmpty: "#detailEmpty",
    detailBody: "#detailBody",
    detailScrim: "#detailScrim",
    loadError: "#loadError",
    themeToggleButton: "#btnThemeToggle",
    viewModeControl: "#viewModeControl",
    viewModeSelect: "#viewModeSelect",
  };

  const ROUTE_ENUM = ["PO", "IV", "IM", "SQ", "INH", "IN", "SL", "Topical", "PR"];
  const CLASS_FILTER_TYPE = {
    DRUG_CLASS: "drug-class",
    USE_CATEGORY: "use-category",
  };
  const MAX_CLASS_PATH_DEPTH = 4;

  const CLASS_LABEL_ALIAS_RULES = [
    {
      from: "Voltage-Gated Sodium Channel Blockers,",
      to: "Voltage-Gated Sodium Channel Blockers",
    },
  ];

  const CLASS_PARENT_OVERRIDES = [
    // Adrenergic descendants.
    { primaryClass: "Adrenergic Agents", child: "Adrenergic Agonists", parent: "Adrenergic Agents" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic Antagonists", parent: "Adrenergic Agents" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic alpha-Agonists", parent: "Adrenergic Agonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic beta-Agonists", parent: "Adrenergic Agonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic alpha-Antagonists", parent: "Adrenergic Antagonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic beta-Antagonists", parent: "Adrenergic Antagonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic alpha-1 Receptor Agonists", parent: "Adrenergic alpha-Agonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic alpha-2 Receptor Agonists", parent: "Adrenergic alpha-Agonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic beta-1 Receptor Agonists", parent: "Adrenergic beta-Agonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic beta-2 Receptor Agonists", parent: "Adrenergic beta-Agonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic alpha-1 Receptor Antagonists", parent: "Adrenergic alpha-Antagonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic alpha-2 Receptor Antagonists", parent: "Adrenergic alpha-Antagonists" },
    { primaryClass: "Adrenergic Agents", child: "Adrenergic beta-1 Receptor Antagonists", parent: "Adrenergic beta-Antagonists" },

    // Histamine descendants.
    { primaryClass: "Histamine and Allergy Agents", child: "Histamine Antagonists", parent: "Histamine Agents" },
    { primaryClass: "Histamine and Allergy Agents", child: "Histamine H1 Antagonists", parent: "Histamine Antagonists" },
    { primaryClass: "Histamine and Allergy Agents", child: "Histamine H2 Antagonists", parent: "Histamine Antagonists" },
    { primaryClass: "Histamine and Allergy Agents", child: "Histamine H1 Antagonists, Non-Sedating", parent: "Histamine H1 Antagonists" },

    // Anti-infective descendants.
    { primaryClass: "Anti-infective Agents", child: "Aminoglycosides", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Cephalosporins", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Fluoroquinolones", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Macrolides", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Ketolides", parent: "Macrolides" },
    { primaryClass: "Anti-infective Agents", child: "Penicillins", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Quinolones", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Sulfonamides", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Antibiotics, Antitubercular", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Antibiotics, Topical", parent: "Antibiotics" },
    { primaryClass: "Anti-infective Agents", child: "Antibiotics, Antineoplastic", parent: "Antibiotics" },

    // Diuretic descendants.
    { primaryClass: "Renin-Angiotensin and Diuretic Agents", child: "Diuretics, Mercurial", parent: "Diuretics" },
    { primaryClass: "Renin-Angiotensin and Diuretic Agents", child: "Diuretics, Osmotic", parent: "Diuretics" },

    // Contraception descendants.
    { primaryClass: "Reproductive and Contraceptive Agents", child: "Contraceptive Agents, Female", parent: "Contraceptive Agents" },
    { primaryClass: "Reproductive and Contraceptive Agents", child: "Contraceptive Agents, Male", parent: "Contraceptive Agents" },
    { primaryClass: "Reproductive and Contraceptive Agents", child: "Contraceptives, Oral, Combined", parent: "Contraceptive Agents" },
    { primaryClass: "Reproductive and Contraceptive Agents", child: "Contraceptives, Oral, Synthetic", parent: "Contraceptive Agents" },
    { primaryClass: "Reproductive and Contraceptive Agents", child: "Contraceptives, Postcoital, Synthetic", parent: "Contraceptive Agents" },
  ];

  const SPECIFIC_CLASS_OVERRIDES_BY_DRUG = {
    "acetyldigitoxin": "Cardiac glycoside",
    "ajmaline": "Class 1A antiarrhythmic",
    "alprenolol": "Non-selective beta blocker",
    "amiodarone": "Class III antiarrhythmic",
    "aprindine": "Class 1B antiarrhythmic",
    "arbutamine": "Non-selective beta-adrenergic agonist",
    "atorvastatin": "HMG-CoA reductase inhibitor",
    "azilsartan medoxomil": "Angiotensin II receptor blocker (ARB)",
    "benazepril": "ACE inhibitor",
    "bosentan": "Endothelin receptor antagonist (ERA)",
    "bretylium": "Class III antiarrhythmic",
  };

  const MECHANISM_CLASS_RULES = [
    {
      label: "ENaC Channel Blockers",
      match: /\bepithelial sodium channel blockers?\b|\benac\b|\brenal epithelial cells?\b.{0,48}\bsodium channels?\b|\bsodium channels?\b.{0,48}\brenal epithelial cells?\b/i,
    },
    { label: "Endothelin receptor antagonist (ERA)", match: /\bendothelin(?: |-)?receptor antagonists?\b/i },
    { label: "ACE inhibitor", match: /\bace inhibitors?\b|\bangiotensin(?: |-)?converting enzyme inhibitors?\b/i },
    {
      label: "Angiotensin II receptor blocker (ARB)",
      match: /\bangiotensin(?: |-)?ii(?: |-)?receptor antagonists?\b|\bangiotensin(?: |-)?receptor blockers?\b|\barb(?:s)?\b/i,
    },
    { label: "HMG-CoA reductase inhibitor", match: /\bhmg(?: |-)?coa(?: |-)?reductase inhibitors?\b|\bstatins?\b/i },
    { label: "Class III antiarrhythmic", match: /\bclass(?: |-)?iii\b.{0,32}\bantiarrhyth/i },
    { label: "Class 1A antiarrhythmic", match: /\bclass(?: |-)?1a\b.{0,32}\bantiarrhyth/i },
    { label: "Class 1B antiarrhythmic", match: /\bclass(?: |-)?1b\b.{0,32}\bantiarrhyth/i },
    { label: "Class 1C antiarrhythmic", match: /\bclass(?: |-)?1c\b.{0,32}\bantiarrhyth/i },
    { label: "Non-selective beta blocker", match: /\bnon[- ]selective beta[- ]?(?:blockers?|antagonists?)\b/i },
    { label: "Cardiac glycoside", match: /\bcardiac glycosides?\b|\bdigitalis\b|\bdigitoxin\b/i },
  ];

  const ATC_LEVEL5_CLASS_MAP = {
    C01AA01: "Cardiac glycoside",
    C01BA05: "Class 1A antiarrhythmic",
    C01BB04: "Class 1B antiarrhythmic",
    C01BD01: "Class III antiarrhythmic",
    C01BD02: "Class III antiarrhythmic",
    C01CA22: "Non-selective beta-adrenergic agonist",
    C02KX01: "Endothelin receptor antagonist (ERA)",
    C07AA01: "Non-selective beta blocker",
    C09AA07: "ACE inhibitor",
    C09CA09: "Angiotensin II receptor blocker (ARB)",
    C10AA05: "HMG-CoA reductase inhibitor",
  };

  const ATC_LEVEL4_CLASS_MAP = {
    C01AA: "Cardiac glycoside",
    C01BA: "Class 1A antiarrhythmic",
    C01BB: "Class 1B antiarrhythmic",
    C01BD: "Class III antiarrhythmic",
    C01CA: "Adrenergic and dopaminergic agent",
    C02KX: "Pulmonary arterial hypertension antihypertensive",
    C07AA: "Non-selective beta blocker",
    C09AA: "ACE inhibitor",
    C09CA: "Angiotensin II receptor blocker (ARB)",
    C10AA: "HMG-CoA reductase inhibitor",
  };

  const BROAD_CLASS_BLOCKLIST = [
    "Cardiovascular",
    "ATC C - Cardiovascular system",
    "Enzyme Inhibitors",
    "Anti-Arrhythmia Agents",
    "Antihypertensive Agents",
    "Vasodilator Agents",
    "Sympatholytics",
    "Adrenergic Antagonists",
    "Unclassified",
    "Other Classes",
  ];

  const SPECIFIC_CLASS_PRIORITY = ["mechanism", "atc5", "atc4", "category", "legacy"];
  const BROAD_CLASS_BLOCKLIST_SET = new Set(BROAD_CLASS_BLOCKLIST.map((label) => normalizeSearch(label)));
  const ADRENERGIC_RECEPTOR_SUBTYPE_PATTERN = "[a-z0-9+-]+(?:\\s+and\\s+[a-z0-9+-]+)?";
  const ADRENERGIC_RECEPTOR_ORDER_RULES = [
    {
      pattern: new RegExp(
        `\\b(${ADRENERGIC_RECEPTOR_SUBTYPE_PATTERN})\\s*-\\s*adrenergic\\s+(receptors?)\\b`,
        "gi"
      ),
      replacement: "$1 $2 Adrenergic",
    },
    {
      pattern: new RegExp(
        `\\b(${ADRENERGIC_RECEPTOR_SUBTYPE_PATTERN})\\s+adrenergic\\s+(receptors?)\\b`,
        "gi"
      ),
      replacement: "$1 $2 Adrenergic",
    },
    {
      pattern: new RegExp(
        `\\badrenergic\\s+(${ADRENERGIC_RECEPTOR_SUBTYPE_PATTERN})\\s+(receptors?)\\b`,
        "gi"
      ),
      replacement: "$1 $2 Adrenergic",
    },
    {
      pattern: /\badrenergic\s+(receptors?)\b/gi,
      replacement: "$1 Adrenergic",
    },
  ];

  const USE_CATEGORY_RULES = [
    {
      label: "Psychiatric",
      match: /(psychiatr|antipsychotic|antidepressive|anti-anxiety|anxiolytic|mood|bipolar|schizo|adhd|ssri|snri|benzodiazepine|hypnotic|sedative)/i,
    },
    {
      label: "Pain and Analgesics",
      match: /(analges|pain|opioid|nsaid|anti-inflammatory|antipyretic|migraine|anesthetics?)/i,
    },
    {
      label: "Gout and Rheumatology",
      match: /(gout|uricosuric|antirheumatic|hyperuricemic|antiresorptive)/i,
    },
    {
      label: "Hypertension",
      match: /(hypertension|antihypertensive|ace inhibitor|angiotensin|arb|beta-block|calcium channel blocker|diuretic|vasodilator)/i,
    },
    {
      label: "Hyperlipidemia",
      match: /(hyperlipidem|hypolipidemic|anticholesteremic|statin|hmg-coa|lipid|cholesterol)/i,
    },
    {
      label: "Cardiovascular",
      match: /(cardiovascular|anti-arrhythmia|antianginal|heart failure|anticoagulant|antithrombin|platelet aggregation|thrombolytic|cardiotonic)/i,
    },
    {
      label: "Diabetes and Endocrine",
      match: /(diabet|hypoglycemic|insulin|thyroid|glucocorticoid|corticosteroid|hormone|endocrine)/i,
    },
    {
      label: "Women's Health",
      match: /(women|menopaus|estrogen|progesterone|progestin|endometri|labor induction|tocolytic|uterine)/i,
    },
    {
      label: "Family Planning",
      match: /(contracept|fertility|postcoital|family planning|gonadotropin)/i,
    },
    {
      label: "Infectious Disease",
      match: /(anti-bacterial|antibiotic|antifungal|antiviral|anti-infective|antimalarial|antitubercular|antiprotozoal|antiparasitic|hiv|cephalosporin|penicillin|macrolide|quinolone|sulfonamide)/i,
    },
    {
      label: "Oncology and Hematology",
      match: /(antineoplastic|oncolog|anticarcinogenic|antimetabolite|alkylating|antineutropenic|hematologic|hematopoietic|colony-stimulating|myeloablative)/i,
    },
    {
      label: "Respiratory",
      match: /(respiratory|bronchodilator|anti-asthmatic|antitussive|leukotriene|pulmonary|nasal decongestant)/i,
    },
    {
      label: "Gastrointestinal",
      match: /(gastrointestinal|antiemetic|antidiarrheal|anti-ulcer|antacid|proton pump|laxative|prokinetic|bowel)/i,
    },
    {
      label: "Neurology",
      match: /(neurolog|anticonvulsant|antiparkinson|dyskinesia|neuromuscular|dopamine|serotonin|gaba|nootropic)/i,
    },
    {
      label: "Dermatology",
      match: /(dermatolog|anti-acne|antipruritic|antipsoriatic|anti-seborrheic|sunscreen|keratolytic|skin and mucous membrane)/i,
    },
    {
      label: "Ophthalmology and ENT",
      match: /(ophthalmic|anti-glaucoma|mydriatic|miotic|eent)/i,
    },
    {
      label: "Renal and Urology",
      match: /(renal|urolog|incontinence|urinary|dialysis|electrolyte)/i,
    },
    {
      label: "Allergy and Immunology",
      match: /(anti-allergic|immunologic|immunosuppressive|histamine|mast cell|tnf inhibitor|adjuvants?)/i,
    },
  ];
  const RXNORM_STATUS = {
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    EMPTY: "empty",
    ERROR: "error",
  };

  const CLASS_HIERARCHY_RULES = [
    {
      label: "Antibiotics",
      match:
        /(antibiotic|penicillin|cephalosporin|glycopeptide|macrolide|beta-lactam|tetracycline|anti-?staph|carbapenem|lincosamide|oxazolidinone|sulfonamide)/i,
      children: [
        {
          label: "Beta-lactams",
          match: /(beta-lactam|penicillin|cephalosporin|carbapenem)/i,
          children: [
            { label: "Penicillins", match: /(penicillin|aminopenicillin)/i },
            { label: "Cephalosporins", match: /cephalosporin/i },
            {
              label: "Beta-lactamase Inhibitor Combinations",
              match: /beta-lactamase inhibitor|beta-lactam\s*\+\s*inhibitor/i,
            },
            { label: "Carbapenems", match: /carbapenem/i },
          ],
        },
        { label: "Macrolides", match: /macrolide/i },
        {
          label: "Anti-Staph Penicillins",
          match: /anti-?staph(?:ylococcal)?\s*penicillin|nafcillin|oxacillin|cloxacillin|dicloxacillin|flucloxacillin/i,
        },
        { label: "Tetracyclines", match: /tetracycline/i },
        { label: "Glycopeptides", match: /(glycopeptide|vancomycin)/i },
        { label: "Lincosamides", match: /lincosamide/i },
        { label: "Oxazolidinones", match: /oxazolidinone/i },
        { label: "Sulfonamides", match: /sulfonamide|trimethoprim|tmp-?smx/i },
      ],
    },
    {
      label: "Antithrombotics",
      match: /(anticoagulant|antiplatelet|factor xa|heparin)/i,
      children: [
        { label: "Heparins", match: /(heparin|lmwh)/i },
        { label: "Direct Oral Anticoagulants", match: /(factor xa|apixaban|rivaroxaban)/i },
        { label: "Antiplatelets", match: /antiplatelet/i },
      ],
    },
    {
      label: "Cardiovascular",
      match: /(ace inhibitor|beta blocker|calcium channel|diuretic|statin)/i,
      children: [
        { label: "ACE Inhibitors", match: /ace inhibitor/i },
        { label: "Beta Blockers", match: /beta blocker/i },
        { label: "Calcium Channel Blockers", match: /calcium channel/i },
        { label: "Diuretics", match: /diuretic/i },
        { label: "Lipid Management", match: /statin|hmg-coa/i },
      ],
    },
    {
      label: "Endocrine and Metabolic",
      match: /(insulin|biguanide|thyroid hormone|thyroid)/i,
      children: [
        { label: "Diabetes Agents", match: /(insulin|biguanide|metformin)/i },
        { label: "Thyroid Replacement", match: /thyroid/i },
      ],
    },
    {
      label: "Respiratory",
      match: /(beta-2 agonist|bronchodilator|anticholinergic|glucocorticoid)/i,
      children: [
        { label: "Rescue Bronchodilators", match: /(beta-2 agonist|saba|albuterol)/i },
        { label: "Combination Bronchodilators", match: /(anticholinergic.*combination|ipratropium)/i },
        { label: "Systemic Steroids", match: /glucocorticoid|prednisone/i },
      ],
    },
    {
      label: "Gastrointestinal",
      match: /(proton pump|5-ht3|laxative|stool softener|antiemetic)/i,
      children: [
        { label: "Acid Suppression", match: /proton pump/i },
        { label: "Antiemetics", match: /5-ht3|antiemetic|ondansetron/i },
        { label: "Bowel Regimen", match: /laxative|stool softener|senna/i },
      ],
    },
    {
      label: "Psychiatric and Neurologic",
      match: /(ssri|benzodiazepine|antipsychotic)/i,
      children: [
        { label: "SSRIs", match: /ssri/ },
        { label: "Benzodiazepines", match: /benzodiazepine/ },
        { label: "Antipsychotics", match: /antipsychotic/ },
      ],
    },
    {
      label: "Emergency and Toxicology",
      match: /(opioid antagonist|adrenergic agonist|epinephrine|naloxone)/i,
      children: [
        { label: "Resuscitation Agents", match: /(adrenergic agonist|epinephrine)/i },
        { label: "Overdose Reversal", match: /(opioid antagonist|naloxone)/i },
      ],
    },
    {
      label: "Pain and Inflammation",
      match: /(nsaid|analgesic|antipyretic)/i,
      children: [
        { label: "NSAIDs", match: /nsaid/ },
        { label: "Analgesics and Antipyretics", match: /analgesic|antipyretic/ },
      ],
    },
  ];

  const CLASS_LABEL_ALIAS_MAP = new Map(
    CLASS_LABEL_ALIAS_RULES.map((entry) => [
      normalizeSearch(entry?.from),
      cleanText(entry?.to),
    ]).filter(([from, to]) => from && to)
  );

  const CLASS_PARENT_OVERRIDE_MAP = new Map(
    CLASS_PARENT_OVERRIDES.map((entry) => {
      const primaryKey = normalizeClassLabelForLookup(entry?.primaryClass || "*");
      const childKey = normalizeClassLabelForLookup(entry?.child);
      const parentLabel = sanitizeClassLabel(entry?.parent);
      const key = `${primaryKey}|${childKey}`;
      return [key, parentLabel];
    }).filter(([key, parentLabel]) => key && parentLabel)
  );

  const REQUIRED_FIELDS = [
    "id",
    "name",
    "drugClass",
    "routes",
    "moa",
    "indications",
  ];

  // ================================================================
  // App state
  // ================================================================
  const STATE = {
    medications: [],
    filtered: [],
    groupingIndex: null,
    selectedId: null,
    query: "",
    classFilterNodeId: "",
    classFilterLabel: "All classes",
    classFilterClassSet: null,
    classFilterType: CONFIG.defaultClassFilterType,
    classTreeRoot: null,
    classTreeById: new Map(),
    classTreePath: [],
    classTreeMenuOpen: false,
    classTreeOpenedByHover: false,
    classTreeHoverGuardUntilMs: 0,
    classTreeScrollSyncGuardByColumnKey: new Map(),
    classTaxonomy: null,
    mainHierarchyIndex: null,
    mainHierarchyMappingByMedicationId: new Map(),
    mainHierarchyMappingReport: null,
    mainHierarchyEnabled: false,
    routeFilter: "",
    viewMode: CONFIG.defaultViewMode,
    expandedClassId: null,
    selectedSubclassByClass: {},
    expandedSubclassChipsByClass: {},
    theme: "light",
    rxnormByMedicationId: {},
  };
  const RXNORM_IN_FLIGHT = new Map();
  let classTreeCloseTimer = null;

  const EL = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    setClassTreeMenuVisualState(false);
    syncThemeFromStorage();
    syncViewModeFromStorage();
    syncClassFilterTypeFromStorage();
    syncViewModeControls();
    syncClassFilterTypeControls();
    bindEvents();
    loadData();
  }

  function cacheElements() {
    Object.entries(SELECTORS).forEach(([key, selector]) => {
      EL[key] = document.querySelector(selector);
    });
  }

  function setClassTreeMenuVisualState(isOpen) {
    const open = Boolean(isOpen);
    document.body.classList.toggle("class-tree-open", open);
    if (EL.classTreeBackdrop) {
      EL.classTreeBackdrop.hidden = !open;
      EL.classTreeBackdrop.setAttribute("aria-hidden", String(!open));
    }
  }

  function bindEvents() {
    if (EL.searchInput) {
      EL.searchInput.addEventListener(
        "input",
        debounce(() => {
          STATE.query = EL.searchInput.value.trim();
          applyFiltersAndRender();
        }, CONFIG.searchDebounceMs)
      );
    }

    if (EL.classTreeTrigger) {
      EL.classTreeTrigger.addEventListener("click", () => {
        if (STATE.classTreeMenuOpen) {
          if (STATE.classTreeOpenedByHover) {
            openClassTreeMenu({ source: "click" });
          } else {
            closeClassTreeMenu();
          }
        } else {
          openClassTreeMenu({ source: "click" });
        }
      });
    }

    if (EL.classTreeControl) {
      EL.classTreeControl.addEventListener("mouseenter", () => {
        if (!CONFIG.classTreeHoverOpenEnabled || !hasHoverPointer()) return;
        cancelClassTreeClose();
        openClassTreeMenu({ source: "hover" });
      });

      EL.classTreeControl.addEventListener("mouseleave", () => {
        if (!CONFIG.classTreeHoverOpenEnabled || !hasHoverPointer()) return;
        if (!STATE.classTreeOpenedByHover) return;
        scheduleClassTreeClose();
      });
    }

    if (EL.classTreeColumns) {
      EL.classTreeColumns.addEventListener("scroll", (event) => {
        if (!CONFIG.classTreeHoverOpenEnabled || !hasHoverPointer()) return;
        const column = event.target.closest(".class-tree-column");
        if (!column) return;
        const columnKey = getClassTreeColumnKey(
          column.dataset.depth,
          column.dataset.parentId
        );
        if (columnKey) {
          const guard = STATE.classTreeScrollSyncGuardByColumnKey.get(columnKey);
          if (guard) {
            const guardExpired = Date.now() > guard.expiresAt;
            const isProgrammaticRestore = Math.abs(column.scrollTop - guard.scrollTop) <= 1;
            const shouldIgnoreEvent = (
              !guardExpired
              && isProgrammaticRestore
              && Boolean(STATE.classFilterNodeId)
            );
            if (!shouldIgnoreEvent) {
              STATE.classTreeScrollSyncGuardByColumnKey.delete(columnKey);
            }
            if (shouldIgnoreEvent) return;
          }
        }
        STATE.classTreeHoverGuardUntilMs = Date.now() + CONFIG.classTreeHoverResumeDelayMs;

        const depth = Number(column.dataset.depth);
        const safeDepth = Number.isFinite(depth) && depth >= 0 ? depth : 0;
        const truncatedPath = STATE.classTreePath.slice(0, safeDepth);
        if (truncatedPath.length === STATE.classTreePath.length) return;
        STATE.classTreePath = truncatedPath;
        renderClassTreeColumns();
      }, { capture: true, passive: true });

      EL.classTreeColumns.addEventListener("mouseover", (event) => {
        if (!CONFIG.classTreeHoverOpenEnabled || !hasHoverPointer()) return;
        if (Date.now() < STATE.classTreeHoverGuardUntilMs) return;
        const option = event.target.closest(".class-tree-option");
        if (!option) return;
        const action = cleanText(option.dataset.action);
        if (action !== "node") return;

        const nodeId = cleanText(option.dataset.nodeId);
        const depth = Number(option.dataset.depth);
        const safeDepth = Number.isFinite(depth) && depth >= 0 ? depth : 0;
        if (!nodeId || !STATE.classTreeById.has(nodeId)) return;

        const node = STATE.classTreeById.get(nodeId);
        if (!Array.isArray(node.children) || node.children.length === 0) return;

        const nextPath = STATE.classTreePath.slice(0, safeDepth);
        nextPath[safeDepth] = nodeId;
        if (nextPath.join("|") === STATE.classTreePath.join("|")) return;

        STATE.classTreePath = nextPath;
        renderClassTreeColumns();
      });

      EL.classTreeColumns.addEventListener("click", (event) => {
        const option = event.target.closest(".class-tree-option");
        if (!option) return;
        event.stopPropagation();
        cancelClassTreeClose();
        STATE.classTreeHoverGuardUntilMs = Date.now() + CONFIG.classTreeHoverResumeDelayMs;

        const action = cleanText(option.dataset.action);
        const nodeId = cleanText(option.dataset.nodeId);
        const depth = Number(option.dataset.depth);
        const safeDepth = Number.isFinite(depth) && depth >= 0 ? depth : 0;

        if (action === "all") {
          resetClassFilter({ rerender: false });
          STATE.classTreePath = [];
          applyFiltersAndRender();
          closeClassTreeMenu();
          return;
        }

        if (!nodeId || !STATE.classTreeById.has(nodeId)) return;

        const node = STATE.classTreeById.get(nodeId);
        const currentNodeIdAtDepth = cleanText(STATE.classTreePath[safeDepth]);
        const isSameNodeAtDepth = currentNodeIdAtDepth === nodeId;
        const isPathEndingAtDepth = STATE.classTreePath.length === safeDepth + 1;
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;

        if (isSameNodeAtDepth && isPathEndingAtDepth) {
          STATE.classTreePath = STATE.classTreePath.slice(0, safeDepth);
          const parentId = cleanText(node.parentId);
          if (parentId && parentId !== "class-tree-root" && STATE.classTreeById.has(parentId)) {
            applyClassFilterNode(STATE.classTreeById.get(parentId), { rerender: false });
          } else {
            resetClassFilter({ rerender: false });
          }
          renderClassTreeColumns();
          applyFiltersAndRender();
          return;
        }

        STATE.classTreePath = STATE.classTreePath.slice(0, safeDepth);
        STATE.classTreePath[safeDepth] = nodeId;

        applyClassFilterNode(node, { rerender: false });
        renderClassTreeColumns();
        applyFiltersAndRender();

        if (!hasChildren) {
          closeClassTreeMenu();
        }
      });
    }

    if (EL.classTypeControl) {
      EL.classTypeControl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-class-filter-type]");
        if (!button) return;
        setClassFilterType(button.dataset.classFilterType, { persist: true, rerender: true });
      });
    }

    if (EL.classTypeSelect) {
      EL.classTypeSelect.addEventListener("change", () => {
        setClassFilterType(EL.classTypeSelect.value, { persist: true, rerender: true });
      });
    }

    if (EL.routeFilter) {
      EL.routeFilter.addEventListener("change", () => {
        STATE.routeFilter = EL.routeFilter.value;
        applyFiltersAndRender();
      });
    }

    if (EL.clearFiltersButton) {
      EL.clearFiltersButton.addEventListener("click", () => {
        clearFilters();
        applyFiltersAndRender();
      });
    }

    if (EL.resultsGrid) {
      EL.resultsGrid.addEventListener("click", (event) => {
        const classToggle = event.target.closest(".class-toggle");
        if (classToggle) {
          handleClassToggleClick(classToggle.dataset.classId);
          return;
        }

        const subclassChip = event.target.closest(".subclass-chip");
        if (subclassChip) {
          handleSubclassChipClick(subclassChip.dataset.classId, subclassChip.dataset.subclassId);
          return;
        }

        const subclassChipToggle = event.target.closest(".subclass-chip-toggle");
        if (subclassChipToggle) {
          handleSubclassChipToggleClick(subclassChipToggle.dataset.classId);
          return;
        }

        const card = event.target.closest(".med-card");
        if (!card) return;
        selectMedication(card.dataset.id, true);
      });

      EL.resultsGrid.addEventListener("keydown", handleResultsGridKeydown);
    }

    if (EL.viewModeControl) {
      EL.viewModeControl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-view-mode]");
        if (!button) return;
        setViewMode(button.dataset.viewMode, { persist: true, rerender: true });
      });
    }

    if (EL.viewModeSelect) {
      EL.viewModeSelect.addEventListener("change", () => {
        setViewMode(EL.viewModeSelect.value, { persist: true, rerender: true });
      });
    }

    if (EL.detailCloseButton) {
      EL.detailCloseButton.addEventListener("click", closeMobileDetailPanel);
    }

    if (EL.detailScrim) {
      EL.detailScrim.addEventListener("click", closeMobileDetailPanel);
    }

    if (EL.themeToggleButton) {
      EL.themeToggleButton.addEventListener("click", toggleTheme);
    }

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      if (STATE.classTreeMenuOpen) {
        closeClassTreeMenu();
        return;
      }

      if (EL.detailPanel && EL.detailPanel.classList.contains("open")) {
        closeMobileDetailPanel();
      }
    });

    document.addEventListener("click", (event) => {
      if (!STATE.classTreeMenuOpen || !EL.classTreeControl) return;
      if (EL.classTreeControl.contains(event.target)) return;
      closeClassTreeMenu();
    });

    window.addEventListener("resize", () => {
      if (!isMobileViewport()) {
        closeMobileDetailPanel();
      }
    });

    window.addEventListener("storage", (event) => {
      if (event.key === CONFIG.themeKey) {
        syncThemeFromStorage();
      }
    });

    document.addEventListener(CONFIG.themeChangedEvent, (event) => {
      const eventTheme = event?.detail?.theme;
      if (eventTheme === "light" || eventTheme === "dark") {
        applyTheme(eventTheme);
      } else {
        syncThemeFromStorage();
      }
    });
  }

  function clearFilters() {
    if (EL.searchInput) EL.searchInput.value = "";
    if (EL.routeFilter) EL.routeFilter.value = "";

    STATE.query = "";
    resetClassFilter();
    STATE.routeFilter = "";
    closeClassTreeMenu();
  }

  function handleClassToggleClick(classId) {
    if (!classId) return;
    STATE.expandedClassId = classId;
    renderCards();
  }

  function handleSubclassChipClick(classId, subclassId) {
    if (!classId || !subclassId) return;
    STATE.selectedSubclassByClass[classId] = subclassId;
    renderCards();
  }

  function handleSubclassChipToggleClick(classId) {
    if (!classId) return;
    if (STATE.expandedSubclassChipsByClass[classId]) {
      delete STATE.expandedSubclassChipsByClass[classId];
    } else {
      STATE.expandedSubclassChipsByClass[classId] = true;
    }
    renderCards();
  }

  async function loadData() {
    hideError();
    try {
      const [payload, classTaxonomy, mainHierarchyArtifacts] = await Promise.all([
        loadMedicationPayload(),
        loadClassTaxonomyIndex(),
        loadMainHierarchyArtifacts(),
      ]);

      const records = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.medications)
          ? payload.medications
          : [];

      STATE.classTaxonomy = classTaxonomy;
      STATE.mainHierarchyIndex = mainHierarchyArtifacts?.index || null;
      STATE.mainHierarchyMappingByMedicationId = mainHierarchyArtifacts?.mappingByMedicationId || new Map();
      STATE.mainHierarchyMappingReport = mainHierarchyArtifacts?.report || null;
      STATE.mainHierarchyEnabled = shouldEnableMainHierarchyClassSystem(mainHierarchyArtifacts);
      maybeWarnOnMainHierarchyMappingQuality(STATE.mainHierarchyMappingReport);
      STATE.medications = records
        .map((record, index) => normalizeMedication(record, index, {
          classTaxonomy,
          mainHierarchyIndex: STATE.mainHierarchyIndex,
          mainHierarchyMappingByMedicationId: STATE.mainHierarchyMappingByMedicationId,
          useMainHierarchyClassSystem: STATE.mainHierarchyEnabled,
        }))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

      populateClassFilter();
      populateRouteFilter();
      applyFiltersAndRender();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to load medication data.");
      STATE.medications = [];
      STATE.classTaxonomy = null;
      STATE.mainHierarchyIndex = null;
      STATE.mainHierarchyMappingByMedicationId = new Map();
      STATE.mainHierarchyMappingReport = null;
      STATE.mainHierarchyEnabled = false;
      applyFiltersAndRender();
    }
  }

  async function loadMedicationPayload() {
    const response = await fetch(CONFIG.dataPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load medication data (${response.status})`);
    }
    return response.json();
  }

  async function loadClassTaxonomyIndex() {
    try {
      const response = await fetch(CONFIG.classTaxonomyPath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load class taxonomy (${response.status})`);
      }

      const payload = await response.json();
      const taxonomy = normalizeClassTaxonomyIndex(payload);
      if (!taxonomy || taxonomy.primaries.length === 0) return null;
      return taxonomy;
    } catch (error) {
      console.warn("Class taxonomy unavailable; falling back to derived class paths.", error);
      return null;
    }
  }

  async function loadMainHierarchyArtifacts() {
    if (!CONFIG.useMainHierarchyClassSystem) {
      return null;
    }

    let fallbackReportPayload = null;
    try {
      const [indexPayload, mappingPayload, reportPayload] = await Promise.all([
        loadMainHierarchyIndex(),
        loadMainHierarchyMapping(),
        loadMainHierarchyMappingReport(),
      ]);

      const index = normalizeMainHierarchyIndex(indexPayload);
      const mappingByMedicationId = normalizeMainHierarchyMapping(mappingPayload, index);
      fallbackReportPayload = reportPayload;
      if (!index || mappingByMedicationId.size === 0) {
        throw new Error("Compiled main hierarchy artifacts were incomplete.");
      }

      return {
        index,
        mappingByMedicationId,
        report: normalizeMainHierarchyMappingReport(reportPayload),
      };
    } catch (error) {
      console.warn("Compiled main hierarchy artifacts unavailable; trying source hierarchy definition.", error);
    }

    try {
      const sourcePayload = await loadMainHierarchySourceDefinition();
      const index = normalizeMainHierarchyIndex(sourcePayload);
      if (!index) {
        return null;
      }
      return {
        index,
        mappingByMedicationId: new Map(),
        report: normalizeMainHierarchyMappingReport(fallbackReportPayload),
      };
    } catch (error) {
      console.warn("Main hierarchy source definition unavailable; falling back to legacy class taxonomy.", error);
      return null;
    }
  }

  async function loadMainHierarchyIndex() {
    const response = await fetch(CONFIG.mainHierarchyIndexPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load main hierarchy index (${response.status})`);
    }
    return response.json();
  }

  async function loadMainHierarchyMapping() {
    const response = await fetch(CONFIG.mainHierarchyMappingPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load main hierarchy mapping (${response.status})`);
    }
    return response.json();
  }

  async function loadMainHierarchyMappingReport() {
    try {
      const response = await fetch(CONFIG.mainHierarchyMappingReportPath, { cache: "no-store" });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  async function loadMainHierarchySourceDefinition() {
    const response = await fetch(CONFIG.mainHierarchySourcePath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load main hierarchy source definition (${response.status})`);
    }
    return response.json();
  }

  function normalizeMedication(record, index, context = {}) {
    if (!record || typeof record !== "object") return null;
    const classTaxonomy = context?.classTaxonomy || null;
    const mainHierarchyIndex = context?.mainHierarchyIndex || null;
    const mainHierarchyMappingByMedicationId = context?.mainHierarchyMappingByMedicationId instanceof Map
      ? context.mainHierarchyMappingByMedicationId
      : new Map();
    const useMainHierarchyClassSystem = Boolean(context?.useMainHierarchyClassSystem);

    const id = cleanText(record.id) || `med-${index + 1}`;
    const name = cleanText(record.name);
    const drugClass = cleanText(record.drugClass);
    const routes = uniq(toTextArray(record.routes).map(normalizeRoute).filter(Boolean));
    const moa = cleanText(record.moa);
    const indications = toTextArray(record.indications);
    const contraindications = toTextArray(record.contraindications);
    const adverseEffects = toTextArray(record.adverseEffects);
    const majorInteractions = toTextArray(record.majorInteractions);
    const monitoring = toTextArray(record.monitoring);
    const aliases = toTextArray(record.aliases);
    const brandExamples = toTextArray(record.brandExamples);
    const pearls = toTextArray(record.pearls);
    const classLabelMap = classTaxonomy?.labelMap instanceof Map
      ? classTaxonomy.labelMap
      : null;
    const classTags = deriveMedicationClassTags(record, drugClass, classLabelMap);
    const classModel = deriveMedicationClassModel(classTags, classTaxonomy, drugClass);
    const legacyClassModel = ensureLegacyClassModel({
      classModel,
      classTaxonomy,
      fallbackLabel: drugClass,
      name,
      aliases,
      brandExamples,
      indications,
    });
    const canonicalClassModel = deriveMedicationMainHierarchyClassModel(
      id,
      mainHierarchyIndex,
      mainHierarchyMappingByMedicationId
    );
    const activeClassModel = pickActiveDrugClassModel(
      legacyClassModel,
      canonicalClassModel,
      useMainHierarchyClassSystem
    );
    const useCategoryTags = deriveMedicationUseCategoryTags({
      name,
      drugClass,
      classTags,
      moa,
      indications,
      aliases,
      brandExamples,
    });
    const specificClassLabel = deriveSpecificClassLabel(record, {
      name,
      drugClass,
      moa,
      indications,
      categories: toTextArray(record?.classCandidates),
      classTags: toTextArray(record?.classTags),
      atcCodes: toTextArray(record?.atcCodes),
      descriptionFirstSentence: cleanText(record?.descriptionFirstSentence),
      displayClassLabel: cleanText(activeClassModel.displayClassLabel),
      fallbackLabel: cleanText(activeClassModel.displayClassLabel) || drugClass,
      mainHierarchyIndex,
    });

    const normalized = {
      id,
      name,
      drugClass,
      specificClassLabel,
      routes,
      moa,
      indications,
      contraindications,
      adverseEffects,
      majorInteractions,
      monitoring,
      aliases,
      brandExamples,
      pearls,
      classTags,
      classNodeId: cleanText(activeClassModel.classNodeId),
      classPathIds: Array.isArray(activeClassModel.classPathIds)
        ? activeClassModel.classPathIds.slice()
        : [],
      classAssignments: Array.isArray(activeClassModel.classAssignments)
        ? activeClassModel.classAssignments
        : [],
      classPath: Array.isArray(activeClassModel.classPath)
        ? activeClassModel.classPath.slice()
        : [],
      primaryClass: cleanText(activeClassModel.primaryClass),
      subclass1: cleanText(activeClassModel.subclass1),
      subclass2: cleanText(activeClassModel.subclass2),
      subclass3: cleanText(activeClassModel.subclass3),
      displayClassLabel: cleanText(activeClassModel.displayClassLabel),
      classSystem: cleanText(activeClassModel.classSystem) || "legacy",
      canonicalClassNodeId: cleanText(canonicalClassModel.classNodeId),
      canonicalClassPathIds: Array.isArray(canonicalClassModel.classPathIds)
        ? canonicalClassModel.classPathIds.slice()
        : [],
      canonicalClassPath: Array.isArray(canonicalClassModel.classPath)
        ? canonicalClassModel.classPath.slice()
        : [],
      legacyClassPath: Array.isArray(legacyClassModel.classPath)
        ? legacyClassModel.classPath.slice()
        : [],
      useCategoryTags,
      indicationTags: useCategoryTags,
    };

    const missing = REQUIRED_FIELDS.filter((field) => {
      const value = normalized[field];
      if (Array.isArray(value)) return value.length === 0;
      return !value;
    });

    if (missing.length > 0) {
      console.warn(`Medication record "${id}" missing required field(s): ${missing.join(", ")}`);
      return null;
    }

    normalized.nameNorm = normalizeSearch(normalized.name);
    normalized.drugClassNorm = normalizeSearch(normalized.drugClass);
    normalized.routesNorm = normalized.routes.map(normalizeSearch);
    normalized.moaNorm = normalizeSearch(normalized.moa);
    normalized.indicationsNorm = normalized.indications.map(normalizeSearch);
    normalized.aliasesNorm = normalized.aliases.map(normalizeSearch);
    normalized.brandExamplesNorm = normalized.brandExamples.map(normalizeSearch);
    normalized.contraindicationsNorm = normalized.contraindications.map(normalizeSearch);
    normalized.adverseEffectsNorm = normalized.adverseEffects.map(normalizeSearch);
    normalized.majorInteractionsNorm = normalized.majorInteractions.map(normalizeSearch);
    normalized.monitoringNorm = normalized.monitoring.map(normalizeSearch);
    normalized.classTagsNorm = normalized.classTags.map(normalizeSearch);
    normalized.classPathIdsNorm = normalized.classPathIds.map(normalizeSearch);
    normalized.indicationTagsNorm = normalized.indicationTags.map(normalizeSearch);
    normalized.displayClassLabelNorm = normalizeSearch(normalized.displayClassLabel);
    normalized.specificClassLabelNorm = normalizeSearch(normalized.specificClassLabel);

    normalized.searchBlob = [
      normalized.nameNorm,
      normalized.drugClassNorm,
      normalized.specificClassLabelNorm,
      normalized.displayClassLabelNorm,
      normalized.moaNorm,
      ...normalized.classTagsNorm,
      ...normalized.indicationTagsNorm,
      ...normalized.routesNorm,
      ...normalized.aliasesNorm,
      ...normalized.brandExamplesNorm,
      ...normalized.indicationsNorm,
      ...normalized.contraindicationsNorm,
      ...normalized.adverseEffectsNorm,
      ...normalized.majorInteractionsNorm,
      ...normalized.monitoringNorm,
    ].join(" ");

    normalized.otherFieldsNorm = [
      ...normalized.routesNorm,
      ...normalized.contraindicationsNorm,
      ...normalized.adverseEffectsNorm,
      ...normalized.majorInteractionsNorm,
      ...normalized.monitoringNorm,
    ];

    return normalized;
  }

  function ensureLegacyClassModel(payload) {
    const classModel = payload?.classModel && typeof payload.classModel === "object"
      ? payload.classModel
      : null;
    const hasPath = Array.isArray(classModel?.classPath) && classModel.classPath.length > 0;
    if (hasPath) {
      return {
        ...classModel,
        classNodeId: "",
        classPathIds: [],
        classSystem: "legacy",
      };
    }

    const classTaxonomy = payload?.classTaxonomy && typeof payload.classTaxonomy === "object"
      ? payload.classTaxonomy
      : null;
    const taxonomyFallback = classTaxonomy?.fallback && typeof classTaxonomy.fallback === "object"
      ? classTaxonomy.fallback
      : null;
    const fallbackPath = taxonomyFallback
      ? [
        cleanText(taxonomyFallback.primaryClass) || CONFIG.uncategorizedClassLabel,
        cleanText(taxonomyFallback.subclass) || "Unmapped",
      ]
      : deriveClassPath({
        name: payload?.name,
        drugClass: payload?.fallbackLabel,
        aliases: payload?.aliases,
        brandExamples: payload?.brandExamples,
        indications: payload?.indications,
      });

    const fallbackModel = buildClassModelFromPath(fallbackPath, payload?.fallbackLabel);
    return {
      ...fallbackModel,
      classNodeId: "",
      classPathIds: [],
      classSystem: "legacy",
    };
  }

  function deriveMedicationMainHierarchyClassModel(
    medicationId,
    mainHierarchyIndex,
    mainHierarchyMappingByMedicationId
  ) {
    const fallbackModel = buildFallbackMainHierarchyClassModel(mainHierarchyIndex);
    if (!medicationId || !(mainHierarchyMappingByMedicationId instanceof Map)) {
      return fallbackModel;
    }

    const mappingEntry = mainHierarchyMappingByMedicationId.get(medicationId);
    if (!mappingEntry || typeof mappingEntry !== "object") {
      return fallbackModel;
    }

    const classNodeId = cleanText(mappingEntry.classNodeId) || cleanText(fallbackModel.classNodeId);
    const classPathIds = uniq(
      toTextArray(mappingEntry.classPathIds).map(cleanText).filter(Boolean)
    );
    const classPathLabels = uniq(
      toTextArray(mappingEntry.classPathLabels).map(sanitizeClassLabel).filter(Boolean)
    );
    const levels = getClassLevelsFromPath(classPathLabels, CONFIG.uncategorizedClassLabel);
    const fallbackNodeId = cleanText(mainHierarchyIndex?.fallbackNodeId);
    const isFallback = classNodeId === fallbackNodeId;

    return {
      classNodeId,
      classPathIds,
      classPath: levels.classPath,
      primaryClass: levels.primaryClass,
      subclass1: levels.subclass1,
      subclass2: levels.subclass2,
      subclass3: levels.subclass3,
      displayClassLabel: levels.displayClassLabel,
      classAssignments: [
        {
          classNodeId,
          classPathIds,
          classPath: levels.classPath,
          primaryClass: levels.primaryClass,
          subclass: levels.displayClassLabel,
          subclass1: levels.subclass1,
          subclass2: levels.subclass2,
          subclass3: levels.subclass3,
          displayClassLabel: levels.displayClassLabel,
          depth: levels.classPath.length,
          matchType: cleanText(mappingEntry.matchType),
        },
      ],
      classSystem: "main-hierarchy",
      isFallback,
    };
  }

  function buildFallbackMainHierarchyClassModel(mainHierarchyIndex) {
    const fallbackPathLabels = toTextArray(mainHierarchyIndex?.fallbackPathLabels)
      .map(sanitizeClassLabel)
      .filter(Boolean);
    const fallbackPathIds = toTextArray(mainHierarchyIndex?.fallbackPathIds)
      .map(cleanText)
      .filter(Boolean);
    const fallbackNodeId = cleanText(mainHierarchyIndex?.fallbackNodeId);
    const levels = getClassLevelsFromPath(
      fallbackPathLabels.length > 0
        ? fallbackPathLabels
        : [CONFIG.uncategorizedClassLabel, "Unmapped"],
      CONFIG.uncategorizedClassLabel
    );

    return {
      classNodeId: fallbackNodeId,
      classPathIds: fallbackPathIds,
      classPath: levels.classPath,
      primaryClass: levels.primaryClass,
      subclass1: levels.subclass1,
      subclass2: levels.subclass2,
      subclass3: levels.subclass3,
      displayClassLabel: levels.displayClassLabel,
      classAssignments: [
        {
          classNodeId: fallbackNodeId,
          classPathIds: fallbackPathIds,
          classPath: levels.classPath,
          primaryClass: levels.primaryClass,
          subclass: levels.displayClassLabel,
          subclass1: levels.subclass1,
          subclass2: levels.subclass2,
          subclass3: levels.subclass3,
          displayClassLabel: levels.displayClassLabel,
          depth: levels.classPath.length,
          matchType: "fallback",
        },
      ],
      classSystem: "main-hierarchy",
      isFallback: true,
    };
  }

  function pickActiveDrugClassModel(legacyClassModel, canonicalClassModel, useMainHierarchyClassSystem) {
    if (!useMainHierarchyClassSystem) {
      return legacyClassModel;
    }

    if (!canonicalClassModel || canonicalClassModel.classSystem !== "main-hierarchy") {
      return legacyClassModel;
    }

    if (canonicalClassModel.isFallback && CONFIG.useMainHierarchyCompatibilityFallback) {
      return {
        ...legacyClassModel,
        classNodeId: canonicalClassModel.classNodeId,
        classPathIds: canonicalClassModel.classPathIds,
        classSystem: "legacy-compat",
      };
    }

    return canonicalClassModel;
  }

  function deriveMedicationClassTags(record, drugClass, classLabelMap = null) {
    const raw = [];
    const classValue = sanitizeClassLabel(drugClass);
    if (classValue) raw.push(classValue);

    if (record && typeof record === "object") {
      raw.push(...toTextArray(record.classCandidates).map(sanitizeClassLabel));
      raw.push(...toTextArray(record.classTags).map(sanitizeClassLabel));
    }

    const deduped = uniq(raw.map((item) => sanitizeClassLabel(item)).filter(Boolean));
    if (!(classLabelMap instanceof Map) || classLabelMap.size === 0) {
      return deduped;
    }

    const mapped = deduped
      .map((item) => classLabelMap.get(normalizeSearch(item)))
      .filter(Boolean);
    return uniq(mapped);
  }

  function deriveMedicationClassModel(classTags, classTaxonomy = null, sourceDrugClass = "") {
    const assignments = deriveMedicationClassAssignments(classTags, classTaxonomy);
    const preferred = choosePreferredClassAssignment(assignments, sourceDrugClass);
    if (!preferred) {
      return {
        classAssignments: [],
        classPath: [],
        primaryClass: "",
        subclass1: "",
        subclass2: "",
        subclass3: "",
        displayClassLabel: "",
      };
    }

    const levels = getClassLevelsFromPath(preferred.classPath, preferred.primaryClass);
    return {
      classAssignments: [
        {
          ...preferred,
          subclass: levels.displayClassLabel,
          subclass1: levels.subclass1,
          subclass2: levels.subclass2,
          subclass3: levels.subclass3,
          classPath: levels.classPath,
          displayClassLabel: levels.displayClassLabel,
          depth: levels.classPath.length,
          specificityScore: getClassSpecificityScore(levels.displayClassLabel, levels.primaryClass),
        },
      ],
      classPath: levels.classPath,
      primaryClass: levels.primaryClass,
      subclass1: levels.subclass1,
      subclass2: levels.subclass2,
      subclass3: levels.subclass3,
      displayClassLabel: levels.displayClassLabel,
    };
  }

  function deriveMedicationClassAssignments(classTags, classTaxonomy = null) {
    if (!classTaxonomy || !(classTaxonomy.subclassToPrimaries instanceof Map)) {
      return [];
    }

    const tags = uniq(toTextArray(classTags).map(sanitizeClassLabel).filter(Boolean));
    const primaryMatches = new Map();

    tags.forEach((tag) => {
      const refs = classTaxonomy.subclassToPrimaries.get(normalizeSearch(tag));
      if (!Array.isArray(refs)) return;

      refs.forEach((ref) => {
        const primaryClass = sanitizeClassLabel(ref?.primaryClass);
        const subclass = sanitizeClassLabel(ref?.subclass);
        if (!primaryClass || !subclass) return;

        const primaryKey = normalizeSearch(primaryClass);
        const subclassKey = normalizeSearch(subclass);
        if (!primaryKey || !subclassKey) return;

        if (!primaryMatches.has(primaryKey)) {
          primaryMatches.set(primaryKey, {
            primaryClass,
            labelsByKey: new Map(),
          });
        }

        const bucket = primaryMatches.get(primaryKey);
        if (!bucket.labelsByKey.has(subclassKey)) {
          bucket.labelsByKey.set(subclassKey, subclass);
        }
      });
    });

    const assignments = [];
    primaryMatches.forEach((entry) => {
      const primaryClass = sanitizeClassLabel(entry?.primaryClass);
      if (!primaryClass) return;

      const matchedLabels = Array.from(entry.labelsByKey.values());
      const deepestLabel = getDeepestClassLabel(matchedLabels, primaryClass);
      const classPath = buildClassPathForPrimary(
        primaryClass,
        deepestLabel,
        matchedLabels,
        classTaxonomy
      );
      const levels = getClassLevelsFromPath(classPath, primaryClass);

      assignments.push({
        primaryClass: levels.primaryClass,
        subclass: levels.displayClassLabel,
        subclass1: levels.subclass1,
        subclass2: levels.subclass2,
        subclass3: levels.subclass3,
        classPath: levels.classPath,
        displayClassLabel: levels.displayClassLabel,
        depth: levels.classPath.length,
        specificityScore: getClassSpecificityScore(levels.displayClassLabel, levels.primaryClass),
      });
    });

    return assignments.sort(compareClassAssignments);
  }

  function choosePreferredClassAssignment(assignments, sourceDrugClass = "") {
    if (!Array.isArray(assignments) || assignments.length === 0) return null;

    const sourceKey = normalizeSearch(sanitizeClassLabel(sourceDrugClass));
    const ranked = assignments.slice().sort((a, b) => {
      const aSource = classAssignmentMatchesSourceLabel(a, sourceKey) ? 1 : 0;
      const bSource = classAssignmentMatchesSourceLabel(b, sourceKey) ? 1 : 0;
      if (aSource !== bSource) return bSource - aSource;

      const aDepth = Number.isFinite(a?.depth) ? a.depth : Array.isArray(a?.classPath) ? a.classPath.length : 0;
      const bDepth = Number.isFinite(b?.depth) ? b.depth : Array.isArray(b?.classPath) ? b.classPath.length : 0;
      if (aDepth !== bDepth) return bDepth - aDepth;

      const aScore = Number.isFinite(a?.specificityScore)
        ? a.specificityScore
        : getClassSpecificityScore(a?.displayClassLabel || a?.subclass, a?.primaryClass);
      const bScore = Number.isFinite(b?.specificityScore)
        ? b.specificityScore
        : getClassSpecificityScore(b?.displayClassLabel || b?.subclass, b?.primaryClass);
      if (aScore !== bScore) return bScore - aScore;

      const aLabel = cleanText(a?.displayClassLabel || a?.subclass || a?.primaryClass);
      const bLabel = cleanText(b?.displayClassLabel || b?.subclass || b?.primaryClass);
      return aLabel.localeCompare(bLabel);
    });

    return ranked[0] || null;
  }

  function classAssignmentMatchesSourceLabel(assignment, sourceKey) {
    if (!sourceKey) return false;
    const path = Array.isArray(assignment?.classPath) ? assignment.classPath : [];
    return path.some((segment) => normalizeSearch(segment) === sourceKey);
  }

  function buildClassModelFromPath(path, fallbackLabel = "") {
    const levels = getClassLevelsFromPath(path, fallbackLabel);
    return {
      classAssignments: [
        {
          primaryClass: levels.primaryClass,
          subclass: levels.displayClassLabel,
          subclass1: levels.subclass1,
          subclass2: levels.subclass2,
          subclass3: levels.subclass3,
          classPath: levels.classPath,
          displayClassLabel: levels.displayClassLabel,
          depth: levels.classPath.length,
          specificityScore: getClassSpecificityScore(levels.displayClassLabel, levels.primaryClass),
        },
      ],
      classPath: levels.classPath,
      primaryClass: levels.primaryClass,
      subclass1: levels.subclass1,
      subclass2: levels.subclass2,
      subclass3: levels.subclass3,
      displayClassLabel: levels.displayClassLabel,
    };
  }

  function getClassLevelsFromPath(path, fallbackLabel = "", options = {}) {
    const maxDepth = Number.isFinite(options?.maxDepth) ? Number(options.maxDepth) : 0;
    const rawPath = Array.isArray(path)
      ? path.map((segment) => sanitizeClassLabel(segment)).filter(Boolean)
      : [];
    const dedupedPath = dedupeClassPath(rawPath);
    const cleanedPath = maxDepth > 0
      ? limitClassPathDepth(dedupedPath.slice(0, maxDepth))
      : dedupedPath;
    if (cleanedPath.length === 0) {
      cleanedPath.push(cleanText(fallbackLabel) || CONFIG.uncategorizedClassLabel);
    }

    const primaryClass = cleanedPath[0] || CONFIG.uncategorizedClassLabel;
    const subclass1 = cleanedPath[1] || "";
    const subclass2 = cleanedPath[2] || "";
    const subclass3 = cleanedPath[3] || "";
    const displayClassLabel = getDisplayClassLabelFromPath(cleanedPath, fallbackLabel);

    return {
      classPath: cleanedPath,
      primaryClass,
      subclass1,
      subclass2,
      subclass3,
      displayClassLabel,
    };
  }

  function limitClassPathDepth(path) {
    const labels = Array.isArray(path)
      ? path.map((segment) => sanitizeClassLabel(segment)).filter(Boolean)
      : [];
    if (labels.length <= MAX_CLASS_PATH_DEPTH) {
      return labels;
    }

    const primary = labels[0];
    const tail = labels.slice(-(MAX_CLASS_PATH_DEPTH - 1));
    return dedupeClassPath([primary, ...tail]);
  }

  function getDisplayClassLabelFromPath(path, fallbackLabel = "") {
    const labels = Array.isArray(path)
      ? path.map((segment) => sanitizeClassLabel(segment)).filter(Boolean)
      : [];
    if (labels.length === 0) {
      return cleanText(fallbackLabel) || CONFIG.uncategorizedClassLabel;
    }
    return labels[labels.length - 1];
  }

  function buildClassPathForPrimary(primaryClass, deepestLabel, matchedLabels, classTaxonomy = null) {
    const primary = sanitizeClassLabel(primaryClass) || CONFIG.uncategorizedClassLabel;
    const matched = uniq(
      toTextArray(matchedLabels)
        .map((label) => sanitizeClassLabel(label))
        .filter(Boolean)
    );
    const matchedSet = new Set(matched);
    if (!matchedSet.has(primary)) {
      matchedSet.add(primary);
    }

    const deepest = sanitizeClassLabel(deepestLabel)
      || getDeepestClassLabel(Array.from(matchedSet.values()), primary)
      || primary;

    const ancestors = resolveClassPathAncestors(deepest, primary, matchedSet, classTaxonomy);
    return limitClassPathDepth(dedupeClassPath([primary, ...ancestors]));
  }

  function resolveClassPathAncestors(targetLabel, primaryClass, matchedSet, classTaxonomy = null) {
    const primaryKey = normalizeSearch(primaryClass);
    const target = sanitizeClassLabel(targetLabel);
    if (!target) return [];

    const targetKey = normalizeSearch(target);
    if (!targetKey || targetKey === primaryKey) return [];

    const chain = [target];
    const seen = new Set([targetKey]);
    let current = target;
    while (chain.length < MAX_CLASS_PATH_DEPTH) {
      const parent = findParentClassLabel(current, primaryClass, matchedSet, classTaxonomy);
      if (!parent) break;

      const parentKey = normalizeSearch(parent);
      if (!parentKey || seen.has(parentKey)) break;
      if (parentKey === primaryKey) break;

      chain.unshift(parent);
      seen.add(parentKey);
      current = parent;
    }

    return chain;
  }

  function findParentClassLabel(childLabel, primaryClass, matchedSet, classTaxonomy = null) {
    const child = sanitizeClassLabel(childLabel);
    if (!child) return "";

    const overrideParent = getOverriddenParentLabel(child, primaryClass, classTaxonomy);
    if (overrideParent) return overrideParent;

    const childScore = getClassSpecificityScore(child, primaryClass);
    const candidates = Array.from(matchedSet.values())
      .map((label) => sanitizeClassLabel(label))
      .filter((label) => {
        if (!label) return false;
        if (normalizeSearch(label) === normalizeSearch(child)) return false;
        if (normalizeSearch(label) === normalizeSearch(primaryClass)) return false;
        return true;
      });

    return pickBestAncestorCandidate(candidates, child, childScore, primaryClass);
  }

  function getOverriddenParentLabel(childLabel, primaryClass, classTaxonomy = null) {
    const primaryKey = normalizeClassLabelForLookup(primaryClass);
    const childKey = normalizeClassLabelForLookup(childLabel);
    const mapKey = `${primaryKey}|${childKey}`;
    const parentLabel = cleanText(CLASS_PARENT_OVERRIDE_MAP.get(mapKey));
    if (!parentLabel) return "";

    if (!classLabelExistsWithinPrimary(parentLabel, primaryClass, classTaxonomy)) {
      return "";
    }

    return parentLabel;
  }

  function classLabelExistsWithinPrimary(label, primaryClass, classTaxonomy = null) {
    const normalizedLabel = normalizeSearch(label);
    const primaryKey = normalizeSearch(primaryClass);
    if (!normalizedLabel || !primaryKey) return false;
    if (normalizedLabel === primaryKey) return true;

    const subclassesByPrimary = classTaxonomy?.subclassesByPrimary;
    if (!(subclassesByPrimary instanceof Map)) return true;

    const subclassSet = subclassesByPrimary.get(primaryKey);
    if (!(subclassSet instanceof Set)) return false;
    return subclassSet.has(normalizedLabel);
  }

  function pickBestAncestorCandidate(candidates, childLabel, childScore, primaryClass) {
    const filtered = candidates.filter((candidate) => {
      const candidateScore = getClassSpecificityScore(candidate, primaryClass);
      if (candidateScore >= childScore) return false;
      return isLikelyAncestorClass(candidate, childLabel);
    });

    if (filtered.length === 0) return "";

    filtered.sort((a, b) => {
      const aScore = getClassSpecificityScore(a, primaryClass);
      const bScore = getClassSpecificityScore(b, primaryClass);
      if (aScore !== bScore) return bScore - aScore;
      if (a.length !== b.length) return b.length - a.length;
      return a.localeCompare(b);
    });

    return filtered[0];
  }

  function isLikelyAncestorClass(candidateLabel, childLabel) {
    const candidate = sanitizeClassLabel(candidateLabel);
    const child = sanitizeClassLabel(childLabel);
    if (!candidate || !child) return false;

    const candidateKey = normalizeSearch(candidate);
    const childKey = normalizeSearch(child);
    if (!candidateKey || !childKey || candidateKey === childKey) return false;

    if (childKey.includes(candidateKey)) return true;

    const candidateTokens = toClassTokens(candidate);
    const childTokens = new Set(toClassTokens(child));
    if (candidateTokens.length === 0 || childTokens.size === 0) return false;

    return candidateTokens.every((token) => childTokens.has(token));
  }

  function getDeepestClassLabel(labels, primaryClass = "") {
    const values = uniq(
      toTextArray(labels)
        .map((label) => sanitizeClassLabel(label))
        .filter(Boolean)
    );
    if (values.length === 0) {
      return cleanText(primaryClass) || CONFIG.uncategorizedClassLabel;
    }

    values.sort((a, b) => compareClassSpecificity(a, b, primaryClass));
    return values[0];
  }

  function compareClassSpecificity(a, b, primaryClass = "") {
    const aScore = getClassSpecificityScore(a, primaryClass);
    const bScore = getClassSpecificityScore(b, primaryClass);
    if (aScore !== bScore) return bScore - aScore;
    if (a.length !== b.length) return b.length - a.length;
    return a.localeCompare(b);
  }

  function getClassSpecificityScore(label, primaryClass = "") {
    const normalized = normalizeSearch(label);
    if (!normalized) return Number.NEGATIVE_INFINITY;

    const words = normalized.split(" ").filter(Boolean);
    const hasSubtype = /\b(alpha|beta|receptor|type|h1|h2|ht1|ht2|ht3|1|2|3|4)\b/i.test(normalized);
    const hasMechanismKeyword = /\b(agonist|agonists|antagonist|antagonists|inhibitor|inhibitors|blocker|blockers|modulator|modulators)\b/i.test(normalized);
    const hasCommaQualifier = /,/.test(String(label || ""));
    const endsWithAgents = /\bagents?\b$/i.test(String(label || ""));

    let score = 0;
    score += words.length * 8;
    if (hasSubtype) score += 8;
    if (hasMechanismKeyword) score += 4;
    if (hasCommaQualifier) score += 3;
    if (endsWithAgents) score -= 2;
    if (normalizeSearch(label) === normalizeSearch(primaryClass)) score -= 12;

    return score;
  }

  function toClassTokens(value) {
    return normalizeSearch(value)
      .split(" ")
      .map(canonicalizeClassToken)
      .filter(Boolean);
  }

  function canonicalizeClassToken(value) {
    const token = cleanText(value).toLowerCase();
    if (!token) return "";
    if (token.length > 3 && token.endsWith("s")) {
      return token.slice(0, -1);
    }
    return token;
  }

  function compareClassAssignments(a, b) {
    const aDepth = Number.isFinite(a?.depth) ? a.depth : 0;
    const bDepth = Number.isFinite(b?.depth) ? b.depth : 0;
    if (aDepth !== bDepth) return bDepth - aDepth;

    const aScore = Number.isFinite(a?.specificityScore) ? a.specificityScore : 0;
    const bScore = Number.isFinite(b?.specificityScore) ? b.specificityScore : 0;
    if (aScore !== bScore) return bScore - aScore;

    return cleanText(a?.primaryClass).localeCompare(cleanText(b?.primaryClass));
  }

  function sanitizeClassLabel(value) {
    const text = cleanText(value)
      .replace(/[;,:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";

    const normalizedText = canonicalizeAdrenergicAfterReceptor(text);
    const alias = CLASS_LABEL_ALIAS_MAP.get(normalizeSearch(normalizedText));
    const resolved = alias || normalizedText;
    return canonicalizeAdrenergicAfterReceptor(resolved);
  }

  function normalizeClassLabelForLookup(value) {
    const normalized = canonicalizeAdrenergicAfterReceptor(cleanText(value));
    return normalizeSearch(normalized);
  }

  function canonicalizeAdrenergicAfterReceptor(value) {
    let text = cleanText(value);
    if (!text) return "";

    ADRENERGIC_RECEPTOR_ORDER_RULES.forEach(({ pattern, replacement }) => {
      text = text.replace(pattern, replacement);
    });

    return text.replace(/\s+/g, " ").trim();
  }

  function deriveMedicationUseCategoryTags(payload) {
    const context = normalizeSearch(
      [
        payload?.name,
        payload?.drugClass,
        payload?.moa,
        ...(Array.isArray(payload?.indications) ? payload.indications : []),
        ...(Array.isArray(payload?.aliases) ? payload.aliases : []),
        ...(Array.isArray(payload?.brandExamples) ? payload.brandExamples : []),
        ...(Array.isArray(payload?.classTags) ? payload.classTags : []),
      ].join(" ")
    );

    const tags = USE_CATEGORY_RULES
      .filter((rule) => rule.match.test(context))
      .map((rule) => rule.label);

    return uniq(tags);
  }

  function deriveSpecificClassLabel(record, normalizedContext = {}) {
    const fallbackLabel = sanitizeClassLabel(
      cleanText(normalizedContext?.fallbackLabel)
      || cleanText(normalizedContext?.displayClassLabel)
      || cleanText(normalizedContext?.drugClass)
      || CONFIG.uncategorizedClassLabel
    );
    const nameKey = normalizeSearch(cleanText(normalizedContext?.name) || cleanText(record?.name));
    const overrideLabel = sanitizeClassLabel(SPECIFIC_CLASS_OVERRIDES_BY_DRUG[nameKey]);
    if (overrideLabel) return overrideLabel;

    const mechanismContext = [
      cleanText(normalizedContext?.moa),
      ...toTextArray(normalizedContext?.indications),
      cleanText(normalizedContext?.descriptionFirstSentence),
    ]
      .filter(Boolean)
      .join(" ");

    const atcCodes = uniq(
      [
        ...toTextArray(normalizedContext?.atcCodes),
      ]
        .map(normalizeAtcCode)
        .filter(Boolean)
    );

    const candidatesBySource = {
      mechanism: collectMechanismClassCandidates(mechanismContext),
      atc5: collectAtcClassCandidates(atcCodes, ATC_LEVEL5_CLASS_MAP),
      atc4: collectAtcClassCandidates(atcCodes, ATC_LEVEL4_CLASS_MAP, 5),
      category: collectCategoryClassCandidates([
        ...toTextArray(normalizedContext?.categories),
        ...toTextArray(normalizedContext?.classTags),
        ...toTextArray(record?.classCandidates),
        ...toTextArray(record?.classTags),
        cleanText(normalizedContext?.drugClass),
      ], normalizedContext?.mainHierarchyIndex),
      legacy: [fallbackLabel],
    };

    for (const sourceKey of SPECIFIC_CLASS_PRIORITY) {
      const selected = chooseMostSpecificClassLabel(candidatesBySource[sourceKey]);
      if (selected) return selected;
    }

    return fallbackLabel || CONFIG.uncategorizedClassLabel;
  }

  function collectMechanismClassCandidates(text) {
    const content = cleanText(text);
    if (!content) return [];

    const labels = MECHANISM_CLASS_RULES
      .filter((rule) => rule?.match instanceof RegExp && rule.match.test(content))
      .map((rule) => sanitizeClassLabel(rule?.label))
      .filter(Boolean);
    return uniq(labels);
  }

  function collectAtcClassCandidates(atcCodes, sourceMap, prefixLength = 0) {
    if (!sourceMap || typeof sourceMap !== "object") return [];

    const labels = [];
    toTextArray(atcCodes).forEach((rawCode) => {
      const normalizedCode = normalizeAtcCode(rawCode);
      if (!normalizedCode) return;
      const lookupCode = prefixLength > 0
        ? normalizedCode.slice(0, prefixLength)
        : normalizedCode;
      if (!lookupCode || (prefixLength > 0 && lookupCode.length < prefixLength)) return;
      const mapped = sanitizeClassLabel(sourceMap[lookupCode]);
      if (mapped) labels.push(mapped);
    });
    return uniq(labels);
  }

  function collectCategoryClassCandidates(labels, mainHierarchyIndex = null) {
    return uniq(
      toTextArray(labels)
        .map((label) => {
          const cleaned = sanitizeClassLabel(label);
          if (!cleaned) return "";
          const hierarchyMatch = mapToMainHierarchyLabel(cleaned, mainHierarchyIndex);
          return hierarchyMatch || cleaned;
        })
        .filter((label) => label && !isBroadClassLabel(label))
    );
  }

  function chooseMostSpecificClassLabel(labels) {
    const values = uniq(
      toTextArray(labels)
        .map((label) => sanitizeClassLabel(label))
        .filter(Boolean)
    );
    if (values.length === 0) return "";
    values.sort((a, b) => compareClassSpecificity(a, b));
    return values[0] || "";
  }

  function normalizeAtcCode(value) {
    const raw = cleanText(value).toUpperCase();
    if (!raw) return "";
    const cleaned = raw.replace(/[^A-Z0-9]/g, "");
    if (!cleaned || !/^[A-Z][0-9]{2}[A-Z0-9]*$/.test(cleaned)) return "";
    return cleaned;
  }

  function isBroadClassLabel(label) {
    const normalized = normalizeSearch(label);
    if (!normalized) return true;
    if (BROAD_CLASS_BLOCKLIST_SET.has(normalized)) return true;
    if (/^atc [a-z](?:\b| )/.test(normalized)) return true;
    if (normalized === normalizeSearch(CONFIG.uncategorizedClassLabel)) return true;
    return false;
  }

  function mapToMainHierarchyLabel(label, mainHierarchyIndex = null) {
    if (!label || !mainHierarchyIndex || !(mainHierarchyIndex.labelLookup instanceof Map)) {
      return "";
    }

    const normalizedLabel = normalizeSearch(label);
    if (!normalizedLabel) return "";

    const direct = cleanText(mainHierarchyIndex.labelLookup.get(normalizedLabel));
    if (direct) return direct;

    const descriptors = Array.isArray(mainHierarchyIndex.labelDescriptors)
      ? mainHierarchyIndex.labelDescriptors
      : [];
    let best = null;
    descriptors.forEach((descriptor) => {
      const descriptorLabel = cleanText(descriptor?.label);
      const descriptorNorm = normalizeSearch(descriptorLabel);
      if (!descriptorNorm) return;
      if (!normalizedLabel.includes(descriptorNorm) && !descriptorNorm.includes(normalizedLabel)) {
        return;
      }

      const overlapChars = Math.min(normalizedLabel.length, descriptorNorm.length);
      const depth = Number.isFinite(descriptor?.depth) ? Number(descriptor.depth) : 0;
      const score = (normalizedLabel === descriptorNorm ? 1000 : 0) + (overlapChars * 3) + (depth * 10);
      if (!best || score > best.score) {
        best = {
          label: descriptorLabel,
          score,
        };
      }
    });

    return cleanText(best?.label);
  }

  function normalizeMainHierarchyIndex(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.drug_classes && typeof payload.drug_classes === "object") {
      return normalizeMainHierarchySourceDefinition(payload);
    }

    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    if (nodes.length === 0) return null;

    const nodeById = new Map();
    nodes.forEach((node) => {
      if (!node || typeof node !== "object") return;
      const id = cleanText(node.id);
      if (!id) return;
      nodeById.set(id, {
        id,
        key: cleanText(node.key),
        label: sanitizeClassLabel(node.label),
        parentId: cleanText(node.parentId),
        depth: Number.isFinite(node.depth) ? Number(node.depth) : 0,
        sortOrder: Number.isFinite(node.sortOrder) ? Number(node.sortOrder) : Number.POSITIVE_INFINITY,
        pathIds: toTextArray(node.pathIds).map(cleanText).filter(Boolean),
        pathLabels: toTextArray(node.pathLabels).map(sanitizeClassLabel).filter(Boolean),
        children: toTextArray(node.children).map(cleanText).filter(Boolean),
      });
    });

    const rootId = cleanText(payload.rootId);
    if (!rootId || !nodeById.has(rootId)) return null;

    let fallbackNodeId = cleanText(payload.fallbackNodeId);
    if (!fallbackNodeId || !nodeById.has(fallbackNodeId)) {
      fallbackNodeId = cleanText(payload.topLevelIds?.[0]);
      if (!fallbackNodeId || !nodeById.has(fallbackNodeId)) {
        fallbackNodeId = rootId;
      }
    }

    const fallbackNode = nodeById.get(fallbackNodeId);
    const fallbackPathIds = toTextArray(payload.fallbackPathIds)
      .map(cleanText)
      .filter(Boolean);
    const fallbackPathLabels = toTextArray(payload.fallbackPathLabels)
      .map(sanitizeClassLabel)
      .filter(Boolean);
    const resolvedFallbackPathIds = fallbackPathIds.length > 0
      ? fallbackPathIds
      : toTextArray(fallbackNode?.pathIds).slice(1);
    const resolvedFallbackPathLabels = fallbackPathLabels.length > 0
      ? fallbackPathLabels
      : toTextArray(fallbackNode?.pathLabels).slice(1);
    const topLevelIds = toTextArray(payload.topLevelIds).filter((id) => nodeById.has(id));
    const hierarchyLookup = buildMainHierarchyLabelLookup(nodeById, rootId);

    return {
      rootId,
      nodeById,
      topLevelIds,
      fallbackNodeId,
      fallbackPathIds: resolvedFallbackPathIds,
      fallbackPathLabels: resolvedFallbackPathLabels,
      labelLookup: hierarchyLookup.labelLookup,
      labelDescriptors: hierarchyLookup.labelDescriptors,
    };
  }

  function normalizeMainHierarchySourceDefinition(payload) {
    const rootTree = payload?.drug_classes;
    if (!rootTree || typeof rootTree !== "object") return null;

    const rootId = "drug_classes";
    const rootLabel = "Drug Classes";
    const nodeById = new Map();
    let sortOrder = 0;

    function walkChildren(childrenObject, parentId, depth, pathIds, pathLabels) {
      const childIds = [];
      const keys = Object.keys(childrenObject || {}).sort((a, b) => a.localeCompare(b));
      keys.forEach((key) => {
        const value = childrenObject[key];
        if (!value || typeof value !== "object") return;

        sortOrder += 1;
        const childId = `${parentId}.${key}`;
        const childLabel = sanitizeClassLabel(formatMainHierarchyKeyLabel(key));
        const childPathIds = [...pathIds, childId];
        const childPathLabels = [...pathLabels, childLabel];
        const grandChildren = walkChildren(
          value,
          childId,
          depth + 1,
          childPathIds,
          childPathLabels
        );

        nodeById.set(childId, {
          id: childId,
          key,
          label: childLabel,
          parentId,
          depth,
          sortOrder,
          pathIds: childPathIds,
          pathLabels: childPathLabels,
          children: grandChildren,
        });

        childIds.push(childId);
      });
      return childIds;
    }

    const topLevelIds = walkChildren(rootTree, rootId, 1, [rootId], [rootLabel]);
    nodeById.set(rootId, {
      id: rootId,
      key: "drug_classes",
      label: rootLabel,
      parentId: "",
      depth: 0,
      sortOrder: 0,
      pathIds: [rootId],
      pathLabels: [rootLabel],
      children: topLevelIds,
    });

    const fallbackNodeId = nodeById.has("drug_classes.other_classes.unmapped")
      ? "drug_classes.other_classes.unmapped"
      : nodeById.has("drug_classes.other_classes")
        ? "drug_classes.other_classes"
        : topLevelIds[0] || rootId;
    const fallbackNode = nodeById.get(fallbackNodeId);
    const hierarchyLookup = buildMainHierarchyLabelLookup(nodeById, rootId);

    return {
      rootId,
      nodeById,
      topLevelIds,
      fallbackNodeId,
      fallbackPathIds: toTextArray(fallbackNode?.pathIds).slice(1),
      fallbackPathLabels: toTextArray(fallbackNode?.pathLabels).slice(1),
      labelLookup: hierarchyLookup.labelLookup,
      labelDescriptors: hierarchyLookup.labelDescriptors,
    };
  }

  function buildMainHierarchyLabelLookup(nodeById, rootId = "") {
    const winnerByNorm = new Map();
    const descriptorByKey = new Map();

    nodeById.forEach((node) => {
      const nodeId = cleanText(node?.id);
      if (!nodeId || (rootId && nodeId === rootId)) return;

      const depth = Number.isFinite(node?.depth) ? Number(node.depth) : 0;
      const labels = [
        sanitizeClassLabel(node?.label),
        sanitizeClassLabel(formatMainHierarchyKeyLabel(node?.key)),
      ].filter(Boolean);

      labels.forEach((label) => {
        const normalizedLabel = normalizeSearch(label);
        if (!normalizedLabel) return;

        const existing = winnerByNorm.get(normalizedLabel);
        if (!existing || depth > existing.depth) {
          winnerByNorm.set(normalizedLabel, { label, depth });
        }

        const descriptorKey = `${normalizedLabel}|${depth}`;
        if (!descriptorByKey.has(descriptorKey)) {
          descriptorByKey.set(descriptorKey, { label, depth });
        }
      });
    });

    const labelLookup = new Map();
    winnerByNorm.forEach((payload, key) => {
      labelLookup.set(key, payload.label);
    });

    const labelDescriptors = Array.from(descriptorByKey.values()).sort((a, b) => {
      const depthDiff = (Number(b.depth) || 0) - (Number(a.depth) || 0);
      if (depthDiff !== 0) return depthDiff;
      return cleanText(a.label).localeCompare(cleanText(b.label));
    });

    return {
      labelLookup,
      labelDescriptors,
    };
  }

  function formatMainHierarchyKeyLabel(value) {
    const raw = cleanText(value)
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return "";

    const tokenOverrides = {
      enac: "ENaC",
      pcsk9: "PCSK9",
      rnai: "RNAi",
      atp: "ATP",
      cgrp: "CGRP",
      cox: "COX",
      nsaid: "NSAID",
      nsaids: "NSAIDs",
      no: "NO",
      tpa: "tPA",
    };

    const tokens = raw.split(" ").map((token) => {
      const normalizedToken = token.toLowerCase();
      if (tokenOverrides[normalizedToken]) {
        return tokenOverrides[normalizedToken];
      }
      if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(token)) {
        return token.toUpperCase();
      }
      if (/^[0-9]+[a-z]+$/i.test(token) || /^[a-z]+[0-9]+$/i.test(token)) {
        return token.toUpperCase();
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    });

    return tokens.join(" ");
  }

  function normalizeMainHierarchyMapping(payload, mainHierarchyIndex) {
    const mappingByMedicationId = new Map();
    if (!payload || typeof payload !== "object") {
      return mappingByMedicationId;
    }

    const sourceByMedicationId = payload.byMedicationId && typeof payload.byMedicationId === "object"
      ? Object.values(payload.byMedicationId)
      : [];
    const sourceMappings = Array.isArray(payload.mappings) ? payload.mappings : [];
    const entries = sourceByMedicationId.length > 0 ? sourceByMedicationId : sourceMappings;

    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const medicationId = cleanText(entry.medicationId);
      const classNodeId = cleanText(entry.classNodeId);
      if (!medicationId || !classNodeId) return;
      if (mainHierarchyIndex?.nodeById instanceof Map && !mainHierarchyIndex.nodeById.has(classNodeId)) {
        return;
      }
      const classPathIds = stripMainHierarchyRootFromPathIds(
        uniq(toTextArray(entry.classPathIds).map(cleanText).filter(Boolean)),
        mainHierarchyIndex
      );
      const classPathLabels = stripMainHierarchyRootFromPathLabels(
        uniq(toTextArray(entry.classPathLabels).map(sanitizeClassLabel).filter(Boolean)),
        mainHierarchyIndex
      );
      mappingByMedicationId.set(medicationId, {
        medicationId,
        classNodeId,
        classPathIds,
        classPathLabels,
        sourceKind: cleanText(entry.sourceKind),
        sourceLabel: cleanText(entry.sourceLabel),
        matchType: cleanText(entry.matchType),
        matchNote: cleanText(entry.matchNote),
        score: Number.isFinite(entry.score) ? Number(entry.score) : 0,
      });
    });

    return mappingByMedicationId;
  }

  function stripMainHierarchyRootFromPathIds(pathIds, mainHierarchyIndex) {
    const values = Array.isArray(pathIds) ? pathIds.slice() : [];
    const rootId = cleanText(mainHierarchyIndex?.rootId);
    if (rootId && values[0] === rootId) {
      values.shift();
    }
    return values;
  }

  function stripMainHierarchyRootFromPathLabels(pathLabels, mainHierarchyIndex) {
    const values = Array.isArray(pathLabels) ? pathLabels.slice() : [];
    const rootLabel = sanitizeClassLabel(mainHierarchyIndex?.nodeById?.get(mainHierarchyIndex?.rootId)?.label);
    if (rootLabel && values[0] === rootLabel) {
      values.shift();
    }
    return values;
  }

  function normalizeMainHierarchyMappingReport(payload) {
    if (!payload || typeof payload !== "object") return null;
    const counts = payload.counts && typeof payload.counts === "object"
      ? payload.counts
      : {};
    const topUnmapped = Array.isArray(payload.topUnmappedSourceLabels)
      ? payload.topUnmappedSourceLabels
      : [];
    return {
      counts: {
        medicationsTotal: Number.isFinite(counts.medicationsTotal) ? Number(counts.medicationsTotal) : 0,
        medicationsMapped: Number.isFinite(counts.medicationsMapped) ? Number(counts.medicationsMapped) : 0,
        medicationsUnmapped: Number.isFinite(counts.medicationsUnmapped) ? Number(counts.medicationsUnmapped) : 0,
        unmappedMedicationRatio: Number.isFinite(counts.unmappedMedicationRatio)
          ? Number(counts.unmappedMedicationRatio)
          : 0,
      },
      topUnmappedSourceLabels: topUnmapped,
      warnings: payload.warnings && typeof payload.warnings === "object"
        ? payload.warnings
        : {},
    };
  }

  function shouldEnableMainHierarchyClassSystem(mainHierarchyArtifacts) {
    if (!CONFIG.useMainHierarchyClassSystem) return false;
    const indexReady = Boolean(mainHierarchyArtifacts?.index && mainHierarchyArtifacts.index.nodeById instanceof Map);
    const mappingReady = Boolean(
      mainHierarchyArtifacts?.mappingByMedicationId instanceof Map
      && mainHierarchyArtifacts.mappingByMedicationId.size > 0
    );
    return indexReady && mappingReady;
  }

  function maybeWarnOnMainHierarchyMappingQuality(mappingReport) {
    if (!mappingReport || typeof mappingReport !== "object") return;
    const unmappedRatio = Number(mappingReport?.counts?.unmappedMedicationRatio) || 0;
    const topUnmappedCount = Number(mappingReport?.topUnmappedSourceLabels?.[0]?.count) || 0;
    if (
      unmappedRatio > CONFIG.warnUnmappedMedicationRatio
      || topUnmappedCount > CONFIG.warnTopUnmappedLabelFrequency
    ) {
      console.warn(
        "Main hierarchy mapping quality warnings:",
        {
          unmappedMedicationRatio: unmappedRatio,
          topUnmappedLabelCount: topUnmappedCount,
          thresholds: {
            unmappedMedicationRatio: CONFIG.warnUnmappedMedicationRatio,
            topUnmappedLabelFrequency: CONFIG.warnTopUnmappedLabelFrequency,
          },
        }
      );
    }
  }

  function normalizeClassTaxonomyIndex(payload) {
    const entries = Array.isArray(payload?.primaries) ? payload.primaries : [];
    const primaries = [];
    const labelMap = new Map();
    const subclassToPrimaries = new Map();
    const primarySortByKey = new Map();
    const subclassSortByPrimary = new Map();
    const subclassesByPrimary = new Map();
    const seenPrimaries = new Set();
    const fallbackPayload = payload?.fallback && typeof payload.fallback === "object"
      ? payload.fallback
      : {};
    const fallback = {
      primaryClass: sanitizeClassLabel(fallbackPayload.primaryClass) || CONFIG.uncategorizedClassLabel,
      slug: cleanText(fallbackPayload.slug) || makeStableId(CONFIG.uncategorizedClassLabel),
      subclass: sanitizeClassLabel(fallbackPayload.subclass) || "Unmapped",
    };

    entries.forEach((entry) => {
      const primaryClass = sanitizeClassLabel(entry?.primaryClass);
      if (!primaryClass) return;

      const primaryKey = normalizeSearch(primaryClass);
      if (!primaryKey || seenPrimaries.has(primaryKey)) return;

      const subclasses = uniq(toTextArray(entry?.subclasses))
        .map((item) => sanitizeClassLabel(item))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      if (subclasses.length === 0) return;

      const primarySortIndex = primaries.length;
      seenPrimaries.add(primaryKey);
      primarySortByKey.set(primaryKey, primarySortIndex);
      primaries.push({
        primaryClass,
        slug: cleanText(entry?.slug) || makeStableId(primaryClass),
        subclasses,
        sortIndex: primarySortIndex,
      });

      if (!labelMap.has(primaryKey)) {
        labelMap.set(primaryKey, primaryClass);
      }
      if (!subclassToPrimaries.has(primaryKey)) {
        subclassToPrimaries.set(primaryKey, []);
      }
      subclassToPrimaries.get(primaryKey).push({
        primaryClass,
        subclass: primaryClass,
      });

      const subclassSortMap = new Map();
      const subclassSet = new Set();

      subclasses.forEach((label) => {
        const key = normalizeSearch(label);
        if (!key) return;

        subclassSortMap.set(key, subclassSortMap.size);
        subclassSet.add(key);
        if (!labelMap.has(key)) labelMap.set(key, label);

        if (!subclassToPrimaries.has(key)) {
          subclassToPrimaries.set(key, []);
        }
        subclassToPrimaries.get(key).push({
          primaryClass,
          subclass: label,
        });
      });

      subclassSortByPrimary.set(primaryKey, subclassSortMap);
      subclassesByPrimary.set(primaryKey, subclassSet);
    });

    return {
      primaries,
      labelMap,
      subclassToPrimaries,
      fallback,
      primarySortByKey,
      subclassSortByPrimary,
      subclassesByPrimary,
    };
  }

  function applyFiltersAndRender() {
    const q = normalizeSearch(STATE.query);
    const classFilterClassSet = STATE.classFilterClassSet;
    const routeFilter = STATE.routeFilter;

    STATE.filtered = STATE.medications.filter((medication) => {
      if (classFilterClassSet && !hasClassTagMatch(classFilterClassSet, getMedicationFilterTags(medication))) {
        return false;
      }
      if (routeFilter && !medication.routes.includes(routeFilter)) return false;
      if (q && !medication.searchBlob.includes(q)) return false;
      return true;
    });

    if (q) {
      STATE.filtered.sort((a, b) => compareByRelevance(a, b, q));
    } else {
      STATE.filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    STATE.groupingIndex = buildGroupingIndex(STATE.filtered, Boolean(q));
    syncGroupingStateAfterFilter();

    if (!STATE.filtered.some((medication) => medication.id === STATE.selectedId)) {
      STATE.selectedId = null;
      closeMobileDetailPanel();
    }

    renderResultCount();
    renderCards();
    renderDetail();
  }

  function hasClassTagMatch(classFilterClassSet, classTags) {
    if (!(classFilterClassSet instanceof Set) || classFilterClassSet.size === 0) return true;
    const tags = Array.isArray(classTags) ? classTags : [];
    return tags.some((tag) => classFilterClassSet.has(tag));
  }

  function getMedicationFilterTags(medication) {
    if (!medication || typeof medication !== "object") return [];
    if (STATE.classFilterType === CLASS_FILTER_TYPE.USE_CATEGORY) {
      return Array.isArray(medication.useCategoryTags) ? medication.useCategoryTags : [];
    }
    if (isMainHierarchyClassSystemActive()) {
      return Array.isArray(medication.classPathIds) ? medication.classPathIds : [];
    }
    return Array.isArray(medication.classTags) ? medication.classTags : [];
  }

  function compareByRelevance(a, b, query) {
    const aScore = computeRelevanceScore(a, query);
    const bScore = computeRelevanceScore(b, query);

    if (aScore !== bScore) {
      return bScore - aScore;
    }

    return a.name.localeCompare(b.name);
  }

  function computeRelevanceScore(medication, query) {
    const w = CONFIG.relevanceWeights;
    let score = 0;

    if (medication.nameNorm === query) {
      score = Math.max(score, w.exactName);
    }

    if (medication.nameNorm.startsWith(query)) {
      score = Math.max(score, w.namePrefix);
    }

    if (
      medication.aliasesNorm.some((value) => value.startsWith(query)) ||
      medication.brandExamplesNorm.some((value) => value.startsWith(query))
    ) {
      score = Math.max(score, w.aliasBrandPrefix);
    }

    if (medication.nameNorm.includes(query)) {
      score = Math.max(score, w.nameContains);
    }

    if (
      medication.specificClassLabelNorm.includes(query)
      || medication.displayClassLabelNorm.includes(query)
      || medication.drugClassNorm.includes(query)
    ) {
      score = Math.max(score, w.classContains);
    }

    if (
      medication.moaNorm.includes(query) ||
      medication.indicationsNorm.some((value) => value.includes(query))
    ) {
      score = Math.max(score, w.indicationMoaContains);
    }

    if (medication.otherFieldsNorm.some((value) => value.includes(query))) {
      score = Math.max(score, w.otherFieldsContains);
    }

    return score;
  }

  function populateClassFilter() {
    const { root, byId } = buildClassFilterTree(STATE.medications);
    STATE.classTreeRoot = root;
    STATE.classTreeById = byId;

    if (STATE.classFilterNodeId && STATE.classTreeById.has(STATE.classFilterNodeId)) {
      const currentNode = STATE.classTreeById.get(STATE.classFilterNodeId);
      applyClassFilterNode(currentNode, { rerender: false });
    } else {
      resetClassFilter({ rerender: false });
    }

    syncClassTreeTrigger();
    renderClassTreeColumns();
  }

  function buildClassFilterTree(medications) {
    if (STATE.classFilterType === CLASS_FILTER_TYPE.USE_CATEGORY) {
      return buildUseCategoryFilterTree(medications);
    }

    if (isMainHierarchyClassSystemActive()) {
      return buildClassFilterTreeFromMainHierarchy(medications, STATE.mainHierarchyIndex);
    }

    if (hasActiveClassTaxonomy()) {
      return buildClassFilterTreeFromTaxonomy(medications, STATE.classTaxonomy);
    }

    let nodeSequence = 0;
    const root = createClassFilterNode("class-tree-root", "All classes", null);

    medications.forEach((medication, index) => {
      const medicationId = cleanText(medication.id) || `med-${index + 1}`;
      const classValue = cleanText(medication.drugClass) || CONFIG.uncategorizedClassLabel;
      const path = buildClassFilterPath(medication, classValue);

      let node = root;
      node.classSet.add(classValue);
      node.medicationSet.add(medicationId);

      path.forEach((segment) => {
        const label = cleanText(segment) || CONFIG.uncategorizedClassLabel;
        const lookupKey = normalizeSearch(label);
        if (!node.childMap.has(lookupKey)) {
          nodeSequence += 1;
          const childId = `class-tree-${nodeSequence}`;
          node.childMap.set(lookupKey, createClassFilterNode(childId, label, node.id));
        }

        const child = node.childMap.get(lookupKey);
        node = child;
        node.classSet.add(classValue);
        node.medicationSet.add(medicationId);
      });
    });

    const byId = new Map();

    function finalize(node) {
      node.children = Array.from(node.childMap.values()).sort(compareClassFilterNodes);
      node.classValues = Array.from(node.classSet.values());
      node.medicationCount = node.medicationSet.size;
      byId.set(node.id, node);
      node.children.forEach(finalize);
    }

    finalize(root);
    return { root, byId };
  }

  function buildClassFilterTreeFromMainHierarchy(medications, mainHierarchyIndex) {
    const rootLabel = "All primary classes";
    const root = createClassFilterNode("class-tree-root", rootLabel, null, 0);
    const byId = new Map();
    const idByNodeId = new Map();
    let nodeSequence = 0;

    const medicationSetByClassNodeId = new Map();
    medications.forEach((medication, index) => {
      const medicationId = cleanText(medication.id) || `med-${index + 1}`;
      root.medicationSet.add(medicationId);

      const classPathIds = Array.isArray(medication.classPathIds) && medication.classPathIds.length > 0
        ? medication.classPathIds
        : toTextArray(mainHierarchyIndex?.fallbackPathIds).filter(Boolean);
      classPathIds.forEach((classNodeId) => {
        if (!classNodeId) return;
        if (!medicationSetByClassNodeId.has(classNodeId)) {
          medicationSetByClassNodeId.set(classNodeId, new Set());
        }
        medicationSetByClassNodeId.get(classNodeId).add(medicationId);
      });
    });

    const topLevelIds = Array.isArray(mainHierarchyIndex?.topLevelIds)
      ? mainHierarchyIndex.topLevelIds
      : [];

    function buildNode(mainNodeId, parentTreeNode) {
      const mainNode = mainHierarchyIndex?.nodeById instanceof Map
        ? mainHierarchyIndex.nodeById.get(mainNodeId)
        : null;
      if (!mainNode) return null;

      const medicationSet = medicationSetByClassNodeId.get(mainNodeId);
      const medicationCount = medicationSet instanceof Set ? medicationSet.size : 0;
      if (medicationCount === 0) return null;

      nodeSequence += 1;
      const treeNode = createClassFilterNode(
        `class-tree-${nodeSequence}`,
        cleanText(mainNode.label) || CONFIG.uncategorizedClassLabel,
        parentTreeNode.id,
        Number.isFinite(mainNode.sortOrder) ? mainNode.sortOrder : Number.POSITIVE_INFINITY
      );
      treeNode.sourceNodeId = mainNodeId;
      treeNode.classSet.add(mainNodeId);
      medicationSet.forEach((medicationId) => treeNode.medicationSet.add(medicationId));

      const childIds = Array.isArray(mainNode.children) ? mainNode.children : [];
      childIds.forEach((childMainNodeId) => {
        const childTreeNode = buildNode(cleanText(childMainNodeId), treeNode);
        if (!childTreeNode) return;
        treeNode.childMap.set(`path-${childTreeNode.sourceNodeId}`, childTreeNode);
      });

      parentTreeNode.childMap.set(`path-${mainNodeId}`, treeNode);
      idByNodeId.set(mainNodeId, treeNode.id);
      return treeNode;
    }

    topLevelIds.forEach((topLevelId) => {
      buildNode(topLevelId, root);
    });

    function finalize(node) {
      node.children = Array.from(node.childMap.values()).sort(compareClassFilterNodes);
      node.children.forEach((child) => {
        finalize(child);
        child.classSet.forEach((value) => node.classSet.add(value));
        child.medicationSet.forEach((value) => node.medicationSet.add(value));
      });
      node.classValues = Array.from(node.classSet.values());
      node.medicationCount = node.medicationSet.size;
      byId.set(node.id, node);
    }

    finalize(root);
    return { root, byId, idByNodeId };
  }

  function buildUseCategoryFilterTree(medications) {
    let nodeSequence = 0;
    const root = createClassFilterNode("class-tree-root", "All use categories", null, 0);
    const byId = new Map();
    const categoryNodes = new Map();
    const sortOrder = new Map(
      USE_CATEGORY_RULES.map((rule, index) => [normalizeSearch(rule.label), index])
    );

    medications.forEach((medication, index) => {
      const medicationId = cleanText(medication.id) || `med-${index + 1}`;
      root.medicationSet.add(medicationId);

      const tags = Array.isArray(medication.useCategoryTags) ? medication.useCategoryTags : [];
      tags.forEach((tag) => {
        const label = cleanText(tag);
        if (!label) return;
        const key = normalizeSearch(label);
        if (!key) return;

        if (!categoryNodes.has(key)) {
          nodeSequence += 1;
          const sortIndex = Number.isFinite(sortOrder.get(key))
            ? sortOrder.get(key)
            : Number.POSITIVE_INFINITY;
          const node = createClassFilterNode(`class-tree-${nodeSequence}`, label, root.id, sortIndex);
          categoryNodes.set(key, node);
          root.childMap.set(`category-${key}`, node);
        }

        const categoryNode = categoryNodes.get(key);
        categoryNode.classSet.add(label);
        categoryNode.medicationSet.add(medicationId);
        root.classSet.add(label);
      });
    });

    function finalize(node) {
      node.children = Array.from(node.childMap.values()).sort(compareClassFilterNodes);
      node.classValues = Array.from(node.classSet.values());
      node.medicationCount = node.medicationSet.size;
      byId.set(node.id, node);
      node.children.forEach(finalize);
    }

    finalize(root);
    return { root, byId };
  }

  function hasActiveClassTaxonomy() {
    if (STATE.classFilterType !== CLASS_FILTER_TYPE.DRUG_CLASS) return false;
    if (isMainHierarchyClassSystemActive()) return false;
    return Boolean(
      STATE.classTaxonomy
      && Array.isArray(STATE.classTaxonomy.primaries)
      && STATE.classTaxonomy.primaries.length > 0
    );
  }

  function isMainHierarchyClassSystemActive() {
    if (STATE.classFilterType !== CLASS_FILTER_TYPE.DRUG_CLASS) return false;
    if (!STATE.mainHierarchyEnabled) return false;
    if (!STATE.mainHierarchyIndex || !(STATE.mainHierarchyIndex.nodeById instanceof Map)) return false;
    return true;
  }

  function buildClassFilterTreeFromTaxonomy(medications, taxonomy) {
    let nodeSequence = 0;
    const root = createClassFilterNode("class-tree-root", "All classes", null, 0);
    const byId = new Map();
    const nodeLookup = new Map();
    const fallback = taxonomy?.fallback && typeof taxonomy.fallback === "object"
      ? taxonomy.fallback
      : null;
    const fallbackPath = [
      cleanText(fallback?.primaryClass) || CONFIG.uncategorizedClassLabel,
      cleanText(fallback?.subclass) || "Unmapped",
    ];

    medications.forEach((medication, index) => {
      const medicationId = cleanText(medication.id) || `med-${index + 1}`;
      root.medicationSet.add(medicationId);
      const pathLevels = getClassLevelsFromPath(
        Array.isArray(medication.classPath) && medication.classPath.length > 0
          ? medication.classPath
          : fallbackPath,
        fallbackPath[0]
      );
      const path = pathLevels.classPath;
      if (path.length === 0) return;

      path.forEach((label) => root.classSet.add(label));

      let node = root;
      const primaryLabel = path[0];
      for (let depth = 0; depth < path.length; depth += 1) {
        const label = cleanText(path[depth]);
        if (!label) continue;

        const labelKey = normalizeSearch(label);
        if (!labelKey) continue;

        const lookupKey = `${node.id}|${labelKey}`;
        if (!nodeLookup.has(lookupKey)) {
          nodeSequence += 1;
          const childNode = createClassFilterNode(
            `class-tree-${nodeSequence}`,
            label,
            node.id,
            getClassTreeNodeSortIndex(taxonomy, primaryLabel, label, depth)
          );
          node.childMap.set(`path-${labelKey}`, childNode);
          nodeLookup.set(lookupKey, childNode);
        }

        const childNode = nodeLookup.get(lookupKey);
        childNode.medicationSet.add(medicationId);
        path.slice(depth).forEach((segment) => childNode.classSet.add(segment));
        node = childNode;
      }
    });

    function finalize(node) {
      node.children = Array.from(node.childMap.values()).sort(compareClassFilterNodes);
      node.classValues = Array.from(node.classSet.values());
      node.medicationCount = node.medicationSet.size;
      byId.set(node.id, node);
      node.children.forEach(finalize);
    }

    finalize(root);
    return { root, byId };
  }

  function compareClassFilterNodes(a, b) {
    const aOrder = Number.isFinite(a.sortIndex) ? a.sortIndex : Number.POSITIVE_INFINITY;
    const bOrder = Number.isFinite(b.sortIndex) ? b.sortIndex : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.label.localeCompare(b.label);
  }

  function getClassTreeNodeSortIndex(taxonomy, primaryLabel, label, depth) {
    if (depth === 0) {
      return getTaxonomyPrimarySortIndex(taxonomy, primaryLabel);
    }
    return getTaxonomySubclassSortIndex(taxonomy, primaryLabel, label);
  }

  function getTaxonomyPrimarySortIndex(taxonomy, primaryLabel) {
    const primarySortByKey = taxonomy?.primarySortByKey;
    if (!(primarySortByKey instanceof Map)) {
      return Number.POSITIVE_INFINITY;
    }
    const primaryKey = normalizeSearch(primaryLabel);
    return primarySortByKey.has(primaryKey)
      ? primarySortByKey.get(primaryKey)
      : Number.POSITIVE_INFINITY;
  }

  function getTaxonomySubclassSortIndex(taxonomy, primaryLabel, subclassLabel) {
    const subclassSortByPrimary = taxonomy?.subclassSortByPrimary;
    if (!(subclassSortByPrimary instanceof Map)) {
      return Number.POSITIVE_INFINITY;
    }

    const primaryKey = normalizeSearch(primaryLabel);
    const subclassKey = normalizeSearch(subclassLabel);
    if (!primaryKey || !subclassKey) return Number.POSITIVE_INFINITY;

    const subclassSortMap = subclassSortByPrimary.get(primaryKey);
    if (!(subclassSortMap instanceof Map)) {
      return Number.POSITIVE_INFINITY;
    }

    return subclassSortMap.has(subclassKey)
      ? subclassSortMap.get(subclassKey)
      : Number.POSITIVE_INFINITY;
  }

  function buildClassFilterPath(medication, classValue) {
    const sourcePath = Array.isArray(medication.classPath)
      ? medication.classPath
        .map((segment) => cleanText(segment))
        .filter((segment) => segment && !isAlphabeticalClassBucketLabel(segment))
      : [];

    const rawTop = sourcePath[0] || classValue;
    const normalizedClass = normalizeSearch(classValue);
    const topLabel = rawTop;

    const segments = [topLabel];

    // Preserve one intermediate hierarchy level when available.
    if (sourcePath.length > 1) {
      const mid = sourcePath[1];
      const normalizedMid = normalizeSearch(mid);
      if (
        normalizedMid
        && normalizedMid !== normalizeSearch(topLabel)
        && normalizedMid !== normalizedClass
      ) {
        segments.push(mid);
      }
    }

    if (normalizeSearch(segments[segments.length - 1]) !== normalizedClass) {
      segments.push(classValue);
    }

    return dedupeClassPath(segments);
  }

  function createClassFilterNode(id, label, parentId, sortIndex = Number.POSITIVE_INFINITY) {
    return {
      id,
      label,
      parentId,
      sortIndex,
      childMap: new Map(),
      children: [],
      classSet: new Set(),
      medicationSet: new Set(),
      classValues: [],
      medicationCount: 0,
    };
  }

  function resetClassFilter(options = {}) {
    const { rerender = true } = options;
    STATE.classFilterNodeId = "";
    STATE.classFilterLabel = getDefaultClassFilterLabel();
    STATE.classFilterClassSet = null;
    STATE.classTreePath = [];
    syncClassTreeTrigger();

    if (rerender) {
      renderClassTreeColumns();
    }
  }

  function applyClassFilterNode(node, options = {}) {
    const { rerender = true } = options;
    if (!node) {
      resetClassFilter({ rerender });
      return;
    }

    STATE.classFilterNodeId = node.id;
    STATE.classFilterLabel = buildClassFilterSelectionLabel(node);
    STATE.classFilterClassSet = new Set(node.classValues);
    STATE.classTreePath = getClassTreePath(node.id);
    syncClassTreeTrigger();

    if (rerender) {
      renderClassTreeColumns();
    }
  }

  function getClassTreePath(nodeId) {
    const path = [];
    let current = STATE.classTreeById.get(nodeId);
    while (current && current.parentId) {
      path.unshift(current.id);
      current = STATE.classTreeById.get(current.parentId);
    }
    return path;
  }

  function syncClassTreeTrigger() {
    if (!EL.classTreeTrigger || !EL.classTreeTriggerText) return;
    const meta = getClassFilterTypeMeta();
    const label = STATE.classFilterLabel || getDefaultClassFilterLabel();
    EL.classTreeTriggerText.textContent = label;
    EL.classTreeTriggerText.title = label;
    EL.classTreeTrigger.setAttribute("aria-label", `${meta.ariaPrefix}: ${label}`);
    if (EL.classTreeColumns) {
      EL.classTreeColumns.setAttribute("aria-label", meta.treeAriaLabel);
    }
    EL.classTreeTrigger.classList.toggle("is-filtered", Boolean(STATE.classFilterNodeId));
  }

  function getDefaultClassFilterLabel() {
    return getClassFilterTypeMeta().defaultLabel;
  }

  function getClassFilterTypeMeta() {
    if (STATE.classFilterType === CLASS_FILTER_TYPE.USE_CATEGORY) {
      return {
        controlLabel: "Use Category",
        defaultLabel: "All use categories",
        allOptionLabel: "All use categories",
        rootColumnTitle: "Use categories",
        ariaPrefix: "Use category filter",
        treeAriaLabel: "Use category filter tree",
      };
    }

    const hasHierarchy = isMainHierarchyClassSystemActive() || hasActiveClassTaxonomy();
    return {
      controlLabel: "Drug Class",
      defaultLabel: hasHierarchy ? "All primary classes" : "All classes",
      allOptionLabel: hasHierarchy ? "All primary classes" : "All classes",
      rootColumnTitle: hasHierarchy ? "Primary classes" : "All classes",
      ariaPrefix: "Drug class filter",
      treeAriaLabel: "Drug class filter tree",
    };
  }

  function buildClassFilterSelectionLabel(node) {
    if (!node) return getDefaultClassFilterLabel();
    const pathNodeIds = getClassTreePath(node.id);
    const labels = pathNodeIds
      .map((id) => cleanText(STATE.classTreeById.get(id)?.label))
      .filter(Boolean);
    if (labels.length === 0) {
      return node.label || getDefaultClassFilterLabel();
    }
    return labels.join(" > ");
  }

  function hasHoverPointer() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function cancelClassTreeClose() {
    if (!classTreeCloseTimer) return;
    clearTimeout(classTreeCloseTimer);
    classTreeCloseTimer = null;
  }

  function scheduleClassTreeClose() {
    cancelClassTreeClose();
    classTreeCloseTimer = setTimeout(() => {
      classTreeCloseTimer = null;
      closeClassTreeMenu();
    }, CONFIG.classTreeHoverCloseDelayMs);
  }

  function openClassTreeMenu(options = {}) {
    const { source = "click" } = options;
    if (!EL.classTreeMenu || !EL.classTreeTrigger) return;
    cancelClassTreeClose();
    if (STATE.classTreeMenuOpen && source === "hover" && !STATE.classTreeOpenedByHover) {
      return;
    }
    STATE.classTreeMenuOpen = true;
    STATE.classTreeOpenedByHover = source === "hover";
    EL.classTreeMenu.hidden = false;
    setClassTreeMenuVisualState(true);
    EL.classTreeTrigger.setAttribute("aria-expanded", "true");
    if (EL.classTreeControl) {
      EL.classTreeControl.classList.add("is-open");
    }
    renderClassTreeColumns();
  }

  function closeClassTreeMenu() {
    if (!EL.classTreeMenu || !EL.classTreeTrigger) return;
    cancelClassTreeClose();
    STATE.classTreeMenuOpen = false;
    STATE.classTreeOpenedByHover = false;
    EL.classTreeMenu.hidden = true;
    setClassTreeMenuVisualState(false);
    EL.classTreeTrigger.setAttribute("aria-expanded", "false");
    if (EL.classTreeControl) {
      EL.classTreeControl.classList.remove("is-open");
    }
  }

  function renderClassTreeColumns() {
    if (!EL.classTreeColumns) return;

    const previousScrollTopByColumnKey = new Map();
    EL.classTreeColumns.querySelectorAll(".class-tree-column").forEach((columnEl) => {
      const key = getClassTreeColumnKey(
        columnEl.dataset.depth,
        columnEl.dataset.parentId
      );
      if (!key) return;
      previousScrollTopByColumnKey.set(key, columnEl.scrollTop);
    });

    STATE.classTreeScrollSyncGuardByColumnKey.clear();
    EL.classTreeColumns.innerHTML = "";

    const root = STATE.classTreeRoot;
    if (!root) return;
    const classFilterMeta = getClassFilterTypeMeta();

    const validPath = [];
    let parent = root;
    for (const nodeId of STATE.classTreePath) {
      const candidate = STATE.classTreeById.get(nodeId);
      if (!candidate || candidate.parentId !== parent.id) break;
      validPath.push(candidate.id);
      parent = candidate;
    }
    STATE.classTreePath = validPath;

    const activePathIds = new Set(validPath);
    const columns = [{ depth: 0, parent: root, nodes: root.children }];

    let cursor = root;
    for (let depth = 0; depth < validPath.length; depth += 1) {
      const selectedId = validPath[depth];
      const selectedNode = STATE.classTreeById.get(selectedId);
      if (!selectedNode || selectedNode.parentId !== cursor.id) break;
      if (!selectedNode.children || selectedNode.children.length === 0) break;
      columns.push({ depth: depth + 1, parent: selectedNode, nodes: selectedNode.children });
      cursor = selectedNode;
    }

    const columnElements = [];

    columns.forEach((column) => {
      const columnEl = document.createElement("section");
      columnEl.className = "class-tree-column";
      columnEl.dataset.depth = String(column.depth);
      columnEl.dataset.parentId = cleanText(column.parent.id);
      columnEl.dataset.columnState = getClassTreeColumnState(column, validPath);
      columnEl.style.setProperty("--tree-column-offset", "0px");
      columnEl.style.setProperty("--tree-connector-top", "24px");

      const title = document.createElement("p");
      title.className = "class-tree-column__title";
      title.textContent = column.depth === 0 ? classFilterMeta.rootColumnTitle : column.parent.label;
      columnEl.appendChild(title);

      const list = document.createElement("div");
      list.className = "class-tree-list";

      if (column.depth === 0) {
        const allOption = document.createElement("button");
        allOption.type = "button";
        allOption.className = `class-tree-option${STATE.classFilterNodeId ? "" : " is-active"}`;
        allOption.dataset.action = "all";
        allOption.dataset.depth = "0";
        allOption.dataset.hasChildren = "false";
        allOption.dataset.branchParent = "false";
        allOption.setAttribute("role", "treeitem");
        allOption.setAttribute("aria-selected", String(!STATE.classFilterNodeId));

        const label = document.createElement("span");
        label.className = "class-tree-option__label";
        label.textContent = classFilterMeta.allOptionLabel;
        allOption.appendChild(label);

        const count = document.createElement("span");
        count.className = "class-tree-option__count";
        count.textContent = `${root.medicationCount}`;
        allOption.appendChild(count);

        list.appendChild(allOption);
      }

      column.nodes.forEach((node) => {
        const option = document.createElement("button");
        option.type = "button";
        option.dataset.action = "node";
        option.dataset.nodeId = node.id;
        option.dataset.depth = String(column.depth);
        option.setAttribute("role", "treeitem");
        option.setAttribute("aria-selected", String(node.id === STATE.classFilterNodeId));

        const isActive = node.id === STATE.classFilterNodeId;
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const supportsBranchStyling = column.depth >= CONFIG.classTreeBranchStartDepth;
        const isBranchParent = hasChildren && activePathIds.has(node.id);
        const isBranch = supportsBranchStyling && isBranchParent;
        option.className = `class-tree-option${isActive ? " is-active" : ""}${isBranch && !isActive ? " is-branch" : ""}${column.depth === 0 ? " is-primary" : " is-subclass"}`;
        option.dataset.hasChildren = hasChildren ? "true" : "false";
        option.dataset.branchParent = isBranchParent ? "true" : "false";

        const label = document.createElement("span");
        label.className = "class-tree-option__label";
        label.textContent = node.label;
        option.appendChild(label);

        const meta = document.createElement("span");
        meta.className = "class-tree-option__meta";

        const count = document.createElement("span");
        count.className = "class-tree-option__count";
        count.textContent = `${node.medicationCount}`;
        meta.appendChild(count);

        const shouldShowCaret = (
          hasChildren
          && (
            CONFIG.classTreeShowPrimaryCarets
            || column.depth >= CONFIG.classTreeBranchStartDepth
          )
        );
        if (shouldShowCaret) {
          const caret = document.createElement("span");
          caret.className = "class-tree-option__caret";
          caret.textContent = "›";
          meta.appendChild(caret);
        }

        option.appendChild(meta);
        list.appendChild(option);
      });

      columnEl.appendChild(list);
      EL.classTreeColumns.appendChild(columnEl);

      const columnKey = getClassTreeColumnKey(
        column.depth,
        column.parent.id
      );
      const priorScrollTop = previousScrollTopByColumnKey.get(columnKey);
      if (Number.isFinite(priorScrollTop) && priorScrollTop > 0) {
        STATE.classTreeScrollSyncGuardByColumnKey.set(columnKey, {
          scrollTop: priorScrollTop,
          expiresAt: Date.now() + CONFIG.classTreeHoverResumeDelayMs,
        });
        columnEl.scrollTop = priorScrollTop;
      }

      columnElements.push(columnEl);
    });

    positionClassTreeColumns(columnElements, validPath);
  }

  function positionClassTreeColumns(columnElements, validPath) {
    if (!EL.classTreeColumns || !Array.isArray(columnElements) || columnElements.length === 0) return;

    columnElements.forEach((columnEl) => {
      columnEl.style.setProperty("--tree-column-offset", "0px");
      columnEl.style.setProperty("--tree-column-left", "0px");
      columnEl.style.setProperty("--tree-connector-top", "24px");
    });

    if (!Array.isArray(validPath) || validPath.length === 0) return;
    if (columnElements.length < 2) return;

    const containerRect = EL.classTreeColumns.getBoundingClientRect();
    const canAnchorToRow = Boolean(
      hasHoverPointer()
      && containerRect
      && containerRect.height > 0
    );
    const maxOffset = canAnchorToRow
      ? Math.max(0, containerRect.height - CONFIG.classTreeColumnMinVisibleHeightPx)
      : 0;
    const branchGapPx = Math.max(8, Number(CONFIG.classTreeColumnGapPx) || 12);
    const viewportPaddingPx = Math.max(0, Number(CONFIG.classTreeViewportPaddingPx) || 12);
    const minTopViewport = Math.max(0, Number(CONFIG.classTreeColumnMinTopPx) || viewportPaddingPx);
    const minBottomViewport = Math.max(0, Number(CONFIG.classTreeColumnMinBottomPx) || viewportPaddingPx);

    for (let depth = 1; depth < columnElements.length; depth += 1) {
      const parentNodeId = cleanText(validPath[depth - 1]);
      if (!parentNodeId) break;

      const parentColumn = columnElements[depth - 1];
      const currentColumn = columnElements[depth];
      const desiredLeft = parentColumn.offsetLeft + parentColumn.offsetWidth + branchGapPx;
      const currentWidth = currentColumn.offsetWidth || 320;
      const maxLeft = Math.max(
        0,
        window.innerWidth - currentWidth - containerRect.left - viewportPaddingPx
      );
      const leftOffset = Math.round(Math.max(0, Math.min(desiredLeft, maxLeft)));
      currentColumn.style.setProperty("--tree-column-left", `${leftOffset}px`);

      if (!canAnchorToRow) continue;

      const parentOptions = parentColumn.querySelectorAll(
        `.class-tree-option[data-action="node"][data-depth="${depth - 1}"]`
      );
      const parentOption = Array.from(parentOptions).find(
        (option) => cleanText(option.dataset.nodeId) === parentNodeId
      );
      if (!parentOption) continue;

      const parentRect = parentOption.getBoundingClientRect();
      const parentCenterOffset = (
        parentRect.top
        - containerRect.top
        + parentColumn.scrollTop
        + (parentRect.height / 2)
      );
      const rawOffset = parentCenterOffset - CONFIG.classTreeColumnAnchorOffsetPx;
      const currentHeight = currentColumn.offsetHeight || CONFIG.classTreeColumnMinVisibleHeightPx;
      const desiredTopViewport = containerRect.top + rawOffset;
      const maxTopViewport = Math.max(
        minTopViewport,
        window.innerHeight - currentHeight - minBottomViewport
      );
      const clampedTopViewport = Math.min(maxTopViewport, Math.max(minTopViewport, desiredTopViewport));
      const clampedOffset = Math.max(0, Math.min(maxOffset, clampedTopViewport - containerRect.top));

      currentColumn.style.setProperty(
        "--tree-column-offset",
        `${Math.round(clampedOffset)}px`
      );
      const connectorTop = Math.max(
        14,
        Math.min(currentHeight - 14, parentCenterOffset - clampedOffset)
      );
      currentColumn.style.setProperty(
        "--tree-connector-top",
        `${Math.round(connectorTop)}px`
      );
    }
  }

  function getClassTreeColumnState(column, validPath) {
    const depth = Number(column?.depth);
    const safeDepth = Number.isFinite(depth) && depth >= 0 ? depth : 0;
    if (safeDepth === 0) return "root";

    const parentId = cleanText(column?.parent?.id);
    const activeParentId = cleanText(validPath?.[safeDepth - 1]);
    if (parentId && activeParentId && parentId === activeParentId) {
      return "active-path";
    }

    return "sibling";
  }

  function getClassTreeColumnKey(depth, parentId) {
    const depthText = String(depth ?? "").trim();
    const parentText = cleanText(parentId);
    if (!depthText || !parentText) return "";
    return `${depthText}|${parentText}`;
  }

  function populateRouteFilter() {
    const presentRoutes = new Set(STATE.medications.flatMap((medication) => medication.routes));
    const routes = ROUTE_ENUM.filter((route) => presentRoutes.has(route));
    setSelectOptions(EL.routeFilter, [
      { value: "", label: "All routes" },
      ...routes.map((route) => ({ value: route, label: route })),
    ]);
  }

  function setSelectOptions(selectEl, options) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      selectEl.appendChild(option);
    });
  }

  function renderResultCount() {
    if (!EL.resultCount) return;
    const count = STATE.filtered.length;
    EL.resultCount.textContent = `${count} medication${count === 1 ? "" : "s"}`;
  }

  function renderCards() {
    if (!EL.resultsGrid) return;
    EL.resultsGrid.innerHTML = "";
    EL.resultsGrid.dataset.viewMode = STATE.viewMode;

    if (STATE.filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "results-empty";
      empty.textContent = CONFIG.emptyStateCopy;
      EL.resultsGrid.appendChild(empty);
      return;
    }

    if (!STATE.groupingIndex) return;

    const fragment = document.createDocumentFragment();
    if (STATE.viewMode === "structured") {
      renderStructuredGroups(STATE.groupingIndex, fragment);
    } else {
      renderCompactGroups(STATE.groupingIndex, fragment);
    }
    EL.resultsGrid.appendChild(fragment);
  }

  function buildGroupingIndex(medications, sortByRelevance) {
    if (STATE.classFilterType === CLASS_FILTER_TYPE.USE_CATEGORY) {
      return buildUseCategoryGroupingIndex(medications, sortByRelevance);
    }
    if (isMainHierarchyClassSystemActive()) {
      return buildDrugClassGroupingIndexFromMainHierarchy(medications, sortByRelevance);
    }
    if (hasActiveClassTaxonomy()) {
      return buildDrugClassGroupingIndexFromTaxonomy(medications, sortByRelevance);
    }
    return buildLegacyGroupingIndex(medications, sortByRelevance);
  }

  function buildLegacyGroupingIndex(medications, sortByRelevance) {
    const classMap = new Map();
    medications.forEach((medication, rank) => {
      const topLabel = medication.primaryClass
        || medication.classPath?.[0]
        || medication.drugClass
        || CONFIG.uncategorizedClassLabel;
      const subclassLabel = medication.displayClassLabel
        || getDisplayClassLabelFromPath(medication.classPath, medication.drugClass)
        || medication.drugClass
        || CONFIG.uncategorizedClassLabel;
      addMedicationToClassGroup(
        classMap,
        topLabel,
        subclassLabel,
        medication,
        rank
      );
    });

    return finalizeGroupingIndex(classMap, sortByRelevance);
  }

  function buildUseCategoryGroupingIndex(medications, sortByRelevance) {
    const classMap = new Map();
    medications.forEach((medication, rank) => {
      const tags = Array.isArray(medication.useCategoryTags) && medication.useCategoryTags.length > 0
        ? medication.useCategoryTags
        : ["Other Use Categories"];
      const seen = new Set();
      tags.forEach((tag, tagIndex) => {
        const label = cleanText(tag);
        if (!label) return;
        const key = normalizeSearch(label);
        if (!key || seen.has(key)) return;
        seen.add(key);
        addMedicationToClassGroup(
          classMap,
          label,
          label,
          medication,
          rank,
          tagIndex,
          0
        );
      });
    });

    return finalizeGroupingIndex(classMap, sortByRelevance);
  }

  function buildDrugClassGroupingIndexFromTaxonomy(medications, sortByRelevance) {
    const taxonomy = STATE.classTaxonomy;
    if (!taxonomy || !Array.isArray(taxonomy.primaries) || taxonomy.primaries.length === 0) {
      return buildLegacyGroupingIndex(medications, sortByRelevance);
    }

    const classMap = new Map();

    const fallback = taxonomy.fallback && typeof taxonomy.fallback === "object"
      ? taxonomy.fallback
      : null;
    const fallbackTopLabel = cleanText(fallback?.primaryClass) || CONFIG.uncategorizedClassLabel;
    const fallbackSubclassLabel = cleanText(fallback?.subclass) || "Unmapped";

    medications.forEach((medication, rank) => {
      const classPathLevels = getClassLevelsFromPath(
        Array.isArray(medication.classPath) && medication.classPath.length > 0
          ? medication.classPath
          : [fallbackTopLabel, fallbackSubclassLabel],
        fallbackTopLabel
      );

      const topLabel = cleanText(classPathLevels.primaryClass) || fallbackTopLabel;
      const subclassLabel = cleanText(medication.displayClassLabel)
        || cleanText(classPathLevels.displayClassLabel)
        || fallbackSubclassLabel;

      const classSortIndex = getTaxonomyPrimarySortIndex(taxonomy, topLabel);
      const subclassSortIndex = getTaxonomySubclassSortIndex(taxonomy, topLabel, subclassLabel);

      addMedicationToClassGroup(
        classMap,
        topLabel,
        subclassLabel,
        medication,
        rank,
        classSortIndex,
        subclassSortIndex
      );
    });

    return finalizeGroupingIndex(classMap, sortByRelevance);
  }

  function buildDrugClassGroupingIndexFromMainHierarchy(medications, sortByRelevance) {
    const mainHierarchyIndex = STATE.mainHierarchyIndex;
    if (!mainHierarchyIndex || !(mainHierarchyIndex.nodeById instanceof Map)) {
      return buildLegacyGroupingIndex(medications, sortByRelevance);
    }

    const classMap = new Map();
    const fallbackTopLabel = cleanText(mainHierarchyIndex?.fallbackPathLabels?.[0]) || CONFIG.uncategorizedClassLabel;
    const fallbackSubclassLabel = cleanText(mainHierarchyIndex?.fallbackPathLabels?.[1]) || "Unmapped";

    medications.forEach((medication, rank) => {
      const classPathLevels = getClassLevelsFromPath(
        Array.isArray(medication.classPath) && medication.classPath.length > 0
          ? medication.classPath
          : [fallbackTopLabel, fallbackSubclassLabel],
        fallbackTopLabel
      );
      const classPathIds = Array.isArray(medication.classPathIds) && medication.classPathIds.length > 0
        ? medication.classPathIds
        : toTextArray(mainHierarchyIndex.fallbackPathIds).filter(Boolean);

      const topLabel = cleanText(classPathLevels.primaryClass) || fallbackTopLabel;
      const subclassLabel = cleanText(medication.displayClassLabel)
        || cleanText(classPathLevels.displayClassLabel)
        || fallbackSubclassLabel;

      const primaryNodeId = cleanText(classPathIds[0]);
      const deepestNodeId = cleanText(medication.classNodeId) || cleanText(classPathIds[classPathIds.length - 1]);

      const classSortIndex = Number.isFinite(mainHierarchyIndex.nodeById.get(primaryNodeId)?.sortOrder)
        ? mainHierarchyIndex.nodeById.get(primaryNodeId).sortOrder
        : Number.POSITIVE_INFINITY;
      const subclassSortIndex = Number.isFinite(mainHierarchyIndex.nodeById.get(deepestNodeId)?.sortOrder)
        ? mainHierarchyIndex.nodeById.get(deepestNodeId).sortOrder
        : Number.POSITIVE_INFINITY;

      addMedicationToClassGroup(
        classMap,
        topLabel,
        subclassLabel,
        medication,
        rank,
        classSortIndex,
        subclassSortIndex
      );
    });

    return finalizeGroupingIndex(classMap, sortByRelevance);
  }

  function finalizeGroupingIndex(classMap, sortByRelevance) {
    const classes = Array.from(classMap.values())
      .filter((classGroup) => classGroup.medications.length > 0);

    classes.sort((a, b) => compareGroupEntries(a, b, sortByRelevance));
    classes.forEach((classGroup) => {
      classGroup.subclasses = Array.from(classGroup.subclassMap.values())
        .filter((subclass) => subclass.medications.length > 0)
        .sort((a, b) => compareGroupEntries(a, b, sortByRelevance));
      delete classGroup.subclassMap;
    });

    return {
      classes,
      sortByRelevance,
    };
  }

  function addMedicationToClassGroup(
    classMap,
    topLabel,
    subclassLabel,
    medication,
    rank,
    classSortIndex = Number.POSITIVE_INFINITY,
    subclassSortIndex = Number.POSITIVE_INFINITY
  ) {
    const classGroup = getOrCreateClassGroup(classMap, topLabel, classSortIndex);
    classGroup.medications.push(medication);
    classGroup.firstRank = Math.min(classGroup.firstRank, rank);

    const subclassGroup = getOrCreateSubclassGroup(classGroup, subclassLabel, subclassSortIndex);
    subclassGroup.medications.push(medication);
    subclassGroup.firstRank = Math.min(subclassGroup.firstRank, rank);
  }

  function getOrCreateClassGroup(classMap, label, sortIndex = Number.POSITIVE_INFINITY) {
    const topLabel = cleanText(label) || CONFIG.uncategorizedClassLabel;
    const classId = makeStableId(`class-${topLabel}`);
    if (!classMap.has(classId)) {
      classMap.set(classId, {
        id: classId,
        label: topLabel,
        medications: [],
        subclassMap: new Map(),
        firstRank: Number.POSITIVE_INFINITY,
        sortIndex,
      });
    } else if (Number.isFinite(sortIndex)) {
      const existing = classMap.get(classId);
      if (!Number.isFinite(existing.sortIndex) || sortIndex < existing.sortIndex) {
        existing.sortIndex = sortIndex;
      }
    }
    return classMap.get(classId);
  }

  function getOrCreateSubclassGroup(classGroup, label, sortIndex = Number.POSITIVE_INFINITY) {
    const subclassLabel = cleanText(label) || CONFIG.uncategorizedClassLabel;
    const subclassId = makeStableId(`subclass-${classGroup.label}-${subclassLabel}`);
    if (!classGroup.subclassMap.has(subclassId)) {
      classGroup.subclassMap.set(subclassId, {
        id: subclassId,
        label: subclassLabel,
        medications: [],
        firstRank: Number.POSITIVE_INFINITY,
        sortIndex,
      });
    } else if (Number.isFinite(sortIndex)) {
      const existing = classGroup.subclassMap.get(subclassId);
      if (!Number.isFinite(existing.sortIndex) || sortIndex < existing.sortIndex) {
        existing.sortIndex = sortIndex;
      }
    }
    return classGroup.subclassMap.get(subclassId);
  }

  function compareGroupEntries(a, b, sortByRelevance) {
    if (sortByRelevance && a.firstRank !== b.firstRank) {
      return a.firstRank - b.firstRank;
    }
    const aSortIndex = Number.isFinite(a.sortIndex) ? a.sortIndex : Number.POSITIVE_INFINITY;
    const bSortIndex = Number.isFinite(b.sortIndex) ? b.sortIndex : Number.POSITIVE_INFINITY;
    if (aSortIndex !== bSortIndex) {
      return aSortIndex - bSortIndex;
    }
    return a.label.localeCompare(b.label);
  }

  function syncGroupingStateAfterFilter() {
    const classes = STATE.groupingIndex?.classes || [];
    if (classes.length === 0) {
      STATE.expandedClassId = null;
      STATE.selectedSubclassByClass = {};
      STATE.expandedSubclassChipsByClass = {};
      return;
    }

    const classIds = new Set(classes.map((classGroup) => classGroup.id));
    if (!STATE.expandedClassId || !classIds.has(STATE.expandedClassId)) {
      STATE.expandedClassId = classes[0].id;
    }

    const nextSelection = {};
    classes.forEach((classGroup) => {
      const selectedSubclassId = STATE.selectedSubclassByClass[classGroup.id];
      const hasSelected = classGroup.subclasses.some((subclass) => subclass.id === selectedSubclassId);
      nextSelection[classGroup.id] = hasSelected
        ? selectedSubclassId
        : classGroup.subclasses[0]
          ? classGroup.subclasses[0].id
          : "";
    });

    STATE.selectedSubclassByClass = nextSelection;

    const nextExpandedSubclassChips = {};
    classes.forEach((classGroup) => {
      if (STATE.expandedSubclassChipsByClass[classGroup.id]) {
        nextExpandedSubclassChips[classGroup.id] = true;
      }
    });
    STATE.expandedSubclassChipsByClass = nextExpandedSubclassChips;
  }

  function renderCompactGroups(index, container) {
    index.classes.forEach((classGroup) => {
      const classSection = document.createElement("section");
      classSection.className = "class-block class-block--compact";
      classSection.dataset.classId = classGroup.id;

      const header = document.createElement("div");
      header.className = "class-block__header";

      const title = document.createElement("h3");
      title.className = "class-block__title";
      title.textContent = classGroup.label;
      header.appendChild(title);

      const count = document.createElement("span");
      count.className = "class-block__count";
      count.textContent = `${classGroup.medications.length}`;
      header.appendChild(count);

      classSection.appendChild(header);

      const body = document.createElement("div");
      body.className = "class-block__body";

      const selectedSubclassId = STATE.selectedSubclassByClass[classGroup.id];
      const selectedSubclass = classGroup.subclasses.find((subclass) => subclass.id === selectedSubclassId)
        || classGroup.subclasses[0];

      if (classGroup.subclasses.length > 1) {
        const visibleSubclasses = getVisibleCompactSubclasses(classGroup, selectedSubclass?.id);
        const chips = document.createElement("div");
        chips.className = "subclass-chips";
        visibleSubclasses.forEach((subclass) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = `subclass-chip${subclass.id === selectedSubclass?.id ? " is-active" : ""}`;
          chip.dataset.classId = classGroup.id;
          chip.dataset.subclassId = subclass.id;
          chip.setAttribute("aria-pressed", String(subclass.id === selectedSubclass?.id));
          chip.textContent = subclass.label;
          chips.appendChild(chip);
        });
        body.appendChild(chips);

        if (visibleSubclasses.length < classGroup.subclasses.length) {
          const revealButton = document.createElement("button");
          revealButton.type = "button";
          revealButton.className = "subclass-chip-toggle";
          revealButton.dataset.classId = classGroup.id;
          revealButton.setAttribute("aria-expanded", "false");
          revealButton.textContent = `Show ${classGroup.subclasses.length - visibleSubclasses.length} more`;
          body.appendChild(revealButton);
        } else if (classGroup.subclasses.length > CONFIG.compactSubclassChipLimit) {
          const collapseButton = document.createElement("button");
          collapseButton.type = "button";
          collapseButton.className = "subclass-chip-toggle";
          collapseButton.dataset.classId = classGroup.id;
          collapseButton.setAttribute("aria-expanded", "true");
          collapseButton.textContent = "Show less";
          body.appendChild(collapseButton);
        }
      }

      body.appendChild(makeCardsGrid(selectedSubclass ? selectedSubclass.medications : classGroup.medications));
      classSection.appendChild(body);
      container.appendChild(classSection);
    });
  }

  function renderStructuredGroups(index, container) {
    index.classes.forEach((classGroup) => {
      const expanded = classGroup.id === STATE.expandedClassId;
      const classSection = document.createElement("section");
      classSection.className = `class-block class-block--structured${expanded ? " is-expanded" : ""}`;
      classSection.dataset.classId = classGroup.id;

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "class-toggle";
      toggle.dataset.classId = classGroup.id;
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-controls", `class-body-${classGroup.id}`);

      const title = document.createElement("span");
      title.className = "class-toggle__title";
      title.textContent = classGroup.label;
      toggle.appendChild(title);

      const count = document.createElement("span");
      count.className = "class-toggle__count";
      count.textContent = `${classGroup.medications.length}`;
      toggle.appendChild(count);

      classSection.appendChild(toggle);

      const body = document.createElement("div");
      body.className = "class-block__body";
      body.id = `class-body-${classGroup.id}`;
      body.hidden = !expanded;

      classGroup.subclasses.forEach((subclass) => {
        const heading = document.createElement("h4");
        heading.className = "subclass-heading";
        heading.textContent = subclass.label;
        body.appendChild(heading);
        body.appendChild(makeCardsGrid(subclass.medications));
      });

      classSection.appendChild(body);
      container.appendChild(classSection);
    });
  }

  function makeCardsGrid(medications, className = "cards-grid") {
    const grid = document.createElement("div");
    grid.className = className;
    medications.forEach((medication) => {
      grid.appendChild(makeMedicationCard(medication));
    });
    return grid;
  }

  function getVisibleCompactSubclasses(classGroup, selectedSubclassId = "") {
    const subclasses = Array.isArray(classGroup?.subclasses) ? classGroup.subclasses : [];
    if (subclasses.length <= CONFIG.compactSubclassChipLimit) {
      return subclasses;
    }

    if (STATE.expandedSubclassChipsByClass[classGroup.id]) {
      return subclasses;
    }

    const limit = Math.max(1, Number(CONFIG.compactSubclassChipLimit) || 1);
    const selectedIndex = subclasses.findIndex((subclass) => subclass.id === selectedSubclassId);
    if (selectedIndex < 0 || selectedIndex < limit) {
      return subclasses.slice(0, limit);
    }

    const visible = subclasses.slice(0, Math.max(0, limit - 1));
    visible.push(subclasses[selectedIndex]);
    return visible;
  }

  function makeStableId(value) {
    const normalized = normalizeSearch(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || "group";
  }

  function syncClassFilterTypeFromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG.classFilterTypeKey);
      STATE.classFilterType = CONFIG.classFilterTypes.includes(stored)
        ? stored
        : CONFIG.defaultClassFilterType;
    } catch {
      STATE.classFilterType = CONFIG.defaultClassFilterType;
    }
  }

  function syncClassFilterTypeControls() {
    const meta = getClassFilterTypeMeta();

    if (EL.classTypeControl) {
      const buttons = EL.classTypeControl.querySelectorAll("[data-class-filter-type]");
      buttons.forEach((button) => {
        const active = button.dataset.classFilterType === STATE.classFilterType;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    if (EL.classTypeSelect) {
      EL.classTypeSelect.value = STATE.classFilterType;
    }

    if (EL.classTreeControlLabel) {
      EL.classTreeControlLabel.textContent = meta.controlLabel;
    }

    if (EL.classTreeColumns) {
      EL.classTreeColumns.setAttribute("aria-label", meta.treeAriaLabel);
    }

    if (!STATE.classFilterNodeId) {
      STATE.classFilterLabel = getDefaultClassFilterLabel();
    }
    syncClassTreeTrigger();
  }

  function setClassFilterType(type, options = {}) {
    const { persist = true, rerender = true } = options;
    if (!CONFIG.classFilterTypes.includes(type)) return;

    const hasChanged = STATE.classFilterType !== type;
    STATE.classFilterType = type;
    syncClassFilterTypeControls();

    if (persist) {
      try {
        localStorage.setItem(CONFIG.classFilterTypeKey, type);
      } catch {
        // Non-fatal if storage is unavailable.
      }
    }

    if (!hasChanged) return;

    closeClassTreeMenu();
    resetClassFilter({ rerender: false });
    populateClassFilter();

    if (rerender) {
      applyFiltersAndRender();
    }
  }

  function setViewMode(mode, options = {}) {
    const { persist = true, rerender = true } = options;
    if (!CONFIG.viewModes.includes(mode)) return;

    STATE.viewMode = mode;
    syncViewModeControls();

    if (persist) {
      try {
        localStorage.setItem(CONFIG.viewModeKey, mode);
      } catch {
        // Non-fatal if storage is unavailable.
      }
    }

    if (rerender && STATE.groupingIndex) {
      syncGroupingStateAfterFilter();
      renderCards();
    }
  }

  function syncViewModeFromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG.viewModeKey);
      if (stored === "tree") {
        STATE.viewMode = "structured";
        localStorage.setItem(CONFIG.viewModeKey, "structured");
      } else {
        STATE.viewMode = CONFIG.viewModes.includes(stored) ? stored : CONFIG.defaultViewMode;
      }
    } catch {
      STATE.viewMode = CONFIG.defaultViewMode;
    }
  }

  function syncViewModeControls() {
    if (EL.viewModeControl) {
      const buttons = EL.viewModeControl.querySelectorAll("[data-view-mode]");
      buttons.forEach((button) => {
        const active = button.dataset.viewMode === STATE.viewMode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    if (EL.viewModeSelect) {
      EL.viewModeSelect.value = STATE.viewMode;
    }

    if (EL.resultsGrid) {
      EL.resultsGrid.dataset.viewMode = STATE.viewMode;
    }
  }

  function makeMedicationCard(medication) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `med-card${STATE.selectedId === medication.id ? " is-selected" : ""}`;
    card.dataset.id = medication.id;
    card.setAttribute("aria-label", `${medication.name} details`);
    card.setAttribute("aria-pressed", String(STATE.selectedId === medication.id));

    const title = document.createElement("h3");
    title.className = "med-card__title";
    title.textContent = medication.name;

    const classText = document.createElement("p");
    classText.className = "med-card__class";
    classText.textContent = medication.specificClassLabel || medication.displayClassLabel || medication.drugClass;

    const routeRow = document.createElement("div");
    routeRow.className = "pill-row";
    medication.routes.forEach((route) => {
      const chip = document.createElement("span");
      chip.className = "pill";
      chip.textContent = route;
      routeRow.appendChild(chip);
    });

    const snippet = document.createElement("p");
    snippet.className = "med-card__snippet";
    const snippetValues = getCardSnippetValues(medication);
    snippet.textContent = snippetValues.join(" • ");

    card.appendChild(title);
    card.appendChild(classText);
    card.appendChild(routeRow);
    card.appendChild(snippet);
    return card;
  }

  function getCardSnippetValues(medication) {
    const excludedPrefixes = CONFIG.cardSnippetExcludedIndicationPrefixes.map((prefix) =>
      normalizeSearch(prefix)
    );
    const indicationValues = medication.indications.filter((item) => {
      const normalizedItem = normalizeSearch(item);
      return !excludedPrefixes.some((prefix) => normalizedItem.startsWith(prefix));
    });

    if (indicationValues.length > 0) {
      return indicationValues.slice(0, 2);
    }

    const moa = cleanText(medication.moa);
    return moa ? [moa] : ["No summary available."];
  }

  function handleResultsGridKeydown(event) {
    const card = event.target.closest(".med-card");
    if (!card || !EL.resultsGrid) return;

    const cards = Array.from(EL.resultsGrid.querySelectorAll(".med-card"));
    if (cards.length === 0) return;

    const currentIndex = cards.indexOf(card);
    if (currentIndex < 0) return;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusCard(cards, currentIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusCard(cards, currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusCard(cards, 0);
        break;
      case "End":
        event.preventDefault();
        focusCard(cards, cards.length - 1);
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        event.preventDefault();
        selectMedication(card.dataset.id, true);
        break;
      default:
        break;
    }
  }

  function focusCard(cards, index) {
    const boundedIndex = Math.max(0, Math.min(cards.length - 1, index));
    const target = cards[boundedIndex];
    if (!target) return;

    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function selectMedication(id, openOnMobile) {
    if (!id) return;
    STATE.selectedId = id;

    renderCards();
    ensureRxNormForMedication(id);
    renderDetail();

    if (openOnMobile && isMobileViewport() && EL.detailPanel && EL.detailScrim) {
      EL.detailPanel.classList.add("open");
      EL.detailScrim.hidden = false;
      document.body.classList.add("detail-open");
    }
  }

  function renderDetail() {
    if (!EL.detailTitle || !EL.detailBody || !EL.detailEmpty || !EL.detailMeta) return;

    const selected = STATE.medications.find((medication) => medication.id === STATE.selectedId);
    EL.detailBody.innerHTML = "";

    if (!selected) {
      syncDetailLayout(false);
      EL.detailTitle.textContent = CONFIG.noSelectionTitle;
      EL.detailMeta.hidden = true;
      EL.detailBody.hidden = true;
      EL.detailEmpty.hidden = false;
      EL.detailEmpty.innerHTML = `<p>${CONFIG.noSelectionCopy}</p>`;
      return;
    }

    syncDetailLayout(true);
    EL.detailTitle.textContent = selected.name;
    EL.detailMeta.hidden = false;
    EL.detailMeta.textContent = `${selected.specificClassLabel || selected.displayClassLabel || selected.drugClass} • ${selected.routes.join(", ")}`;
    EL.detailEmpty.hidden = true;
    EL.detailBody.hidden = false;
    const rxNormState = getRxNormStateForMedication(selected.id);

    const sections = [
      makeTextSection("Class", selected.specificClassLabel || selected.displayClassLabel || selected.drugClass, "class"),
      makeTextSection("Routes", selected.routes.join(", "), "routes"),
      makeTextSection("MOA", selected.moa, "moa"),
      makeListSection("Indications", selected.indications, "indications"),
      makeListSection("Contraindications", selected.contraindications, "contraindications"),
      makeListSection("Adverse Effects", selected.adverseEffects, "adverse-effects"),
      makeListSection("Major Interactions", selected.majorInteractions, "major-interactions"),
      makeListSection("Monitoring", selected.monitoring, "monitoring"),
      makeRxNormSection(rxNormState),
      makeListSection("Pearls", selected.pearls, "pearls"),
      makeListSection("Aliases", selected.aliases, "aliases"),
      makeListSection("Brand Examples", selected.brandExamples, "brand-examples"),
    ];

    const fragment = document.createDocumentFragment();
    sections.forEach((section) => fragment.appendChild(section));
    EL.detailBody.appendChild(fragment);
  }

  function syncDetailLayout(hasSelection) {
    if (EL.layoutShell) {
      EL.layoutShell.classList.toggle("has-detail", Boolean(hasSelection));
    }

    if (EL.detailPanel) {
      EL.detailPanel.dataset.selectionState = hasSelection ? "selected" : "empty";
    }
  }

  function makeTextSection(title, text, dataSection) {
    const section = document.createElement("section");
    section.className = "detail-section";
    section.dataset.section = dataSection;

    const heading = document.createElement("h3");
    heading.className = "detail-section__title";
    heading.textContent = title;

    const content = document.createElement("p");
    content.className = "detail-section__text";
    content.textContent = text || "None listed.";

    section.appendChild(heading);
    section.appendChild(content);
    return section;
  }

  function makeListSection(title, items, dataSection) {
    const section = document.createElement("section");
    section.className = "detail-section";
    section.dataset.section = dataSection;

    const heading = document.createElement("h3");
    heading.className = "detail-section__title";
    heading.textContent = title;

    const list = document.createElement("ul");
    list.className = "detail-section__list";
    const values = items.length > 0 ? items : ["None listed."];

    values.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });

    section.appendChild(heading);
    section.appendChild(list);
    return section;
  }

  function createEmptyRxNormPayload() {
    return {
      rxcui: null,
      canonicalName: null,
      ingredients: [],
      doseForms: [],
      classes: [],
    };
  }

  function makeRxNormState(status, data = createEmptyRxNormPayload(), errorMessage = "") {
    return {
      status,
      data,
      errorMessage,
    };
  }

  function getRxNormStateForMedication(medicationId) {
    const state = STATE.rxnormByMedicationId[medicationId];
    if (state) return state;
    return makeRxNormState(RXNORM_STATUS.IDLE);
  }

  function ensureRxNormForMedication(medicationId) {
    if (!medicationId) return;

    const cached = STATE.rxnormByMedicationId[medicationId];
    if (cached && cached.status !== RXNORM_STATUS.IDLE) {
      return;
    }

    if (!RXNORM_FETCH_ENABLED || !cleanText(RXNORM_PROXY_BASE_URL)) {
      STATE.rxnormByMedicationId[medicationId] = makeRxNormState(
        RXNORM_STATUS.ERROR,
        createEmptyRxNormPayload(),
        "RxNorm unavailable right now."
      );
      return;
    }

    if (RXNORM_IN_FLIGHT.has(medicationId)) {
      return;
    }

    const medication = STATE.medications.find((item) => item.id === medicationId);
    if (!medication) return;

    STATE.rxnormByMedicationId[medicationId] = makeRxNormState(RXNORM_STATUS.LOADING);

    const task = loadRxNormForMedication(medication)
      .then((payload) => {
        if (!payload) {
          STATE.rxnormByMedicationId[medicationId] = makeRxNormState(RXNORM_STATUS.EMPTY);
          return;
        }

        const hasAnyData = Boolean(
          payload.rxcui
          || payload.canonicalName
          || payload.ingredients.length > 0
          || payload.doseForms.length > 0
          || payload.classes.length > 0
        );

        STATE.rxnormByMedicationId[medicationId] = hasAnyData
          ? makeRxNormState(RXNORM_STATUS.SUCCESS, payload)
          : makeRxNormState(RXNORM_STATUS.EMPTY);
      })
      .catch((error) => {
        console.warn("RxNorm lookup failed:", error);
        STATE.rxnormByMedicationId[medicationId] = makeRxNormState(
          RXNORM_STATUS.ERROR,
          createEmptyRxNormPayload(),
          "RxNorm unavailable right now."
        );
      })
      .finally(() => {
        RXNORM_IN_FLIGHT.delete(medicationId);
        if (STATE.selectedId === medicationId) {
          renderDetail();
        }
      });

    RXNORM_IN_FLIGHT.set(medicationId, task);
  }

  async function loadRxNormForMedication(medication) {
    const rxcui = await resolveRxcuiForMedication(medication);
    if (!rxcui) return null;

    const [relatedResult, propertiesResult, classesResult] = await Promise.allSettled([
      fetchRelatedByRxcui(rxcui),
      fetchPropertiesByRxcui(rxcui),
      fetchClassesByRxcui(rxcui),
    ]);

    const allFailed = [relatedResult, propertiesResult, classesResult].every(
      (result) => result.status === "rejected"
    );
    if (allFailed) {
      const firstError = [relatedResult, propertiesResult, classesResult].find(
        (result) => result.status === "rejected"
      );
      throw firstError.reason;
    }

    return normalizeRxNormPayload({
      rxcui,
      relatedPayload: relatedResult.status === "fulfilled" ? relatedResult.value : null,
      propertiesPayload: propertiesResult.status === "fulfilled" ? propertiesResult.value : null,
      classesPayload: classesResult.status === "fulfilled" ? classesResult.value : null,
    });
  }

  async function resolveRxcuiForMedication(medication) {
    const candidates = dedupeText([
      medication.name,
      ...toTextArray(medication.aliases),
    ]);

    let hadNoMatchResponse = false;
    let lastError = null;

    for (const candidate of candidates) {
      try {
        const rxcui = await fetchRxcuiByName(candidate);
        if (rxcui) return rxcui;
        hadNoMatchResponse = true;
      } catch (error) {
        lastError = error;
      }
    }

    if (hadNoMatchResponse) return "";
    if (lastError) throw lastError;
    return "";
  }

  async function fetchRxcuiByName(name) {
    const url = buildRxNormUrl(
      RXNORM_ENDPOINTS.rxcuiByName,
      {},
      { [RXNORM_QUERY_KEYS.name]: cleanText(name) }
    );
    const payload = await fetchJsonWithTimeout(url);
    return extractRxcuiFromNamePayload(payload);
  }

  async function fetchRelatedByRxcui(rxcui) {
    const url = buildRxNormUrl(
      RXNORM_ENDPOINTS.relatedByRxcui,
      { [RXNORM_QUERY_KEYS.rxcui]: rxcui },
      { [RXNORM_QUERY_KEYS.tty]: RXNORM_DEFAULT_RELATED_TTYS }
    );
    return fetchJsonWithTimeout(url);
  }

  async function fetchPropertiesByRxcui(rxcui) {
    const url = buildRxNormUrl(
      RXNORM_ENDPOINTS.propertiesByRxcui,
      { [RXNORM_QUERY_KEYS.rxcui]: rxcui }
    );
    return fetchJsonWithTimeout(url);
  }

  async function fetchClassesByRxcui(rxcui) {
    const url = buildRxNormUrl(
      RXNORM_ENDPOINTS.classesByRxcui,
      { [RXNORM_QUERY_KEYS.rxcui]: rxcui }
    );
    return fetchJsonWithTimeout(url);
  }

  function normalizeRxNormPayload({ rxcui, relatedPayload, propertiesPayload, classesPayload }) {
    const canonicalName = cleanText(
      propertiesPayload?.properties?.name
      || propertiesPayload?.name
      || extractNameFromConceptGroups(relatedPayload)
    );

    const ingredients = dedupeText(
      extractRelatedConceptNames(relatedPayload, new Set(["IN", "MIN", "PIN"]))
    );
    const doseForms = dedupeText([
      ...extractRelatedConceptNames(relatedPayload, new Set(["DF", "DFG"])),
      ...toTextArray(propertiesPayload?.properties?.doseFormName),
      ...toTextArray(propertiesPayload?.doseFormName),
    ]);

    return {
      rxcui: cleanText(rxcui) || null,
      canonicalName: canonicalName || null,
      ingredients,
      doseForms,
      classes: dedupeClassEntries(extractRxNormClasses(classesPayload)),
    };
  }

  function extractConceptGroups(relatedPayload) {
    const groups = [];

    if (Array.isArray(relatedPayload?.allRelatedGroup?.conceptGroup)) {
      groups.push(...relatedPayload.allRelatedGroup.conceptGroup);
    }

    if (Array.isArray(relatedPayload?.relatedGroup?.conceptGroup)) {
      groups.push(...relatedPayload.relatedGroup.conceptGroup);
    }

    if (Array.isArray(relatedPayload?.conceptGroup)) {
      groups.push(...relatedPayload.conceptGroup);
    }

    return groups;
  }

  function extractRelatedConceptNames(relatedPayload, allowedTtys = null) {
    const names = [];
    const groups = extractConceptGroups(relatedPayload);

    groups.forEach((group) => {
      const tty = cleanText(group?.tty).toUpperCase();
      if (allowedTtys && !allowedTtys.has(tty)) {
        return;
      }

      const concepts = Array.isArray(group?.conceptProperties) ? group.conceptProperties : [];
      concepts.forEach((concept) => {
        const name = cleanText(concept?.name || concept?.synonym);
        if (name) names.push(name);
      });
    });

    return names;
  }

  function extractNameFromConceptGroups(relatedPayload) {
    const names = extractRelatedConceptNames(relatedPayload);
    return names[0] || "";
  }

  function extractRxcuiFromNamePayload(payload) {
    const idGroup = payload?.idGroup;
    if (Array.isArray(idGroup?.rxnormId) && idGroup.rxnormId.length > 0) {
      return cleanText(idGroup.rxnormId[0]);
    }

    if (Array.isArray(payload?.approximateGroup?.candidate) && payload.approximateGroup.candidate.length > 0) {
      return cleanText(payload.approximateGroup.candidate[0]?.rxcui);
    }

    if (cleanText(payload?.rxcui)) {
      return cleanText(payload.rxcui);
    }

    return "";
  }

  function extractRxNormClasses(classesPayload) {
    const classes = [];
    const infoList = classesPayload?.rxclassDrugInfoList?.rxclassDrugInfo;
    if (Array.isArray(infoList)) {
      infoList.forEach((item) => {
        const name = cleanText(item?.rxclassMinConceptItem?.className || item?.className);
        if (!name) return;
        const source = cleanText(item?.relaSource);
        const type = cleanText(item?.rela);
        classes.push({
          name,
          source: source || undefined,
          type: type || undefined,
        });
      });
    }

    const minConceptList = classesPayload?.rxclassMinConceptList?.rxclassMinConcept;
    if (Array.isArray(minConceptList)) {
      minConceptList.forEach((item) => {
        const name = cleanText(item?.className || item?.name);
        if (!name) return;
        classes.push({ name });
      });
    }

    return classes;
  }

  function makeRxNormSection(rxNormState) {
    const section = document.createElement("section");
    section.className = "detail-section detail-section--rxnorm";
    section.dataset.section = "rxnorm";

    const heading = document.createElement("h3");
    heading.className = "detail-section__title";
    heading.textContent = "RxNorm";
    section.appendChild(heading);

    const body = document.createElement("div");
    body.className = "rxnorm-body";

    const status = rxNormState?.status || RXNORM_STATUS.IDLE;
    if (status === RXNORM_STATUS.LOADING || status === RXNORM_STATUS.IDLE) {
      body.appendChild(makeRxNormStateMessage(RXNORM_STATUS.LOADING, "Loading RxNorm data..."));
      section.appendChild(body);
      return section;
    }

    if (status === RXNORM_STATUS.ERROR) {
      body.appendChild(
        makeRxNormStateMessage(
          RXNORM_STATUS.ERROR,
          cleanText(rxNormState?.errorMessage) || "RxNorm unavailable right now."
        )
      );
      section.appendChild(body);
      return section;
    }

    if (status === RXNORM_STATUS.EMPTY) {
      body.appendChild(makeRxNormStateMessage(RXNORM_STATUS.EMPTY, "No RxNorm match found."));
      section.appendChild(body);
      return section;
    }

    const payload = rxNormState?.data || createEmptyRxNormPayload();
    const hasFieldValues = [
      appendRxNormField(body, "RxCUI", payload.rxcui, "rxcui"),
      appendRxNormField(body, "Canonical Name", payload.canonicalName, "canonical-name"),
      appendRxNormChipField(body, "Ingredients", payload.ingredients, "ingredients"),
      appendRxNormChipField(body, "Dose Forms", payload.doseForms, "dose-forms"),
      appendRxNormClassesField(body, payload.classes),
    ].some(Boolean);

    if (!hasFieldValues) {
      body.appendChild(makeRxNormStateMessage(RXNORM_STATUS.EMPTY, "No RxNorm match found."));
    }

    section.appendChild(body);
    return section;
  }

  function makeRxNormStateMessage(status, text) {
    const message = document.createElement("p");
    message.className = `detail-section__text rxnorm-state rxnorm-state--${status}`;
    message.dataset.rxnormState = status;
    message.textContent = text;
    return message;
  }

  function appendRxNormField(container, label, value, fieldKey) {
    const textValue = cleanText(value);
    if (!textValue) return false;

    const field = document.createElement("div");
    field.className = "rxnorm-field";
    field.dataset.rxnormField = fieldKey;

    const fieldLabel = document.createElement("p");
    fieldLabel.className = "rxnorm-field__label";
    fieldLabel.textContent = label;

    const fieldValue = document.createElement("p");
    fieldValue.className = "rxnorm-field__value";
    fieldValue.textContent = textValue;

    field.appendChild(fieldLabel);
    field.appendChild(fieldValue);
    container.appendChild(field);
    return true;
  }

  function appendRxNormChipField(container, label, items, fieldKey) {
    const values = dedupeText(toTextArray(items));
    if (values.length === 0) return false;

    const field = document.createElement("div");
    field.className = "rxnorm-field";
    field.dataset.rxnormField = fieldKey;

    const fieldLabel = document.createElement("p");
    fieldLabel.className = "rxnorm-field__label";
    fieldLabel.textContent = label;

    const row = document.createElement("div");
    row.className = "rxnorm-chip-row";
    values.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "pill rxnorm-pill";
      chip.textContent = item;
      row.appendChild(chip);
    });

    field.appendChild(fieldLabel);
    field.appendChild(row);
    container.appendChild(field);
    return true;
  }

  function appendRxNormClassesField(container, classes) {
    if (!Array.isArray(classes) || classes.length === 0) return false;

    const field = document.createElement("div");
    field.className = "rxnorm-field";
    field.dataset.rxnormField = "classes";

    const fieldLabel = document.createElement("p");
    fieldLabel.className = "rxnorm-field__label";
    fieldLabel.textContent = "Class Links";

    const list = document.createElement("ul");
    list.className = "detail-section__list rxnorm-class-list";
    classes.forEach((item) => {
      const li = document.createElement("li");
      const suffixBits = [item.source, item.type].filter(Boolean);
      li.textContent = suffixBits.length > 0
        ? `${item.name} (${suffixBits.join(" • ")})`
        : item.name;
      list.appendChild(li);
    });

    field.appendChild(fieldLabel);
    field.appendChild(list);
    container.appendChild(field);
    return true;
  }

  function buildRxNormUrl(endpointTemplate, pathParams = {}, queryParams = {}) {
    const path = fillPathTemplate(endpointTemplate, pathParams);
    const baseUrl = joinUrlParts(RXNORM_PROXY_BASE_URL, path);
    return mergeQueryParams(baseUrl, queryParams);
  }

  function fillPathTemplate(template, pathParams) {
    let output = cleanText(template);
    Object.entries(pathParams || {}).forEach(([key, value]) => {
      output = output.replace(`{${key}}`, encodeURIComponent(cleanText(value)));
    });
    return output;
  }

  function joinUrlParts(base, path) {
    const basePart = cleanText(base).replace(/\/+$/g, "");
    const pathPart = cleanText(path).replace(/^\/+/g, "");
    if (!basePart) return `/${pathPart}`;
    if (!pathPart) return basePart;
    return `${basePart}/${pathPart}`;
  }

  function mergeQueryParams(url, params) {
    const searchParams = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      const cleaned = cleanText(value);
      if (!cleaned) return;
      searchParams.set(key, cleaned);
    });
    const encoded = searchParams.toString();
    if (!encoded) return url;
    return `${url}?${encoded}`;
  }

  async function fetchJsonWithTimeout(url) {
    const requestUrl = cleanText(url);
    if (!requestUrl) {
      throw new Error("RxNorm proxy URL is not configured.");
    }

    let timeoutId = null;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), RXNORM_TIMEOUT_MS);
    }

    try {
      const response = await fetch(requestUrl, {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        throw new Error(`RxNorm proxy request failed (${response.status})`);
      }

      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        throw new Error("RxNorm proxy returned invalid JSON.");
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("RxNorm request timed out.");
      }
      throw error instanceof Error ? error : new Error("RxNorm request failed.");
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function dedupeText(items) {
    const seen = new Set();
    const out = [];
    toTextArray(items).forEach((item) => {
      const normalized = normalizeSearch(item);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(cleanText(item));
    });
    return out;
  }

  function dedupeClassEntries(classes) {
    if (!Array.isArray(classes)) return [];
    const seen = new Set();
    const deduped = [];

    classes.forEach((item) => {
      const name = cleanText(item?.name);
      if (!name) return;

      const source = cleanText(item?.source);
      const type = cleanText(item?.type);
      const key = [normalizeSearch(name), normalizeSearch(source), normalizeSearch(type)].join("|");
      if (seen.has(key)) return;
      seen.add(key);

      deduped.push({
        name,
        source: source || undefined,
        type: type || undefined,
      });
    });

    return deduped;
  }

  function closeMobileDetailPanel() {
    if (!EL.detailPanel || !EL.detailScrim) return;
    EL.detailPanel.classList.remove("open");
    EL.detailScrim.hidden = true;
    document.body.classList.remove("detail-open");
  }

  function isMobileViewport() {
    return window.matchMedia(`(max-width: ${CONFIG.mobileBreakpointPx}px)`).matches;
  }

  function syncThemeFromStorage() {
    applyTheme(getStoredTheme());
  }

  function getStoredTheme() {
    try {
      const saved = localStorage.getItem(CONFIG.themeKey);
      return saved === "dark" || saved === "light" ? saved : "light";
    } catch {
      return "light";
    }
  }

  function applyTheme(mode) {
    const theme = mode === "dark" ? "dark" : "light";
    STATE.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    updateThemeToggleLabel();
  }

  function updateThemeToggleLabel() {
    if (!EL.themeToggleButton) return;

    const willSwitchToDark = STATE.theme !== "dark";
    const nextLabel = willSwitchToDark
      ? CONFIG.themeToggleDarkLabel
      : CONFIG.themeToggleLightLabel;

    EL.themeToggleButton.textContent = nextLabel;
    EL.themeToggleButton.setAttribute("aria-label", `Switch to ${nextLabel.toLowerCase()}`);
  }

  function toggleTheme() {
    const nextTheme = STATE.theme === "dark" ? "light" : "dark";

    if (typeof window.setTheme === "function") {
      window.setTheme(nextTheme);
      return;
    }

    try {
      localStorage.setItem(CONFIG.themeKey, nextTheme);
    } catch {
      // If local storage fails, still apply in-memory theme for this session.
    }

    applyTheme(nextTheme);
  }

  function deriveClassPath(medication) {
    const sourceClass = cleanText(medication.drugClass);
    if (!sourceClass) return [CONFIG.uncategorizedClassLabel];

    const context = normalizeSearch(
      [
        medication.name,
        medication.drugClass,
        ...medication.aliases,
        ...medication.brandExamples,
        ...medication.indications,
      ].join(" ")
    );

    const rulePath = findClassPathFromRules(context, CLASS_HIERARCHY_RULES);
    if (rulePath.length === 0) {
      return [sourceClass];
    }

    const alreadyIncludesSource = rulePath.some((label) => normalizeSearch(label) === normalizeSearch(sourceClass));
    if (!alreadyIncludesSource) {
      rulePath.push(sourceClass);
    }

    return dedupeClassPath(rulePath);
  }

  function findClassPathFromRules(context, rules) {
    for (const rule of rules) {
      if (!rule.match.test(context)) continue;

      const childPath = Array.isArray(rule.children)
        ? findClassPathFromRules(context, rule.children)
        : [];
      return [rule.label, ...childPath];
    }
    return [];
  }

  function dedupeClassPath(path) {
    const deduped = [];
    path.forEach((segment) => {
      const label = cleanText(segment);
      if (!label || isAlphabeticalClassBucketLabel(label)) return;

      const prior = deduped[deduped.length - 1];
      if (prior && normalizeSearch(prior) === normalizeSearch(label)) return;
      deduped.push(label);
    });

    if (deduped.length === 0) {
      return [CONFIG.uncategorizedClassLabel];
    }

    return deduped;
  }

  function isAlphabeticalClassBucketLabel(value) {
    const label = cleanText(value);
    if (!label) return false;
    return /^classes?\s+[#_a-z0-9](?:\s*[-/]\s*[#_a-z0-9])?$/i.test(label);
  }

  function showError(message) {
    if (!EL.loadError) return;
    EL.loadError.hidden = false;
    EL.loadError.textContent = message;
  }

  function hideError() {
    if (!EL.loadError) return;
    EL.loadError.hidden = true;
    EL.loadError.textContent = "";
  }

  function toTextArray(value) {
    if (Array.isArray(value)) {
      return value.map(cleanText).filter(Boolean);
    }
    const cleaned = cleanText(value);
    return cleaned ? [cleaned] : [];
  }

  function cleanText(value) {
    return String(value || "").trim();
  }

  function normalizeRoute(route) {
    const value = cleanText(route).toUpperCase();
    if (!value) return "";
    if (value === "SC" || value === "SUBQ" || value === "SUBCUTANEOUS") return "SQ";
    if (value === "INHALATION") return "INH";
    if (value === "INTRANASAL") return "IN";
    if (value === "SUBLINGUAL") return "SL";
    if (value === "RECTAL") return "PR";
    if (value === "TOPICAL") return "Topical";
    return ROUTE_ENUM.includes(value) ? value : "";
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2019']/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniq(items) {
    return Array.from(new Set(items));
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
})();
