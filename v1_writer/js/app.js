
// ===== Cache config =====
const APP_VERSION = "2026-08-17-a";          // bump to invalidate everything
const CACHE_ENABLED = true;                   // master switch
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;     // 24h for templates
const STATE_AUTOSAVE_MS = 500;               // debounce for state saves

// Cache keys
const CK = {
  TEMPLATES: `ct.templates.${APP_VERSION}`,
  STATE:     `ct.state.${APP_VERSION}`,        // legacy (unused after multi-patient)
  PATLIST:   `ct.patients.${APP_VERSION}`,     // array of {id, createdAt}
  CURRENT:   `ct.patient.current.${APP_VERSION}`, // active patient id
};

const DEFAULT_COLUMNS = 3;

// Sticky layout heights (JS-only; no CSS edits)
const STK = {
  appbarMin: 38,  // px fallback if measurement fails
  tier1Min: 36,
  tier2Min: 36,
  z: { appbar: 6, tier1: 5, tier2: 4, checks: 3 }
};

// Tiny debounce helper
function debounce(fn, ms=100){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
}

const REMEMBER_STATE = false;
// Debounce for the full-note builder
const COMPLETE_NOTE_MS = 150;
// MSE should render as checkbox-only, even if old cached templates contain chips.
const ENFORCE_MSE_CHECKBOX_ONLY = true;
// When converting legacy chip templates, include both positive and negative chip text as checkboxes.
const CONVERT_LEGACY_MSE_CHIP_NEG_TEXT = true;
const LEGACY_MSE_NEG_SUFFIX = "_neg";
// Checkbox output combination style controls
const CHECKBOX_COMBINE_PREPOSITIONS = new Set(["to", "for", "with", "in", "on", "at", "from", "of"]);
const CHECKBOX_COMBINE_SINGLE_WORD_PREDICATES = new Set(["denies", "impaired", "normal"]);

const CLASS_CRITICAL = "critical"; // applied when abnormal/present (right-click)
const CLASS_NORMAL   = "normal";   // applied when good/absent (left-click)


// Internal mode IDs
const DEFAULT_MODE = "subjective";

const MODE_FILES = {
  subjective: "./templates/template_subjective.json",
  ROS: "./templates/template_ROS.json",
  PE:  "./templates/template_pe.json",
  MSE: "./templates/template_MSE.json",
};

// Explicit order using IDs
const MODE_LIST = ["subjective", "ROS", "PE", "MSE"];

// UI labels
const MODE_LABELS = {
  subjective: "Subjective",
  ROS: "ROS",
  PE: "Physical Exam",
  MSE: "MSE",
};

// subjective acuity toggle (defaults to Acute=true when undefined)
function isAcute(){ return state?.globals?.subjAcute !== false; }
function setAcute(on){ state.globals.subjAcute = !!on; saveStateSoon(); }

// --- subjective split (HPI | splitter | General) ---
function getSubjSplit(){
  const f = Number(state?.globals?.subjSplit);
  if (Number.isFinite(f)) return Math.min(0.75, Math.max(0.25, f)); // clamp 25–75%
  return 0.50; // default
}
function setSubjSplit(f){
  const v = Math.min(0.75, Math.max(0.25, Number(f) || 0.50));
  state.globals.subjSplit = v;
  saveStateSoon();
}
function _subjGridTemplateFromSplit(split){
  const leftPct  = Math.round(split * 100);
  const rightPct = 100 - leftPct;
  // 6px splitter in the middle
  return `${leftPct}% 6px ${rightPct}%`;
}
// Fields that should accept multi-line input and render as multi-line in output
const MULTILINE_FIELDS = new Set([
  "pastMedical", "surgicalHx", "meds", "allergies",
  "social", "lmp", "familyHx"
]);
// Helper: treat as multiline if id is in set OR label matches known headings
function isMultilineField(id, label){
  if (MULTILINE_FIELDS.has(id)) return true;
  const name = String(label || "").toLowerCase();
  return [
    "past medical",
    "surgical hx",
    "meds",
    "allergies",
    "social",
    "lmp",
    "family hx",
    "family history"
  ].some(k => name.startsWith(k));
}
function templatesLookValid(tpl) {
  return !!(tpl && typeof tpl === "object" && tpl.sectionsByMode && tpl.sectionDefs);
}

function _templateHasChips(tpl){
  if (!tpl?.sectionDefs) return false;
  return Object.values(tpl.sectionDefs).some(def =>
    (def?.panels || []).some(panel =>
      (Array.isArray(panel?.chips) && panel.chips.length > 0) ||
      (panel?.subsections || []).some(ss => Array.isArray(ss?.chips) && ss.chips.length > 0)
    )
  );
}

function _normMSELabel(s){
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function _addLegacyChipAsCheckbox(checkboxes, id, label){
  const lbl = String(label || "").trim();
  if (!id || !lbl) return;
  const idSet = new Set((checkboxes || []).map(cb => cb?.id).filter(Boolean));
  const labelSet = new Set((checkboxes || []).map(cb => _normMSELabel(cb?.label)).filter(Boolean));
  if (idSet.has(id)) return;
  if (labelSet.has(_normMSELabel(lbl))) return;
  checkboxes.push({ id, label: lbl });
}

function _convertLegacyMSEChipsToCheckboxes(node){
  const checkboxes = Array.isArray(node?.checkboxes) ? node.checkboxes : [];
  node.checkboxes = checkboxes;
  const chips = Array.isArray(node?.chips) ? node.chips : [];
  if (!chips.length) {
    node.chips = [];
    return;
  }

  chips.forEach(chip => {
    if (!chip || !chip.id) return;
    const posLabel = String(chip.abnText || chip.label || "").trim();
    _addLegacyChipAsCheckbox(checkboxes, chip.id, posLabel);
    if (CONVERT_LEGACY_MSE_CHIP_NEG_TEXT) {
      const negLabel = String(chip.negText || "").trim();
      _addLegacyChipAsCheckbox(checkboxes, `${chip.id}${LEGACY_MSE_NEG_SUFFIX}`, negLabel);
    }
  });

  node.chips = [];
}

function _sanitizeMSETemplateCheckboxOnly(tpl){
  if (!ENFORCE_MSE_CHECKBOX_ONLY || !tpl || typeof tpl !== "object") return tpl;
  if (!_templateHasChips(tpl)) return tpl;

  const out = JSON.parse(JSON.stringify(tpl));
  Object.values(out.sectionDefs || {}).forEach(def => {
    (def?.panels || []).forEach(panel => {
      _convertLegacyMSEChipsToCheckboxes(panel);
      (panel?.subsections || []).forEach(ss => {
        _convertLegacyMSEChipsToCheckboxes(ss);
      });
    });
  });
  return out;
}

// ===== Tiny cache helper (localStorage + TTL) =====
function cacheSet(key, value, ttlMs = 0) {
  if (!CACHE_ENABLED) return;
  const now = Date.now();
  const rec = { v: value, t: now, ttl: ttlMs|0 };
  try { localStorage.setItem(key, JSON.stringify(rec)); } catch {}
}
function cacheGet(key) {
  if (!CACHE_ENABLED) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (rec && rec.ttl && Date.now() - rec.t > rec.ttl) {
      localStorage.removeItem(key);
      return null; // expired
    }
    return rec ? rec.v : null;
  } catch { return null; }
}
function cacheDel(key) {
  try { localStorage.removeItem(key); } catch {}
}
function cacheClearAllForVersion() {
  // Clears only this APP_VERSION namespace
  Object.keys(localStorage).forEach(k => {
    if (k.includes(`ct.`) && k.includes(APP_VERSION)) localStorage.removeItem(k);
  });
}


async function loadTemplatesForMode(mode){
  const file = MODE_FILES[mode];
  if (!file) throw new Error(`No template file for mode ${mode}`);

  // 1) Try cached bucket
  let bucket = cacheGet(CK.TEMPLATES) || {};
  if (bucket && bucket[mode] && templatesLookValid(bucket[mode])) {
    if (mode === "MSE" && ENFORCE_MSE_CHECKBOX_ONLY) {
      const sanitized = _sanitizeMSETemplateCheckboxOnly(bucket[mode]);
      if (sanitized !== bucket[mode]) {
        bucket[mode] = sanitized;
        cacheSet(CK.TEMPLATES, bucket, CACHE_TTL_MS);
      }
      console.debug("[NoteWriter] Using cached templates for", mode);
      return sanitized;
    }
    console.debug("[NoteWriter] Using cached templates for", mode);
    return bucket[mode];
  }

  // 2) Fetch fresh
  const r = await fetch(file, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${file}`);
  let tpl = await r.json();
  if (mode === "MSE" && ENFORCE_MSE_CHECKBOX_ONLY) {
    tpl = _sanitizeMSETemplateCheckboxOnly(tpl);
  }

  // 3) Validate fetched; if bad, clear and throw
  if (!templatesLookValid(tpl)) {
    cacheDel(CK.TEMPLATES);
    throw new Error(`Template schema invalid for ${mode}`);
  }

  // 4) Save back to bucket
  bucket[mode] = tpl;
  cacheSet(CK.TEMPLATES, bucket, CACHE_TTL_MS);
  return tpl;
}


async function switchMode(mode){
  state.mode = mode;
  try {
    Templates = await loadTemplatesForMode(mode);
  } catch (e) {
    // Fallback: read inline <script type="application/json" id="templates-fallback">
    const node = document.getElementById("templates-fallback");
    if (node && node.textContent.trim()) {
      try {
        Templates = JSON.parse(node.textContent);
        console.warn(`[NoteWriter] Using inline templates fallback for ${mode}.`);
      } catch (e2) {
        return showFatal("Inline templates fallback is invalid JSON.");
      }
    } else {
      return showFatal(`Could not load templates for mode ${mode}.`);
    }
  }

  if (!Templates?.sectionsByMode || !Templates?.sectionDefs) {
    return showFatal("templates schema missing required keys.");
  }
  const first = Templates.sectionsByMode[mode]?.[0];
  if (!first) return showFatal(`No sections for mode "${mode}".`);
  state.activeSection = first;
  ensureSectionState();
  applyRosDefaultsIfAny();   // pre-set default normal ROS chips from template
  renderAll();
}

/*** STATE ***/
let Templates = null;
let state = {
  mode: DEFAULT_MODE,
  activeSection: null,
  columns: DEFAULT_COLUMNS,
  sections: {},
  globals: {},
  patientId: null,
};
document.addEventListener("DOMContentLoaded", init);

const GRADE_LABELS = {
  pulses: ["0","1+","2+","3+"],
  s3s4:   ["1","2","3","4","5","6"],
  edema:  ["1+","2+","3+","4+"]
};
const SIDE_LABELS = { R:"R", L:"L", B:"bilateral" };
const isPos = (v)=> typeof v === "object" && v?.state === "pos";
const isNeg = (v)=> v === 'neg';
const asObj = (v)=> (typeof v === "object" ? v : null);

// Apply default-negative ROS chips declared in the template (ROS:General.defaults.negChips)
function applyRosDefaultsIfAny() {
  try {
    if (state.mode !== "ROS") return;
    const def = Templates && Templates.sectionDefs && Templates.sectionDefs["ROS:General"];
    const negList = (def && def.defaults && Array.isArray(def.defaults.negChips)) ? def.defaults.negChips : [];
    if (!negList.length) return;

    const sec = getSecFor("ROS", "General");
    sec.chips = sec.chips || {};

    // Only set defaults for chips that are still unset
    negList.forEach(id => {
      if (sec.chips[id] === undefined) sec.chips[id] = 'neg';
    });

    saveStateSoon();
  } catch (e) {
    console.debug("[ROS defaults] skipped:", e?.message || e);
  }
}

function cloneMacroValue(value) {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

function getTemplateMacros() {
  return Array.isArray(Templates?.macros) ? Templates.macros : [];
}

function macroAppliesToActiveSection(macro) {
  const sections = Array.isArray(macro?.sections) ? macro.sections : [];
  return !sections.length || sections.includes(state.activeSection);
}

function getVisibleMacros() {
  return getTemplateMacros().filter(macro => macro && macro.label && macroAppliesToActiveSection(macro));
}

function applyMacroPatchToSection(sec, patch) {
  if (!sec || !patch) return;

  if (patch.checkboxes && typeof patch.checkboxes === "object") {
    sec.checkboxes ??= {};
    Object.entries(patch.checkboxes).forEach(([id, value]) => {
      if (value === null) {
        delete sec.checkboxes[id];
        return;
      }
      sec.checkboxes[id] = !!value;
    });
  }

  if (patch.fields && typeof patch.fields === "object") {
    sec.fields ??= {};
    Object.entries(patch.fields).forEach(([id, value]) => {
      if (value === null) {
        delete sec.fields[id];
        return;
      }
      sec.fields[id] = String(value);
    });
  }

  if (patch.chips && typeof patch.chips === "object") {
    sec.chips ??= {};
    Object.entries(patch.chips).forEach(([id, value]) => {
      if (value === null || value === "clear") {
        delete sec.chips[id];
        return;
      }
      if (value === "neg") {
        sec.chips[id] = "neg";
        return;
      }
      if (value === "pos") {
        sec.chips[id] = { state: "pos" };
        return;
      }
      sec.chips[id] = cloneMacroValue(value);
    });
  }
}

function runTemplateMacro(macro) {
  const targets = Array.isArray(macro?.targets) ? macro.targets : [];
  if (!targets.length) return;

  targets.forEach(target => {
    const sectionName = target?.section || state.activeSection;
    if (!sectionName) return;
    const sec = getSecFor(state.mode, sectionName);
    applyMacroPatchToSection(sec, target);
  });

  saveStateSoon();
  renderHeaderChecks();
  renderGrid();
  renderOutput();
  renderCompleteSoon();
}

function renderMacroControls(host) {
  const macros = getVisibleMacros();
  if (!macros.length) return;

  const wrap = document.createElement("div");
  wrap.className = "macro-controls";

  const label = document.createElement("span");
  label.className = "macro-controls__label";
  label.textContent = "Macros";
  wrap.appendChild(label);

  macros.forEach(macro => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-mini macro-btn";
    btn.textContent = macro.label;
    if (macro.description) btn.title = macro.description;
    btn.onclick = () => runTemplateMacro(macro);
    wrap.appendChild(btn);
  });

  host.appendChild(wrap);
}

// --- Vital signs parser/scrubber ---
// Input example (pasted):
// BP (!) 142/91 (BP Location: Right upper arm, Patient Position: Sitting, BP Cuff Size: Adult)  | Pulse 73  | Temp 98 °F (Oral)  | Resp 16  | Ht 4' 11"  | Wt 115 lb 12.8 oz  | LMP 09/06/2025 (Exact Date)  | SpO2 98%  | BMI 23.39 kg/m²  | Smoking Status Never  | BSA 1.48 m²
// Output (exact format requested):
// Temp 98 °F (Oral), BP (!) 142/91,  HR 73, RR 16, Oxygen sat (O2)
// BMI: 23.39
function scrubVitalSigns(raw) {
  if (!raw) return null;
  const s = String(raw);

  // BP with optional "(!)"
  let bpBang = "";
  let bpSys = "", bpDia = "";
  {
    const m = s.match(/BP\s*(\(!\))?\s*([0-9]{2,3})\s*\/\s*([0-9]{2,3})/i);
    if (m) { bpBang = m[1] ? "(!) " : ""; bpSys = m[2]; bpDia = m[3]; }
  }

  // Pulse
  let pulse = "";
  { const m = s.match(/Pulse\s*([0-9]{1,3})/i); if (m) pulse = m[1]; }

  // Temp + site (if present)
  let temp = "", site = "";
  {
    const m = s.match(/Temp\s*([\d.]+)\s*°?\s*F(?:\s*\(([^)]+)\))?/i);
    if (m) { temp = m[1]; site = m[2] || ""; }
  }

  // Resp
  let resp = "";
  { const m = s.match(/Resp\s*([0-9]{1,3})/i); if (m) resp = m[1]; }

  // SpO2 numeric value (emit as "SpO2 98%")
  let spo2 = "";
  {
    let m = s.match(/(?:SpO2|O2\s*Sat|Oxygen\s*Sat)\s*([0-9]{1,3})\s*%/i);
    if (!m) m = s.match(/\bO2\b\s*([0-9]{1,3})\s*%/i); // fallback for "O2 98%"
    if (m) spo2 = m[1];
  }

  // BMI value (accept kg/m² or kg/m2, or bare number)
  let bmi = "";
  {
    let m = s.match(/BMI\s*([\d.]+)\s*kg\/m(?:2|²)/i);
    if (!m) m = s.match(/BMI\s*([\d.]+)/i);
    if (m) bmi = m[1];
  }

  // Build first line exactly as requested
  const parts = [];
  if (temp) parts.push(`Temp ${temp} °F${site ? ` (${site})` : ""}`);
  if (bpSys && bpDia) parts.push(`BP ${bpBang}${bpSys}/${bpDia}`);
  if (pulse) parts.push(`HR ${pulse}`);
  if (resp) parts.push(`RR ${resp}`);
  if (spo2) parts.push(`SpO2 ${spo2}%`);

  // Match example’s double-space before HR
  let line1 = parts.join(", ");
  line1 = line1.replace(", HR", ",  HR");
  // Defensive: if any legacy literal slipped in from older state, normalize it
  if (/\bOxygen sat \(O2\)\b/i.test(line1)) {
    if (spo2) {
      line1 = line1.replace(/\bOxygen sat \(O2\)\b/gi, `SpO2 ${spo2}%`);
    } else {
      line1 = line1.replace(/\s*,?\s*\bOxygen sat \(O2\)\b/gi, "").replace(/,\s*,/g, ", ").replace(/,\s*$/, "");
    }
  }

  const line2 = bmi ? `BMI: ${bmi}` : "";

  if (!line1 && !line2) return null;
  return { line1, line2 };
}


async function init(){
  maybeRestoreState();
  // Load templates and set activeSection for the (possibly restored) mode
  await switchMode(state.mode || DEFAULT_MODE);
  wireHeader();
  renderPatientControls();
  applySticky();
  renderCompleteSoon();
  enhanceCompleteNoteUI();
  // Populate footer version placeholder if present
  try {
    const ph = document.getElementById('app-version-placeholder');
    if (ph) ph.textContent = APP_VERSION;
  } catch {}
}

function showFatal(msg){
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  grid.appendChild(document.createTextNode("ERROR: " + msg));
  console.error("[NoteWriter]", msg);
}
function renderAll(){ renderTier1(); renderTier2(); renderHeaderChecks(); renderGrid(); renderOutput(); wireHeader(); applySticky(); }

function renderTier1(){
  const wrap = document.getElementById("tier1");
  wrap.innerHTML = "";
  MODE_LIST.forEach(m => {
    const btn = document.createElement("button");
    btn.className = "tab" + (m === state.mode ? " active" : "");
    btn.textContent = MODE_LABELS[m] || m;
    btn.onclick = async ()=>{ await switchMode(m); };
    wrap.appendChild(btn);
  });
  applySticky();
}

function renderTier2(){
  const wrap = document.getElementById("tier2");
  wrap.innerHTML = "";
  const secs = (Templates.sectionsByMode[state.mode] || []);

  // Hide the Tier 2 nav entirely when there's 0 or 1 section
  if (secs.length <= 1) {
    // Ensure activeSection is set to the only section (if any)
    if (secs.length === 1) {
      const only = secs[0];
      if (state.activeSection !== only) {
        state.activeSection = only;
        ensureSectionState();
        renderGrid();
        renderOutput();
        renderCompleteSoon();
      }
    }
    wrap.style.display = "none";
    applySticky();
    return;
  }

  // Otherwise, render the tab bar as usual
  wrap.style.display = "";
  secs.forEach(sec=>{
    const btn = document.createElement("button");
    btn.className = "tab" + (sec===state.activeSection ? " active" : "");
    btn.textContent = sec;
    btn.onclick = ()=>{ state.activeSection = sec; ensureSectionState(); renderTier2(); renderHeaderChecks(); renderGrid(); renderOutput(); renderCompleteSoon(); applySticky();};
    wrap.appendChild(btn);
  });
  applySticky();
}

function px(n){ return `${Math.max(0, Math.round(n))}px`; }

function applySticky(){
  const appbar = document.querySelector('.appbar');
  const tier1  = document.getElementById('tier1');
  const tier2  = document.getElementById('tier2');
  const checks = document.getElementById('headerItems');

  if (!tier1 || !tier2 || !checks) return;

  // Measure current heights (fallbacks keep it robust)
  const appbarH = appbar?.getBoundingClientRect?.().height || STK.appbarMin;
  const tier1H  = tier1.getBoundingClientRect?.().height || STK.tier1Min;
  const tier2H  = tier2.getBoundingClientRect?.().height || STK.tier2Min;

  // Tier 1 sticky under appbar
  tier1.style.position = 'sticky';
  tier1.style.top      = px(appbarH);
  tier1.style.zIndex   = String(STK.z.tier1);
  if (!tier1.style.background) tier1.style.background = '#eef2f7';

  // Tier 2 sticky under Tier 1
  tier2.style.position = 'sticky';
  tier2.style.top      = px(appbarH + tier1H);
  tier2.style.zIndex   = String(STK.z.tier2);
  if (!tier2.style.background) tier2.style.background = '#f6f8fb';

}

// Re-apply sticky on window resize
window.addEventListener('resize', debounce(applySticky, 120));
// Helper to create a row div with the current mode as a class, plus any extra class
function makeRow(extraClass){
  const d = document.createElement("div");
  d.className = "row " + state.mode + (extraClass ? (" " + extraClass) : "");
  return d;
}

function appendCheckboxesAndChips(host, defLike){
  if (!host || !defLike) return;

  if (defLike.checkboxes?.length){
    const row = makeRow();
    defLike.checkboxes.forEach(c => {
      row.appendChild(
        cb(c.id, c.label, !!getSec().checkboxes?.[c.id], v => { setCB(c.id, v); renderOutput(); })
      );
    });
    host.appendChild(row);
  }

  if (defLike.chips?.length){
    const row = makeRow();
    if (defLike.layout?.chipCols) row.classList.add(`cols-${defLike.layout.chipCols}`);
    defLike.chips.forEach(ch => {
      const value = getSec().chips?.[ch.id] || 0;
      row.appendChild(chip(ch, value, (evt) => handleChipMouse(evt, ch.id)));
    });
    host.appendChild(row);
  }
}

function insertMiniChecks(fieldEl, checkboxes){
  if (!fieldEl || !Array.isArray(checkboxes) || !checkboxes.length) return;
  const checkRow = document.createElement("div");
  checkRow.className = "mini-checks";
  checkboxes.forEach(c => {
    checkRow.appendChild(
      cb(c.id, c.label, !!getSec().checkboxes?.[c.id], v => { setCB(c.id, v); renderOutput(); })
    );
  });
  const last = fieldEl.lastChild;
  fieldEl.insertBefore(checkRow, last);
}

function createFieldElement(def){
  const val = getField(def.id);

  if (def.type === "boolean") {
    return fieldBoolean(
      def.id,
      def.label,
      typeof val === "boolean" ? val : false,
      (v) => { setField(def.id, v); renderGrid(); renderOutput(); renderCompleteSoon(); },
      def.ui || {}
    );
  }

  if (def.type === "range") {
    const stacked = (state.mode === "subjective") && !(def.ui && def.ui.inline === true);
    return fieldRange(
      def.id,
      def.label,
      val,
      (v) => { setField(def.id, v); renderOutput(); renderCompleteSoon(); },
      def.min,
      def.max,
      def.step,
      /*stacked*/ stacked
    );
  }

  const stacked = (state.mode === "subjective") && !(def.ui && def.ui.inline === true);
  const el = fieldText(
    def.id,
    def.label,
    val,
    (v) => { setField(def.id, v); renderOutput(); renderCompleteSoon(); },
    def.placeholder,
    /*stacked*/ stacked
  );
  insertMiniChecks(el, def.checkboxes);
  return el;
}

function appendPanelFields(host, fields){
  if (!fields?.length) return;

  fields.forEach(f => {
    if (!shouldShowField(f)) return;

    if (f.type === "group") {
      const rowGroup = makeRow();
      if (f.label) {
        const span = document.createElement("span");
        span.className = "field-label";
        span.style.display = "block";
        span.style.marginBottom = "0px";
        span.textContent = f.label;
        rowGroup.appendChild(span);
      }

      const body = document.createElement("div");
      body.className = "field-group";

      const inlineFlow = !!(f.layout && f.layout.flow === "inline");
      if (inlineFlow) {
        body.style.display = "inline-flex";
        body.style.flexWrap = "wrap";
        body.style.alignItems = "center";
        body.style.gap = "8px 12px";
      }

      (f.fields || []).forEach(cf => {
        if (!shouldShowField(cf)) return;
        body.appendChild(createFieldElement(cf));

        const kids = Array.isArray(cf.children) ? cf.children : [];
        kids.forEach(k => {
          const childDef = { ...k };
          if (!childDef.showIf) childDef.showIf = { field: cf.id, equals: true };
          if (!shouldShowField(childDef)) return;
          body.appendChild(createFieldElement(childDef));
        });
      });

      rowGroup.appendChild(body);
      host.appendChild(rowGroup);
      return;
    }

    const row = makeRow();
    row.appendChild(createFieldElement(f));
    host.appendChild(row);
  });
}

function renderHeaderChecks(){
  const host = document.getElementById("headerItems");
  host.innerHTML = "";
  const visibleMacros = getVisibleMacros();
  // Add an Acute / Non-acute toggle at the very top for subjective
if (state.mode === "subjective") {
  const acuteWrap = document.createElement("div");
  acuteWrap.className = "acute-toggle";
  acuteWrap.style.display = "inline-flex";
  acuteWrap.style.gap = "6px";
  acuteWrap.style.marginRight = "8px";

  const mk = (label, on) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "btn-mini" + ((on && isAcute()) || (!on && !isAcute()) ? " active" : "");
    b.onclick = () => { setAcute(on); renderGrid(); renderOutput(); renderCompleteSoon(); renderHeaderChecks(); };
    return b;
  };

  acuteWrap.appendChild(mk("Acute", true));
  acuteWrap.appendChild(mk("Non-acute", false));
  host.appendChild(acuteWrap);
}
  const def = Templates.sectionDefs[`${state.mode}:${state.activeSection}`];
  if (!def) { host.style.display = "none"; return; }

  // Collect headerItems: prefer current section; otherwise fall back to General (subjective)
  // or merge headerItems across all sections for this mode.
  let items = Array.isArray(def.headerItems) ? def.headerItems.slice() : [];

  // subjective: also allow items defined on General
  if ((!items.length) && state.mode === "subjective") {
    const generalDef = Templates.sectionDefs[`${state.mode}:General`];
    if (generalDef?.headerItems?.length) items = generalDef.headerItems.slice();
  }

  // Final fallback: merge all sections' headerItems for this mode
  if (!items.length) {
    const secsAll = Templates.sectionsByMode[state.mode] || [];
    const merged = [];
    const seen = new Set();
    secsAll.forEach(secName => {
      const d = Templates.sectionDefs[`${state.mode}:${secName}`];
      (d?.headerItems || []).forEach(h => {
        if (!h || !h.id || seen.has(h.id)) return;
        seen.add(h.id);
        merged.push(h);
      });
    });
    items = merged;
  }

  // Prefer the current section's def; for subjective, allow subj_header to come from General
  let headerDef = def;
  if (state.mode === "subjective") {
    const generalKey = `${state.mode}:General`;
    if (Templates.sectionDefs[generalKey]) headerDef = Templates.sectionDefs[generalKey];
  }
  const headerPanel = (headerDef.panels || []).find(p => p.id === 'subj_header');
  const hasChecks = items.length > 0;
  const hasHeaderFields = !!(headerPanel && headerPanel.fields && headerPanel.fields.length);

  // Debug log for header items state
  console.debug('[HeaderItems]', {
    mode: state.mode,
    activeSection: state.activeSection,
    itemsCount: items.length,
    hasHeaderFields,
    headerPanelId: headerPanel && headerPanel.id,
    headerPanelFields: headerPanel && headerPanel.fields && headerPanel.fields.length
  });

  // Hide only if we truly have nothing to show
  if (!hasChecks && !hasHeaderFields && !visibleMacros.length) {
    host.style.display = "none";
    return;
  }

  host.style.display = "";

  // Render header items (supports text inputs and checkboxes)
  if (hasChecks){
    try {
      const wrapChecks = makeRow("heady");
      items.forEach(t=>{
        if (t && t.type === 'text') {
          const val = getSec().fields?.[t.id];
          const onChange = (v) => {
            setField(t.id, v);
            renderOutput();
            renderCompleteSoon();
          };
          wrapChecks.appendChild(
            fieldText(
              t.id,
              t.label || t.id,
              val,
              onChange,
              t.placeholder || t.label || t.id,
              /*stacked*/ false
            )
          );
        } else if (t) {
          wrapChecks.appendChild(
            cb(
              t.id,
              t.label || t.id,
              !!getSec().checkboxes?.[t.id],
              v=>{ setCB(t.id, v); renderOutput(); renderCompleteSoon(); }
            )
          );
        }
      });
      host.appendChild(wrapChecks);
    } catch (e) {
      console.error('[HeaderItems] render checks failed', e);
    }
  }

  // Render subjective header fields (Visit Note, Chief Complaint) stacked
  if (hasHeaderFields){
    try {
      const wrapFields = makeRow("header-fields");
      const headerSec = getSecFor('subjective', 'General');
      (headerPanel.fields || []).forEach(f => {
        const val = headerSec.fields?.[f.id];
        const onChange = (v) => {
          headerSec.fields[f.id] = v;
          saveStateSoon();
          renderOutput();
          renderCompleteSoon();
        };
        wrapFields.appendChild(
          fieldText(
            f.id,
            f.label || f.id,
            val,
            onChange,
            f.placeholder || f.label || f.id,
            /*stacked*/ true
          )
        );
      });
      host.appendChild(wrapFields);
    } catch (e) {
      console.error('[HeaderItems] render header fields failed', e);
    }
  }
  renderMacroControls(host);

  applySticky();
}


function renderGrid(){
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  // Update grid class to include current mode
  grid.className = "section-grid " + state.mode;
  const def = Templates.sectionDefs[`${state.mode}:${state.activeSection}`];
  if(!def){ grid.textContent = "No schema yet."; return; }

  // Dynamic resizable layout for subjective (HPI | splitter | General)
  if (state.mode === "subjective") {
    const panels = (def.panels || []).filter(p => p && p.id !== 'subj_header');

    // Identify HPI (by title) and a "General History" partner (fallback to first non-HPI)
    const hpi = panels.find(p => p.title === "History of Present Illness");
    let gen = panels.find(p => p.title === "General History") || panels.find(p => p !== hpi);

    // If Non-acute, HPI is hidden elsewhere; do not build split UI
    const canSplit = !!(isAcute() && hpi && gen);

    if (canSplit) {
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = _subjGridTemplateFromSplit(getSubjSplit());
      grid.style.gap = "8px";
      // flag so we know to inject splitter and short-circuit normal panel loop
      grid.dataset.subjSplit = "1";
    } else {
      grid.style.display = "";
      grid.style.gridTemplateColumns = "";
      grid.style.gap = "";
      grid.dataset.subjSplit = "";
    }
  } else {
    grid.style.display = "";
    grid.style.gridTemplateColumns = "";
    grid.style.gap = "";
    grid.dataset.subjSplit = "";
  }

  // --- Special subjective splitter row (HPI | splitter | General) ---
  if (state.mode === "subjective" && grid.dataset.subjSplit === "1") {
    const panels = (def.panels || []).filter(p => p && p.id !== 'subj_header');
    const hpi = panels.find(p => p.title === "History of Present Illness");
    const gen = panels.find(p => p.title === "General History") || panels.find(p => p !== hpi);

    // Helper to render a single panel's content into a given host element
    const renderOne = (pd, host) => {
      if (pd.groupLabel){
        const h = document.createElement("div");
        h.className = "subhead";
        h.textContent = pd.groupLabel;
        host.appendChild(h);
      }
      if (pd.type === "matrix") {
        host.appendChild(renderMatrixPanel(pd));
        return;
      }
      if (pd.subsections && pd.subsections.length){
        pd.subsections.forEach(ss=>{
          const sh = document.createElement("div");
          sh.className = "subhead";
          sh.textContent = ss.title;
          host.appendChild(sh);
          appendCheckboxesAndChips(host, ss);
        });
      }
      appendPanelFields(host, pd.fields);
      appendCheckboxesAndChips(host, pd);
    };

    // Build left panel (HPI)
    const leftPanelEl = panel(hpi.title);
    leftPanelEl.style.gridColumn = "1 / 2";
    renderOne(hpi, leftPanelEl);

    // Build right panel (General)
    const rightPanelEl = panel(gen.title);
    rightPanelEl.style.gridColumn = "3 / 4";
    renderOne(gen, rightPanelEl);

    // Build the vertical splitter (horizontal width resize)
    const splitter = document.createElement("div");
    splitter.className = "subj-splitter";
    splitter.style.gridColumn = "2 / 3";
    splitter.style.cursor = "col-resize";
    splitter.style.background = "var(--divider, rgba(0,0,0,0.06))";
    splitter.style.width = "6px";
    splitter.style.userSelect = "none";

    grid.append(leftPanelEl, splitter, rightPanelEl);

    // Wire drag for horizontal width only
    (function(){
      let dragging = false;
      let gridRect = null;

      const onDown = (e)=>{
        dragging = true;
        gridRect = grid.getBoundingClientRect();
        document.body.style.cursor = "col-resize";
        e.preventDefault();
      };
      const onMove = (e)=>{
        if (!dragging || !gridRect) return;
        const x = e.clientX;
        const rel = (x - gridRect.left) / gridRect.width; // 0..1
        setSubjSplit(rel);
        grid.style.gridTemplateColumns = _subjGridTemplateFromSplit(getSubjSplit());
      };
      const onUp = ()=>{
        if (!dragging) return;
        dragging = false;
        gridRect = null;
        document.body.style.cursor = "";
      };

      splitter.addEventListener("mousedown", onDown);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    })();

    // Since we fully rendered the split layout, skip the normal panels loop
    return;
  }

  if (def.headerToggles?.length){
    const p = panel("Options");
    p.classList.add("options"); // style Options panel like Epic header tray
    const row = makeRow();
    def.headerToggles.forEach(t=>{
      row.appendChild(cb(t.id, t.label, !!getSec().checkboxes?.[t.id], v=>{ setCB(t.id,v); renderOutput(); }));
    });
    p.appendChild(row); grid.appendChild(p);
  }
  // panels
  (def.panels||[]).forEach(pd=>{
    // Skip subjective header fields panel; rendered up top in headerItems area
    if (pd.id === 'subj_header') { return; }
    // Hide the HPI panel in Non-acute subjective mode
    if (state.mode === "subjective" && !isAcute() && pd.title === "History of Present Illness") {
      return; // skip rendering this panel entirely
    }
    const p = panel(pd.title);
    if (pd.groupLabel){
      const h = document.createElement("div");
      h.className = "subhead";
      h.textContent = pd.groupLabel;
      p.appendChild(h);
    }
    // matrix panel support
    if (pd.type === "matrix") { 
      grid.appendChild(renderMatrixPanel(pd)); 
      return; 
    }
    // subsections support (e.g., HENT with Head / Ears / Nose / Mouth/Throat)
    if (pd.subsections && pd.subsections.length){
      // 1) Grouped rendering (e.g., HENT Ears: Right | Left)
      if (pd.layout?.groups?.length){
        const rendered = new Set();

        pd.layout.groups.forEach(g => {
          if (g.label){
            const gh = document.createElement("div");
            gh.className = "subhead group-head";
            gh.textContent = g.label;
            p.appendChild(gh);
          }
          const sg = document.createElement("div");
          sg.className = `subgrid cols-${g.cols || 2}`;

          for (let i = g.from; i <= g.to && i < pd.subsections.length; i++){
            rendered.add(i);
            const ss = pd.subsections[i];

            const box = document.createElement("div");
            box.className = "subpanel";

            const sh = document.createElement("div");
            sh.className = "subhead";
            sh.textContent = ss.title;
            box.appendChild(sh);

            appendCheckboxesAndChips(box, ss);

            sg.appendChild(box);
          }
          p.appendChild(sg);
        });

        // Render remaining subsections (not in any group)
        pd.subsections.forEach((ss, idx)=>{
          if (rendered.has(idx)) return;
          const sh = document.createElement("div");
          sh.className = "subhead";
          sh.textContent = ss.title;
          p.appendChild(sh);

          appendCheckboxesAndChips(p, ss);
        });

        grid.appendChild(p);
        return; // handled this panel via groups
      }

      // 2) Legacy subgrid hint (Cardio: Rate | Rhythm)
      const useGrid = pd.layout && pd.layout.gridCols;
      const cut = typeof pd.layout?.gridUntilIndex === "number" ? pd.layout.gridUntilIndex : -1;

      if (useGrid && cut >= 0) {
        const subgrid = document.createElement("div");
        subgrid.className = `subgrid cols-${pd.layout.gridCols}`;

        for (let i = 0; i <= cut && i < pd.subsections.length; i++){
          const ss = pd.subsections[i];
          const box = document.createElement("div");
          box.className = "subpanel";

          const sh = document.createElement("div");
          sh.className = "subhead";
          sh.textContent = ss.title;
          box.appendChild(sh);

          appendCheckboxesAndChips(box, ss);
          subgrid.appendChild(box);
        }
        p.appendChild(subgrid);

        for (let i = cut + 1; i < pd.subsections.length; i++){
          const ss = pd.subsections[i];
          const sh = document.createElement("div");
          sh.className = "subhead";
          sh.textContent = ss.title;
          p.appendChild(sh);

          appendCheckboxesAndChips(p, ss);
        }
        grid.appendChild(p);
        return; // done with this panel
      }

      // 3) Fallback: stacked subsections
      pd.subsections.forEach(ss=>{
        const sh = document.createElement("div");
        sh.className = "subhead";
        sh.textContent = ss.title;
        p.appendChild(sh);
        appendCheckboxesAndChips(p, ss);
      });
      grid.appendChild(p);
      return; // skip the normal checkboxes/chips path for this panel
    }
    appendPanelFields(p, pd.fields);
    appendCheckboxesAndChips(p, pd);
    grid.appendChild(p);
  });
  
}


function renderOutput(){
  const ta = document.getElementById("out");
  const secKey = `${state.mode}:${state.activeSection}`;
  if (!Templates?.sectionDefs?.[secKey]) { if (ta) ta.value = ""; return; }

  const lines = buildSectionLines(secKey, state.mode, Templates, { skipSubjHeaderOnce: false });

  if (state.mode === "subjective") {
    console.debug('[subjective][renderOutput] lines:', lines.length, lines);
  }

  if (ta) ta.value = lines.join("\n");
  updateSectionPreviewScope();
}

// ====== Patient history (multi-patient cache) ======
function _getPatientList(){
  try { return JSON.parse(localStorage.getItem(CK.PATLIST) || "[]"); } catch { return []; }
}
function _setPatientList(list){
  try { localStorage.setItem(CK.PATLIST, JSON.stringify(list)); } catch {}
}
function _patientKey(id){ return `${CK.STATE}:${id}`; }
function _setCurrentPatient(id){ try { localStorage.setItem(CK.CURRENT, id); } catch {} }
function _getCurrentPatient(){ try { return localStorage.getItem(CK.CURRENT) || null; } catch { return null; } }
function _fmtTime(ts){ try { return new Date(ts).toLocaleString(); } catch { return String(ts); } }

function createNewPatient(){
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const createdAt = Date.now();

  const list = _getPatientList();
  list.push({ id, createdAt });
  _setPatientList(list);
  _setCurrentPatient(id);

  state = {
    mode: DEFAULT_MODE,
    activeSection: null,
    columns: DEFAULT_COLUMNS,
    sections: {},
    globals: {},
    patientId: id,
  };

  switchMode(DEFAULT_MODE);
  clearCompleteNoteBox();
}
// Clear the Complete Note box immediately
function clearCompleteNoteBox(){
  const box = document.getElementById('completeOut');
  if (!box) return;
  box.value = '';
  const view = document.getElementById('completeOutView');
  if (view) view.innerHTML = '';
  _updateCnMetrics();
  _autosizeCnTextarea();
}


async function loadPatientById(id){
  if (!id) return;
  _setCurrentPatient(id);
  try {
    const raw = localStorage.getItem(_patientKey(id));
    if (!raw){
      state = {
        mode: DEFAULT_MODE,
        activeSection: null,
        columns: DEFAULT_COLUMNS,
        sections: {},
        globals: {},
        patientId: id,
      };
      await switchMode(DEFAULT_MODE);
      renderAll();
      return;
    }
    const saved = JSON.parse(raw);
    state = {
      mode: saved.mode || DEFAULT_MODE,
      activeSection: saved.activeSection || null,
      columns: saved.columns || DEFAULT_COLUMNS,
      sections: saved.sections || {},
      globals: saved.globals || {},
      patientId: id,
    };
    await switchMode(state.mode || DEFAULT_MODE);
    renderAll();
  } catch (e) {
    console.error("[NoteWriter] Failed to load patient", id, e);
  }
}

function renderPatientControls(){
  const host = document.getElementById("patientToolbar");
  if (!host) return;
  host.innerHTML = "";

  const label = document.createElement("span");
  label.className = "toolbar-label";
  label.textContent = "Patient";
  host.appendChild(label);

  const btn = document.createElement("button");
  btn.textContent = "Start New Patient";
  btn.title = "Start a new patient session";
  btn.onclick = ()=>{ createNewPatient(); };
  host.appendChild(btn);

  const sel = document.createElement("select");
  const list = _getPatientList().slice().sort((a,b)=>b.createdAt - a.createdAt);
  const cur = _getCurrentPatient();

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Resume saved note…";
  sel.appendChild(opt0);

  list.forEach(p=>{
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = _fmtTime(p.createdAt);
    if (p.id === cur) o.selected = true;
    sel.appendChild(o);
  });

  sel.onchange = async (e)=>{
    const id = e.target.value || cur;
    if (id) await loadPatientById(id);
  };
  host.appendChild(sel);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.dataset.role = "clear-patients";
  clearBtn.textContent = "Delete Saved Patients";
  clearBtn.title = "Delete all saved patients and start fresh";
  clearBtn.onclick = () => {
    if (confirm("Delete all saved patients? This cannot be undone.")) {
      clearAllPatients();
      renderPatientControls();
      renderGrid();
      renderOutput();
      renderCompleteSoon();
    }
  };
  host.appendChild(clearBtn);
}

// Completely clear patient history (does NOT touch template cache)
function clearAllPatients(){
  try {
    // delete all per-patient state blobs
    Object.keys(localStorage).forEach(k=>{
      if (k.startsWith(`${CK.STATE}:`)) localStorage.removeItem(k);
    });
    // remove patient list + current pointer
    localStorage.removeItem(CK.PATLIST);
    localStorage.removeItem(CK.CURRENT);
  } catch {}

  // Reset in-memory state & start fresh with a new patient
  state = {
    mode: DEFAULT_MODE,
    activeSection: null,
    columns: DEFAULT_COLUMNS,
    sections: {},
    globals: {},
    patientId: null,
  };
  createNewPatient();   // sets new id + switches mode + renders
}

// ====== State persistence (autosave + restore) ======
let _saveTimer = null;
function saveStateSoon(){
  if (!CACHE_ENABLED) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>{
    try {
      const id = state.patientId || _getCurrentPatient();
      if (id) {
        localStorage.setItem(_patientKey(id), JSON.stringify({
          mode: state.mode,
          activeSection: state.activeSection,
          columns: state.columns,
          sections: state.sections,
          globals: state.globals,
        }));
        _setCurrentPatient(id);
      }
    } catch {}
  }, STATE_AUTOSAVE_MS);
}

function maybeRestoreState(){
  if (!CACHE_ENABLED) return false;
  const cur = _getCurrentPatient();
  if (cur){
    try {
      const raw = localStorage.getItem(_patientKey(cur));
      if (!raw) { state.patientId = cur; return true; }
      const saved = JSON.parse(raw);
      state = {
        mode: saved.mode || DEFAULT_MODE,
        activeSection: saved.activeSection || null,
        columns: saved.columns || DEFAULT_COLUMNS,
        sections: saved.sections || {},
        globals: saved.globals || {},
        patientId: cur,
      };
      return true;
    } catch {}
  }
  createNewPatient();
  return true;
}

// helpers you also need:
function panel(title){ const s=document.createElement("section"); s.className="panel";
  const h=document.createElement("div"); h.className="panel-header"; h.textContent=title; s.appendChild(h); return s; }
function applyCbSelectedClass(wrapperLabel, inputEl){
  if (inputEl.checked) wrapperLabel.classList.add("selected");
  else wrapperLabel.classList.remove("selected");
}

function cb(id,label,checked,on){
  const w = document.createElement("label");
  w.className = "cb" + (state && state.mode === "subjective" ? " subjective" : "");
  const i=document.createElement("input"); 
  i.type="checkbox"; 
  i.checked=checked;

  // initial selected state class
  applyCbSelectedClass(w, i);

  i.onchange=e=>{
    on(e.target.checked);
    applyCbSelectedClass(w, i);
  };

  w.appendChild(i); 
  w.appendChild(document.createTextNode(label)); 
  return w;
}

function setField(id, val){
  getSec().fields[id] = val;
  saveStateSoon();
  renderCompleteSoon();
}
function setCB(id,val){
  getSec().checkboxes[id]=val;
  saveStateSoon();
  renderCompleteSoon();
}

function getField(id){
  const sec = getSec();
  return (sec.fields && Object.prototype.hasOwnProperty.call(sec.fields, id))
    ? sec.fields[id]
    : undefined;
}

// ===== Complete Note aggregation (cross-mode) =====
// Collect text for a specific mode without switching the visible UI mode
async function buildNoteForMode(mode){
  try {
    const tpl = await loadTemplatesForMode(mode);
    return collectTextFromTemplates(mode, tpl);
  } catch (e) {
    console.debug('[CompleteNote] template load failed for', mode, e?.message || e);
    return '';
  }
}

// Safe field accessor for another mode/section (no UI switch)
function getFieldFor(mode, secKey, id){
  const key = `${mode}:${secKey.split(":")[1] || ""}`; // ensure exact key
  const sec = state.sections[key] || {};
  return sec.fields ? sec.fields[id] : undefined;
}

// Conditional visibility for cross-mode build
function shouldShowFieldFor(f, mode, secKey){
  if (!f || !f.showIf) return true;
  const dep = getFieldFor(mode, secKey, f.showIf.field);
  return dep === f.showIf.equals;
}

// Build lines for a single section (pure; no DOM)
function buildSectionLines(secKey, mode, tpl, options = {}){
  const skipSubjHeaderOnce = options.skipSubjHeaderOnce !== false;
  const def = tpl.sectionDefs[secKey];
  const sec = state.sections[secKey] || { checkboxes:{}, chips:{}, fields:{} };
  if (!def) return [];
  const lines = [];

  // Header items (text + checks) with robust fallback sourcing
  (function(){
    // Skip subjective:General headerItems if already emitted above subjective
    if (skipSubjHeaderOnce && mode === "subjective" && /(^|:)General$/.test(secKey) && state.globals && state.globals._emittedSubjHeaderOnce) return;
    let items = Array.isArray(def.headerItems) ? def.headerItems.slice() : [];
    if ((!items.length) && mode === "subjective") {
      const generalDef = tpl.sectionDefs[`${mode}:General`];
      if (generalDef?.headerItems?.length) items = generalDef.headerItems.slice();
    }
    if (!items.length) {
      const secsAll = tpl.sectionsByMode[mode] || [];
      const merged = []; const seen = new Set();
      secsAll.forEach(secName => {
        const d = tpl.sectionDefs[`${mode}:${secName}`];
        (d?.headerItems || []).forEach(h => { if (h && h.id && !seen.has(h.id)) { seen.add(h.id); merged.push(h); } });
      });
      items = merged;
    }
    if (!items.length) return;

  const textParts = [];
  const checkParts = [];
  let _emittedVitals = false;

  items.forEach(h => {
    if (!h || !h.id) return;
    if (h.type === 'text') {
      const raw = sec.fields && sec.fields[h.id];
      const v = (typeof raw === 'string' ? raw.trim() : '');

      // Special handling for the PE vitals paste box
      if (h.id === 'vital_signs_text' && v) {
        const fmt = scrubVitalSigns(v);
        if (fmt) {
          if (fmt.line1) { lines.push(fmt.line1); _emittedVitals = true; }
          if (fmt.line2) { lines.push(fmt.line2); }
        }
        return; // skip default label:value
      }

      if (v) textParts.push(`${h.label || h.id}: ${v}.`);
    } else {
      if (sec.checkboxes?.[h.id]) checkParts.push(formatPECheckLabel(h.label || h.id));
    }
  });
  const combinedHeaderChecks = combineCheckboxPhraseParts(checkParts);
  if (textParts.length) lines.push(...textParts);
  if (!_emittedVitals && combinedHeaderChecks.length) {
    const sectionName = secKey.split(":")[1] || "";
    lines.push(`${sectionName}: ${combinedHeaderChecks.join('. ')}.`);
  }
  })();

  (def.panels || []).forEach(pd => {
    // Collect all ids across panel and subsections
    const _cbs   = [...(pd.checkboxes || [])];
    const _chips = [...(pd.chips || [])];
    (pd.subsections || []).forEach(ss=>{
      _cbs.push(...(ss.checkboxes || []));
      _chips.push(...(ss.chips || []));
    });

    // subjective: include visible text fields (skip booleans)
    if (mode === "subjective" && pd.fields?.length){
      // Skip HPI emission when Non-acute
      if (!isAcute() && pd.title === "History of Present Illness") {
        return; // next panel
      }
      const panelLines = [];
      // Flatten group fields so nested text inputs are included in output
      const fieldsFlat = (pd.fields || []).flatMap(f => {
        const top = (f && f.type === "group") ? (f.fields || []) : [f];
        const out = [];
        top.forEach(it => {
          if (!it) return;
          out.push(it);
          if (Array.isArray(it.children)) out.push(...it.children);
        });
        return out;
      });

      fieldsFlat.forEach(f=>{
        if (!shouldShowFieldFor(f, mode, secKey)) return;
        if (f.type === "boolean") return;
        const raw = (sec.fields && sec.fields[f.id]);
        const v0 = (typeof raw === "string" ? raw : "");
        const v = v0.trim();
        if (!v) return;

        if (isMultilineField(f.id, f.label) && /[\r\n]/.test(v)) {
          const parts = v.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (parts.length) {
            panelLines.push(`${f.label}: ${parts[0]}.`);
            for (let i = 1; i < parts.length; i++){
              panelLines.push(parts[i] + ".");
            }
          }
        } else {
          panelLines.push(`${f.label}: ${v}.`);
        }
      });
      if (panelLines.length){
        if (pd.title === "History of Present Illness") {
          lines.push("HPI:");
        }
        lines.push(...panelLines);
      }
      // Also include any checked panel checkboxes (PMH, Allergies, etc.)
      const cbParts = combineCheckboxPhraseParts(
        (pd.checkboxes || []).filter(c => !!sec.checkboxes?.[c.id])
          .map(c => formatPECheckLabel(c.label || c.id))
      );
      if (cbParts.length) {
        lines.push(`${pd.title}: ${cbParts.join('. ')}.`);
      }
      // Emit field-level checkboxes (e.g., PMH, Allergies)
      pd.fields.forEach(f => {
        if (!Array.isArray(f.checkboxes) || !f.checkboxes.length) return;
        const picked = combineCheckboxPhraseParts(
          f.checkboxes
            .filter(c => !!sec.checkboxes?.[c.id])
            .map(c => formatPECheckLabel(c.label || c.id))
        );
        if (picked.length) lines.push(`${f.label}: ${picked.join('. ')}.`);
      });
      return; // next panel
    }

    const cbParts = combineCheckboxPhraseParts(
      _cbs
        .filter(c => !!sec.checkboxes?.[c.id])
        .map(c => formatPECheckLabel(labelFor(secKey, c.id)))
    );

    const negParts = _chips
      .filter(d => isNeg(sec.chips?.[d.id]))
      .map(d => formatChipNegForOutput(secKey, d.id));

    const posParts = _chips
      .filter(d => isPos(sec.chips?.[d.id]))
      .map(d => {
        const txt = formatChipForOutput(secKey, d.id, sec.chips[d.id]);
        return mode === "ROS" ? `<span class="abn_out">${txt}</span>` : txt;
      });

    if (posParts.length || negParts.length || cbParts.length){
      let linePlain = `${pd.title}: `;

      if (posParts.length){
        const posPlainList = posParts.map((t,i)=> i===0 ? capFirst(t) : t);
        const posPlainSent = `${posPlainList.join("; ")}.`;
        linePlain += posPlainSent + (negParts.length || cbParts.length ? " " : "");
      }

      if (negParts.length || cbParts.length){
        const deniesItems = [];
        const noItems = [];
        negParts.forEach(raw => {
          const t = String(raw).trim();
          if (/^denies\b/i.test(t))      deniesItems.push(lcFirst(t.replace(/^denies\s+/i, "")));
          else if (/^no\b/i.test(t))     noItems.push(lcFirst(t.replace(/^no\s+/i, "")));
          else                           noItems.push(lcFirst(t.replace(/^(denies|no)\s+/i, "")));
        });
        const negSentences = [];
        if (deniesItems.length) negSentences.push(`Denies ${joinWithOxford(deniesItems, "and")}.`);
        if (noItems.length)     negSentences.push(`No ${joinWithOxford(noItems, "or")}.`);
        if (cbParts.length)     negSentences.push(`${cbParts.join("; ")}.`);
        linePlain += negSentences.join(" ");
      }
      lines.push(linePlain);
    }
  });

  // Fallback: if subjective produced no lines, sweep all visible text fields
  if (mode === "subjective" && lines.length === 0) {
    (def.panels || []).forEach(pd => {
      (pd.fields || []).forEach(f => {
        if (!shouldShowFieldFor(f, mode, secKey)) return;
        if (f.type === "boolean") return;
        const raw = (sec.fields && sec.fields[f.id]);
        const v = (typeof raw === "string" ? raw.trim() : "");
        if (v) lines.push(`${f.label}: ${v}.`);
      });
    });
  }

  return lines;
}

// Walk the templates for a mode and assemble text from state (all sections)
function collectTextFromTemplates(mode, tpl){
  if (!tpl || typeof tpl !== 'object') return '';
  const out = [];
  const orderedSections = tpl.sectionsByMode?.[mode] || [];
  const oldTemplates = Templates;
  try {
    // Ensure helper lookups (findDef/labelFor/formatChip*) use the correct defs
    Templates = tpl;
    orderedSections.forEach(sectionName => {
      const secKey = `${mode}:${sectionName}`;
      const lines = buildSectionLines(secKey, mode, tpl);
      if (mode === "subjective") {
        console.debug('[subjective][collect] sec=', sectionName, 'lines=', lines.length);
      }
      if (lines.length) out.push(...lines);
    });
  } finally {
    Templates = oldTemplates;
  }
  return out.join("\n");
}

// Safe accessor for another mode's section bucket (no UI switch)
function getSecFor(mode, groupKey){
  const key = `${mode}:${groupKey}`;
  state.sections[key] ??= { checkboxes:{}, chips:{}, fields:{} };
  return state.sections[key];
}

let _completeTimer = null;
function renderCompleteSoon(){
  clearTimeout(_completeTimer);
  _completeTimer = setTimeout(() => { renderCompleteNote(); }, COMPLETE_NOTE_MS);
}

const SECTION_HEADS = { subjective: "Subjective", ROS: "ROS", PE: "Physical Exam", MSE: "MSE" };

async function renderCompleteNote(){
  const box = document.getElementById('completeOut');
  if (!box) return;
  const modes = Object.keys(MODE_FILES || {});
  const parts = [];
  state.globals ??= {};
  // Reset per-render guard before we potentially prepend subjective header items.
  state.globals._emittedSubjHeaderOnce = false;
  // Prepend headerItems from subjective:General (Visit Note, Chief Complaint) above subjective heading
  try {
    const subjTpl = await loadTemplatesForMode("subjective");
    const genDef = subjTpl.sectionDefs["subjective:General"];
    if (genDef && Array.isArray(genDef.headerItems) && genDef.headerItems.length) {
      const sec = state.sections["subjective:General"] || { fields:{}, checkboxes:{} };
      const headerLines = [];
      genDef.headerItems.forEach(h => {
        if (!h || !h.id) return;
        if (h.type === 'text') {
          const raw = sec.fields && sec.fields[h.id];
          const v = (typeof raw === 'string' ? raw.trim() : '');
          if (v) headerLines.push(`${h.label || h.id}: ${v}.`);
        } else {
          if (sec.checkboxes?.[h.id]) headerLines.push(formatPECheckLabel(h.label || h.id));
        }
      });
      if (headerLines.length) {
        parts.push(headerLines.join("\n"));
        parts.push(""); // plain-text blank line before subjective heading
        // Global guard so we don't re-emit during per-section build
        state.globals._emittedSubjHeaderOnce = true;
      }
    }
  } catch(e) {
    console.warn("[CompleteNote] could not prepend headerItems", e);
  }
  for (const m of modes){
    try {
      const txt = await buildNoteForMode(m);
      if (txt && txt.trim()) {
        const sep = (m === "subjective") ? "\n\n" : "\n";   // extra blank line after subjective
        const heading = SECTION_HEADS[m] || m;
        if (m === "PE") {
          // Insert Objective heading before the Physical Exam section
          parts.push(`Objective:\n`);
        }
        parts.push(`${heading}:\n${txt.trim()}${sep}`);
      }
    } catch (e) {
      console.debug('[CompleteNote] skip', m, e?.message || e);
    }
  }
  box.value = parts.join('\n').trim();
  const view = document.getElementById('completeOutView');
  if (view) view.innerHTML = _completeTextToHTML(box.value);
  _updateCnMetrics();
  _autosizeCnTextarea();
}

// --- Complete Note UI Enhancements ---
function enhanceCompleteNoteUI(){
  const ta = document.getElementById('completeOut');
  if (!ta || ta.dataset.enhanced === "1") return;

  // Wrap in a panel (without header toolbar)
  const wrap = document.createElement('section');
  wrap.className = 'panel complete-note';
  const parent = ta.parentElement;
  parent.insertBefore(wrap, ta);
  const body = document.createElement('div');
  body.className = 'complete-note__body';
  wrap.appendChild(body);
  body.appendChild(ta);
    // Create formatted view
  const view = document.createElement('div');
  view.id = 'completeOutView';
  view.className = 'complete-note__view';

  // Make view focusable and confine Cmd/Ctrl+A to just this block
  view.setAttribute('tabindex', '0');
  view.addEventListener('keydown', (e) => {
    const isSelectAll = (e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A');
    if (isSelectAll) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(view);
      sel.removeAllRanges();
      sel.addRange(range);
      e.preventDefault();
      e.stopPropagation();
    }
  });

  body.insertBefore(view, ta);
  ta.style.display = 'none'; // hide the raw textarea

  ta.dataset.enhanced = "1";
  ta.classList.add('complete-note__textarea');

  // Live updates on input
  ta.addEventListener('input', debounce(()=>{ _updateCnMetrics(); _autosizeCnTextarea(); }, 60));

  // Initial metrics + fit
  _updateCnMetrics();
  _autosizeCnTextarea();

  // Refit on window resizes
  window.addEventListener('resize', debounce(_autosizeCnTextarea, 120));
}

function updateSectionPreviewScope(){
  const scope = document.getElementById("sectionPreviewScope");
  if (!scope) return;
  const modeLabel = MODE_LABELS[state.mode] || state.mode || "Section";
  const sectionLabel = state.activeSection || "No section selected";
  scope.textContent = `${modeLabel} · ${sectionLabel}`;
}

function _completeTextToHTML(txt){
  const breakLabels = [
    "Past Medical", "Surgical Hx", "Meds", "Allergies", "Social", "LMP", "Family Hx"
  ];
  const lines = String(txt || '').split(/\r?\n/);

  // Stateful render so we can detect sub-lines following PMH labels
  const out = [];
  let inPMHBlock = false;

  for (const rawLine of lines) {
    const line = String(rawLine);
    const t = line.trim();

    // Blank line handling
    if (!t) {
      out.push('<div class="cn-line cn-blank">&nbsp;</div>');
      // A blank line ends a PMH sub-block
      inPMHBlock = false;
      continue;
    }

    // Section headers like "subjective:", "Objective:", "Physical Exam:", "HPI:", "PE:", "MSE:"
    const sec = t.match(/^([A-Za-z ]{2,30}):$/);
    if (sec) {
      const label = sec[1];
      const normLabel = label.toLowerCase();
      const isKnownHeader =
        normLabel === "subjective" ||
        normLabel === "objective" ||
        normLabel === "physical exam" ||
        normLabel === "mse" ||
        normLabel === "hpi" ||
        normLabel === "pe" ||
        normLabel === "ros";
      const isH1 = normLabel === "subjective" || normLabel === "objective";
      if (isKnownHeader) {
        const shown =
          normLabel === "pe" ? "Physical Exam" :
          normLabel === "subjective" ? "Subjective" :
          normLabel === "objective" ? "Objective" :
          normLabel === "physical exam" ? "Physical Exam" :
          normLabel === "mse" ? "MSE" :
          normLabel === "hpi" ? "HPI" :
          "ROS";
        const cls = isH1 ? 'section-head head-h1' : 'section-head';
        out.push(`<div class="cn-line"><span class="${cls}">${shown}</span></div>`);
        // entering a section header ends any PMH block
        inPMHBlock = false;
        continue;
      }
    }

    // Explicit PMH label lines (we break and style them as a mini header)
    const isPMHLabelLine = breakLabels.some(lbl => t.startsWith(lbl + ":"));
    if (isPMHLabelLine) {
      const replaced = t.replace(/^([^:\n]{1,80}):\s*/, (m, label)=>{
        return `<span class="item-label">${label}</span>: `;
      });
      out.push(`<br><div class="cn-line section-head PMH">${replaced}</div>`);
      // Next non-labeled lines belong to this PMH block
      inPMHBlock = true;
      continue;
    }

    // If we are inside a PMH block and the current line is not a "Label: value" line,
    // render as a sub-line (bullet style). A new "Label:" line will end the PMH block below.
    const looksLikeLabeled = /^([^:\n]{1,80}):\s+/.test(t);
    if (inPMHBlock && !looksLikeLabeled) {
      out.push(`<div class="cn-line cn-subline">&bull; ${escapeHTML(t)}</div>`);
      continue;
    }

    // Any other new labeled line ends the PMH block and renders normally
    if (looksLikeLabeled) {
      inPMHBlock = false;
    }

    // Default: underline leading "Label:" spans as item-label
    const replaced = t.replace(/^([^:\n]{1,80}):\s*/, (m, label)=>{
      return `<span class="item-label">${label}</span>: `;
    });
    out.push(`<div class="cn-line">${replaced}</div>`);
  }

  return out.join('');
}

function _updateCnMetrics(){
  const ta = document.getElementById('completeOut');
  const m  = document.querySelector('.cn-metrics[data-cn="metrics"]');
  if (!ta || !m) return;
  const txt = ta.value || "";
  const chars = txt.length;
  const words = (txt.trim().match(/\S+/g) || []).length;
  const lines = txt ? txt.split(/\r\n|\n|\r/).length : 0;
  m.textContent = `${chars} chars · ${words} words · ${lines} lines`;
}

function _autosizeCnTextarea(){
  const ta = document.getElementById('completeOut');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, window.innerHeight * 0.6) + 'px';
}

function _toggleCnFullscreen(){
  const wrap = document.querySelector('.panel.complete-note');
  if (!wrap) return;
  const on = wrap.classList.toggle('is-fullscreen');
  document.body.classList.toggle('cn-modal-open', on);
  _autosizeCnTextarea();
}

// Single-line input (text) with label; supports stacked label above input if stacked=true
function fieldText(id, label, value, onChange, placeholder, stacked=false){
  // Wrapper + label
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.className = "field-label";
  span.textContent = label;

  // Choose input type based on isMultilineField
  const isMultiline = isMultilineField(id, label);
  const input = isMultiline ? document.createElement("textarea") : document.createElement("input");
  input.setAttribute('data-field-id', id);

  if (isMultiline) {
    // ----- Textarea behavior -----
    input.rows = 3; // user can resize; good default height
    input.value = value || "";
    input.placeholder = (placeholder ?? label);
    input.oninput = (e) => onChange(e.target.value);
    // keep it full-width for readability
    input.style.width = "100%";
    input.style.resize = "vertical";
    const autoresize = () => { input.style.height = 'auto'; input.style.height = (input.scrollHeight + 2) + 'px'; };
    input.addEventListener('input', autoresize);
    // Trigger once to size to existing content
    setTimeout(autoresize, 0);
  } else {
    // ----- Single-line input -----
    input.type = "text";
    input.value = value || "";
    input.placeholder = (placeholder ?? label);
    input.oninput = (e) => onChange(e.target.value);
  }

  if (stacked && state.mode === "subjective") {
    // Force vertical stack even if .field is flex-row in CSS
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'stretch';
    wrap.style.gap = '4px';

    // Put the label above the input and make input fill the row
    span.style.display = 'block';
    span.style.marginBottom = '0';
    input.style.display = 'block';
    input.style.width = '100%';
  }

  wrap.append(span, input);
  return wrap;
}

// Visibility helper for conditional fields
function shouldShowField(f) {
  if (!f || !f.showIf) return true;
  const depVal = getField(f.showIf.field);
  return depVal === f.showIf.equals;
}

// Boolean field (Yes/No) with optional UI labels
function fieldBoolean(id, label, value, onChange, ui = {}) {
  const yesLabel = ui.trueLabel ?? "Yes";
  const noLabel  = ui.falseLabel  ?? "No";

  const wrap = document.createElement("fieldset");
  wrap.className = "field field-boolean";
  const legend = document.createElement("legend");
  legend.className = "field-label";
  legend.textContent = label;
  wrap.appendChild(legend);

  // radio group name must be unique per field id
  const name = `bool_${id}`;

  const mkOpt = (lab, val) => {
    const optWrap = document.createElement("label");
    optWrap.className = "bool-opt";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.checked = value === val;
    input.onchange = () => onChange(val);
    const span = document.createElement("span");
    span.textContent = lab;
    optWrap.append(input, span);
    return optWrap;
  };

  wrap.appendChild(mkOpt(yesLabel, true));
  wrap.appendChild(mkOpt(noLabel, false));
  return wrap;
}

function fieldRange(id, label, value, onChange, min = 0, max = 10, step = 1, stacked = false) {
  const wrap = document.createElement("label");
  wrap.className = "field field-range";

  const span = document.createElement("span");
  span.className = "field-label";
  span.textContent = label;

  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value || 0;
  input.style.gridArea = '1 / 1 / auto / span 1';
  input.style.zIndex = '99';

  input.onchange = (e) => { onChange(e.target.value); };

  // Right side: slider on row 1; ticks row under it
  const right = document.createElement("div");
  right.className = "field-range-right";
  // Inline layout to prevent ticks overlapping
  right.style.display = 'grid';
  right.style.gridTemplateRows = 'auto auto';
  right.style.gridTemplateColumns = '1fr auto';
  right.style.alignItems = 'center';
  right.style.gap = '6px 8px';
  right.style.maxWidth = '275px';

  if (stacked && state.mode === "subjective") {
    // Force vertical stack even if .field is flex-row in CSS
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'stretch';
    wrap.style.gap = '4px';

    span.style.display = 'block';
    span.style.marginBottom = '0';
    right.style.width = '100%';
  }

  // --- ticks + labels (0..10) ---
  const ticksWrap = document.createElement("div");
  ticksWrap.className = "range-ticks";
  // Ticks row spans beneath both columns with precise offsets
  ticksWrap.style.marginLeft = '-1px';
  ticksWrap.style.marginRight = '2px';
  ticksWrap.style.gridArea = '2 / 1 / auto / span 2';
  ticksWrap.style.display = 'grid';
  ticksWrap.style.gridTemplateColumns = 'repeat(11, 1fr)';
  ticksWrap.style.marginTop = '-15px';
  const nMin = Number(min), nMax = Number(max), nStep = Number(step) || 1;
  for (let i = nMin; i <= nMax; i += nStep) {
    const cell = document.createElement("div");
    cell.className = "tick-cell";
    const tick = document.createElement("div");
    tick.className = "tick";
    const lab  = document.createElement("div");
    lab.className = "tick-label";
    lab.textContent = String(i);
    cell.append(tick, lab);
    ticksWrap.appendChild(cell);
  }

  right.append(input, ticksWrap);
  wrap.append(span, right);
  return wrap;
}

// Helper to apply chip visual state classes and a debug data attribute
function applyChipVisualState(el, pos, neg){
  const classes = ["chip"];
  if (pos)      classes.push(CLASS_CRITICAL);
  else if (neg) classes.push(CLASS_NORMAL);
  el.className = classes.join(" ");
  // Debug-friendly attribute so you can see state in DevTools
  el.setAttribute("data-state", pos ? "critical" : (neg ? "normal" : "neutral"));
}

function chip(def, value, onMouse){
  // value: 0 | 'neg' | {state:'pos', side?, grade?, tags?}
  const d = document.createElement("div");
  const pos = isPos(value), neg = isNeg(value);
  applyChipVisualState(d, pos, neg);
  d.title = `state: ${pos ? "critical" : (neg ? "normal" : "neutral")}`;
  d.oncontextmenu = (e)=>e.preventDefault();
  d.onpointerdown = onMouse;   // use pointer events for reliable L/R detection
  // Fallback for environments that don't deliver button codes on pointer events
  if (!("onpointerdown" in window)) {
    d.onmousedown = onMouse;
  }

  const affPlus = document.createElement("button");
  affPlus.type = "button";
  affPlus.className = "aff plus";
  affPlus.textContent = "+";
  affPlus.onclick = (e) => {
    e.stopPropagation();
    setChipPos(def.id);
    renderGrid(); renderOutput();
    renderCompleteSoon();
  };

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = def.label;

  const affMinus = document.createElement("button");
  affMinus.type = "button";
  affMinus.className = "aff minus";
  affMinus.textContent = "–";
  affMinus.onclick = (e) => {
    e.stopPropagation();
    setChipNeg(def.id); // minus sets normal/absent state
    renderGrid();
    renderOutput();
    renderCompleteSoon();
  };

  d.append(affPlus, label, affMinus);

  if (pos && def.mods){
    const mods = document.createElement("div");
    mods.className = "chip-mods";
    // grades
    if (def.mods.grades){
      const labels = GRADE_LABELS[def.mods.grades] || [];
      labels.forEach((lab, idx)=>{
        const b = miniBtn(lab, asObj(value)?.grade === idx, ()=> setChipGrade(def.id, idx));
        mods.appendChild(b);
      });
    }
    // sides
    if ((def.type||"").includes("sided")){
      [["R","R"],["L","L"],["B","bilat"]].forEach(([code,lab])=>{
        const b = miniBtn(lab, asObj(value)?.side===code, ()=> setChipSide(def.id, code));
        mods.appendChild(b);
      });
    }
    // tags
    if (def.mods.tags){
      def.mods.tags.forEach(tag=>{
        const on = !!asObj(value)?.tags?.[tag];
        mods.appendChild(miniBtn(tag, on, ()=> setChipTag(def.id, tag, !on)));
      });
    }
    d.appendChild(mods);
  }
  return d;
}

function miniBtn(label, active, on){
  const b = document.createElement("button");
  b.type="button";
  b.className = "btn-mini" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = (e)=>{ e.stopPropagation(); on(); };  // prevent chip's handler from firing on mini button clicks
  return b;
}

function setChipPos(id){
  const s=getSec(); const cur=s.chips[id];
  s.chips[id] = isPos(cur) ? cur : { state:'pos' };
  saveStateSoon();
}

function setChipNeg(id){ getSec().chips[id] = 'neg'; saveStateSoon(); }
function clearChip(id){  getSec().chips[id] = 0; saveStateSoon(); }

function setChipGrade(id, grade){ setChipPos(id); getSec().chips[id].grade = grade; saveStateSoon(); renderOutput(); renderGrid(); renderCompleteSoon(); }
function setChipSide(id, side){  setChipPos(id); getSec().chips[id].side  = side;  saveStateSoon(); renderOutput(); renderGrid(); renderCompleteSoon(); }
function setChipTag(id, tag, on){ setChipPos(id); (getSec().chips[id].tags ??= {})[tag] = !!on; saveStateSoon(); renderOutput(); renderCompleteSoon(); }

function setChipState(id, next){  // next: 0 | 'neg' | 'pos'
  const s = getSec();
  s.chips[id] = next;
  saveStateSoon();
}

function handleChipMouse(e, id){
  console.debug("chip mousedown", { id, button: e.button, mode: state.mode });
  // 0 = left, 2 = right
  if (e.button === 2) {           // right click -> present/abnormal
    e.preventDefault();
    setChipPos(id);               // guarantees object {state:'pos',...}
    // If we're in ROS, adding a positive should unset the section's 'neg' checkbox
    if (state.mode === "ROS"){
      const sec = getSec();
      Object.keys(sec.checkboxes || {}).forEach(k => { if (/_neg$/.test(k)) sec.checkboxes[k] = false; });
    }
  } else if (e.button === 0) {    // left click -> normal/absent (toggle to clear)
    const cur = getSec().chips?.[id] || 0;
    getSec().chips[id] = isNeg(cur) ? 0 : 'neg';
  }
  console.debug("chip state", { id, value: getSec().chips[id] });
  // Repaint UI every time so classes/inline controls update immediately
  saveStateSoon();
  renderGrid();
  renderOutput();
  renderCompleteSoon();
}

function ensureSectionState(){
  (Templates.sectionsByMode[state.mode]||[]).forEach(sec=>{
    const k = `${state.mode}:${sec}`;
    state.sections[k] ??= { checkboxes:{}, chips:{}, fields:{} };
  });
}
function getSec(){
  const k = `${state.mode}:${state.activeSection}`;
  state.sections[k] ??= { checkboxes:{}, chips:{}, fields:{} };
  return state.sections[k];
}
function toggleChip(id){ const s=getSec(); s.chips[id]=!s.chips[id]; }

function findDef(secKey, id){
  const def = Templates.sectionDefs[secKey];
  return [
    ...(def?.headerItems||[]), 
    ...(def?.headerToggles||[]),
    ...((def?.panels||[]).flatMap(p=>[
      ...(p.checkboxes||[]),
      ...(p.chips||[]),
      ...((p.subsections||[]).flatMap(ss=>[
        ...(ss.checkboxes||[]),
        ...(ss.chips||[])
      ]))
    ]))
  ].find(x=>x.id===id) || {label:id};
}

function formatChipForOutput(secKey, id, v){
  const def = findDef(secKey, id);
  const obj = asObj(v) || {};

  // Prefer explicit abnormal text from template; fall back to the label
  const base = (def.abnText || def.label || id).replace(/^\+\s*/, "");
  const parts = [base];

  // Attach modifiers (side -> leading, grade/tags -> trailing)
  if (obj.side) parts.unshift(SIDE_LABELS[obj.side] || obj.side);
  if (typeof obj.grade === "number" && def.mods?.grades){
    const glab = (GRADE_LABELS[def.mods.grades] || [])[obj.grade];
    if (glab) parts.push(glab);
  }
  if (obj.tags){
    Object.entries(obj.tags).forEach(([tag, on]) => { if (on) parts.push(tag); });
  }

  // Visual criticality handled via chip classes; no bold here
  return parts.join(" ");
}

function escapeHTML(s){
  return String(s).replace(/[&<>\"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  })[c]);
}

function labelFor(secKey, id){
  // Reuse the same lookup as output rendering, including subsections
  const d = findDef(secKey, id);
  return d?.label || id;
}

function renderMatrixPanel(pd){
  const p = panel(pd.title);
  const m = pd.matrix || {};
  const sec = getSec();
  sec.matrix ??= {}; sec.matrix[pd.id] ??= {};
  // actions row
  if (m.actions?.length){
    const row = makeRow();
    if (m.actions.includes("setAll2plus")) row.appendChild(miniBtn("Set all 2+", false, ()=> setMatrixAll(pd.id, 2, m)));
    if (m.actions.includes("setAll1plus")) row.appendChild(miniBtn("Set all 1+", false, ()=> setMatrixAll(pd.id, 1, m)));
    if (m.actions.includes("clearAll"))    row.appendChild(miniBtn("Clear all",  false, ()=> clearMatrix(pd.id, m)));
    p.appendChild(row);
  }
  // simple inline grid using buttons (works without extra CSS)
  const grid = document.createElement("div"); grid.style.display="grid";
  grid.style.gridTemplateColumns = `160px repeat(${(m.cols||[]).length||2}, 1fr)`;
  grid.style.gap = "4px";
  const hdr = (t)=>{ const h=document.createElement("div"); h.style.fontWeight="600"; h.style.color="var(--muted)"; h.textContent=t; return h; };
  grid.appendChild(hdr(" ")); (m.cols||["Right","Left"]).forEach(c=> grid.appendChild(hdr(c)));
  (m.rows||[]).forEach((rName, rIdx)=>{
    grid.appendChild(hdr(rName));
    (m.cols||["Right","Left"]).forEach((_, cIdx)=>{
      const cell = document.createElement("div"); cell.style.display="flex"; cell.style.gap="4px"; cell.style.flexWrap="wrap";
      const current = sec.matrix[pd.id]?.[rIdx]?.[cIdx] ?? null;
      const labels = GRADE_LABELS[m.grades] || ["0","1+","2+","3+"];
      labels.forEach((lab, gIdx)=>{
        const b = miniBtn(lab, current===gIdx, ()=> setMatrixGrade(pd.id, rIdx, cIdx, current===gIdx ? null : gIdx));
        cell.appendChild(b);
      });
      grid.appendChild(cell);
    });
  });
  p.appendChild(grid);
  return p;
}

function setMatrixGrade(panelId, rowIdx, colIdx, gradeOrNull){
  const sec = getSec(); sec.matrix ??= {}; sec.matrix[panelId] ??= {};
  sec.matrix[panelId][rowIdx] ??= {};
  sec.matrix[panelId][rowIdx][colIdx] = gradeOrNull;
  saveStateSoon();
  renderOutput();
  renderCompleteSoon();
}
function setMatrixAll(panelId, gradeIndex, meta){
  const sec = getSec(); sec.matrix ??= {}; sec.matrix[panelId] ??= {};
  const rows = (meta.rows||[]).length, cols=(meta.cols||[]).length;
  for(let r=0;r<rows;r++){
    sec.matrix[panelId][r] ??= {};
    for(let c=0;c<cols;c++) sec.matrix[panelId][r][c] = gradeIndex;
  }
  saveStateSoon();
  renderGrid(); renderOutput();
  renderCompleteSoon();
}
function clearMatrix(panelId, meta){
  const sec = getSec(); sec.matrix ??= {}; sec.matrix[panelId] ??= {};
  const rows = (meta.rows||[]).length, cols=(meta.cols||[]).length;
  for(let r=0;r<rows;r++){
    sec.matrix[panelId][r] ??= {};
    for(let c=0;c<cols;c++) sec.matrix[panelId][r][c] = null;
  }
  saveStateSoon();
  renderGrid(); renderOutput();
  renderCompleteSoon();
}

function wireHeader(){
  document.getElementById("copyBtn").onclick = ()=>{
    navigator.clipboard.writeText(document.getElementById("out").value);
  };
  document.getElementById("copyFullBtn").onclick = ()=>{
    navigator.clipboard.writeText(document.getElementById("completeOut").value);
  };
  document.getElementById("clearSectionBtn").onclick = ()=>{
    state.sections[`${state.mode}:${state.activeSection}`] = {checkboxes:{}, chips:{}, fields:{}};
    saveStateSoon();
    renderGrid(); renderOutput();
    renderCompleteSoon();
  };
  document.getElementById("clearAllBtn").onclick = ()=>{
    Object.keys(state.sections).forEach(k=> state.sections[k]={checkboxes:{},chips:{},fields:{}});
    saveStateSoon();
    renderGrid(); renderOutput();
    renderCompleteSoon();
  };
  renderPatientControls();
}

function capFirst(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function lcFirst(s){ return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function joinWithOxford(list, conj="or"){
  if (!list || list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} ${conj} ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, ${conj} ${list[list.length - 1]}`;
}

function trimSentencePunctuation(s){
  return String(s || "").trim().replace(/[.;:!?]+$/g, "").trim();
}

function parseCheckboxPredicatePhrase(phrase){
  const clean = trimSentencePunctuation(phrase);
  if (!clean) return null;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  // Prefer predicate phrases ending in a preposition (e.g., "oriented to person").
  for (let i = words.length - 2; i >= 0; i--) {
    const token = words[i].toLowerCase();
    if (!CHECKBOX_COMBINE_PREPOSITIONS.has(token)) continue;
    const predicate = words.slice(0, i + 1).join(" ");
    const object = words.slice(i + 1).join(" ");
    if (predicate && object) {
      return { key: `prep:${predicate.toLowerCase()}`, predicate, object };
    }
  }

  // Handle safe one-word predicates (e.g., "impaired attention").
  const lead = words[0].toLowerCase();
  if (CHECKBOX_COMBINE_SINGLE_WORD_PREDICATES.has(lead)) {
    const predicate = words[0];
    const object = words.slice(1).join(" ");
    if (object) return { key: `lead:${lead}`, predicate, object };
  }

  return null;
}

function combineCheckboxPhraseParts(parts){
  const cleaned = (parts || []).map(trimSentencePunctuation).filter(Boolean);
  if (cleaned.length < 2) return cleaned;

  const parsed = cleaned.map(parseCheckboxPredicatePhrase);
  const groupedIdx = new Map();
  parsed.forEach((p, idx) => {
    if (!p) return;
    const list = groupedIdx.get(p.key) || [];
    list.push(idx);
    groupedIdx.set(p.key, list);
  });

  const consumed = new Set();
  const out = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (consumed.has(i)) continue;
    const p = parsed[i];

    if (p) {
      const memberIdx = (groupedIdx.get(p.key) || []).filter(idx => !consumed.has(idx));
      if (memberIdx.length >= 2) {
        const tails = [];
        const seen = new Set();
        memberIdx.forEach(idx => {
          const tail = lcFirst(trimSentencePunctuation(parsed[idx]?.object || ""));
          const key = tail.toLowerCase();
          if (tail && !seen.has(key)) {
            seen.add(key);
            tails.push(tail);
          }
        });
        if (tails.length >= 2) {
          memberIdx.forEach(idx => consumed.add(idx));
          out.push(`${capFirst(p.predicate)} ${joinWithOxford(tails, "and")}`);
          continue;
        }
      }
    }

    consumed.add(i);
    out.push(capFirst(cleaned[i]));
  }

  return out;
}

// Make PE checkbox labels read naturally.
// Example: "nl appearance" -> "Normal appearance"
function formatPECheckLabel(raw){
  if (!raw) return "";
  let s = raw.trim().replace(/^\+\s*/,""); // drop leading "+ " if present
  // expand 'nl' to 'Normal' when it starts the phrase or stands alone
  s = s.replace(/(^|\s)nl(\s|$)/i, (m, p1, p2) => `${p1}Normal${p2}`);
  // Capitalize first letter
  return capFirst(s);
}

// Update your existing negative output to use capitalized "No"/"Denies"
//
// If you already have formatChipNegForOutput, replace its return line with:
//   return isROS ? `Denies ${label}` : `No ${label}`;
//
// Otherwise, add this full function:
function formatChipNegForOutput(secKey, id){
  const def = findDef(secKey, id);

  // If template provides explicit normal text, use it
  if (def.negText) return def.negText;

  // Otherwise, generate from label with mode-specific lead-in
  let label = (def.label || id).replace(/^\+\s*/, "").trim();
  if (label) label = label.charAt(0).toLowerCase() + label.slice(1);

  const isROS = secKey.startsWith("ROS:");
  return isROS ? `Denies ${label}` : `No ${label}`;
}
