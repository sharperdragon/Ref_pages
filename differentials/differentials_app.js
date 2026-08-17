/*! Config (edit here) */
const CONFIG = {
  searchDebounceMs: 180,
  loadConcurrency: 10,
  fetchCacheMode: "default",
  defaultView: "grid",
  defaultShowFreq: true,
  defaultCompact: true,
  defaultHideUnfinished: true,
  stateKey: "diff-ui-state-v6",
};

const PATHS = {
  PRESENTATION_LIST: "./Presentation_list.json",
  BASE_DIR: "./data/presentations",
  INDEX_SOURCES: {
    clinical: "./clinical_presentation_index.json",
    nonClinical: "./non-clinical_presentation_index.json",
  },
};

const SECTION_META = {
  "Clinical": { folder: "clinical", indexSource: "clinical" },
  "Biochemical": { folder: "biochemical", indexSource: "nonClinical" },
  "Hematological": { folder: "hematological", indexSource: "nonClinical" },
};

const TITLE_ALIASES = {
  Abdominal: ["Abdominal pain"],
  Diarrhea: ["Diarrhea"],
  Dyspnea: ["Dyspnea"],
  "Fecal incontinence": ["Faecal incontinence"],
  Hyperkalemia: ["Hyperkalaemia"],
  Uremia: ["Uraemia"],
};

const FILE_SLUG_ALIASES = {
  Diarrhea: ["diarrhea"],
  Dyspnea: ["dyspnea"],
  Hyperkalemia: ["hyperkalaemia"],
  Uremia: ["uraemia"],
};

// Canonical groups used for sidebar "Systems" chips.
const SYSTEM_CHIP_RULES = [
  { label: "Cardiovascular", pattern: /\b(cardio|cardiac|vascular|vasovagal|arrhythm|hypotension|venous|arterial|circulatory)\b/ },
  { label: "Respiratory", pattern: /\b(respir|pulmonary|airway|trache|bronch|pleur)\b/ },
  { label: "Neurologic", pattern: /\b(neuro|cns|cerebr|brain|spinal|neurone|neuromuscular|neuropath|seizure|migraine|tremor|syncope)\b/ },
  { label: "Gastrointestinal / Hepatic", pattern: /\b(gastro|abdominal|bowel|intestinal|stomach|duoden|colon|rect|anal|anorectal|esoph|oesoph|hepato|liver|pancrea|biliar|splen|periton|visceral)\b/ },
  { label: "Renal / Genitourinary", pattern: /\b(renal|kidney|ureter|urethra|bladder|urinary|nephro|prostate|post renal)\b/ },
  { label: "Hematologic", pattern: /\b(haemat|hemat|haemol|hemol|leuk|platelet|anemi|thromb)\b/ },
  { label: "Endocrine / Metabolic", pattern: /\b(endocrine|metabolic|pituitary|adrenal|thyroid)\b/ },
  { label: "Musculoskeletal", pattern: /\b(musculo|joint|ligament|menisci|tendon|bone|gait)\b/ },
  { label: "Dermatologic", pattern: /\b(dermat|skin|nail|scalp|pruritus|ulcer)\b/ },
  { label: "Reproductive", pattern: /\b(gynae|gyne|ovar|uter|fallopian|vaginal|pregnan|obstet|penis|scrot|foreskin|breast|testic)\b/ },
  { label: "HEENT", pattern: /\b(eye|ear|nasal|nose|throat|pharyn|laryng|mastoid|salivary|parotid|tongue|lip|jaw)\b/ },
  { label: "Systemic", pattern: /\b(systemic|general|constitutional)\b/ },
];

/*! UI State */
const UI = {
  q: "",
  section: "",
  systems: new Set(),
  view: CONFIG.defaultView,
  showFreq: CONFIG.defaultShowFreq,
  compact: CONFIG.defaultCompact,
  hideUnfinished: CONFIG.defaultHideUnfinished,
};

const SESSION = {
  selectedKey: null,
  filteredEntries: [],
};

/* ---------------------------------- Utils --------------------------------- */
const $ = (s) => document.querySelector(s);
const hostEl = () => $("#results") || $("#grid");
const errEl = () => $("#error");
const detailPanelEl = () => $("#detailPanel");
const detailScrimEl = () => $("#detailScrim");
const JSON_CACHE = new Map();

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function uniqSorted(arr) {
  return uniq(arr).sort((a, b) => a.localeCompare(b));
}

function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function underscorify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeSearch(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .toLowerCase();
}

function normalizeTitleKey(s) {
  return normalizeSearch(s)
    .replace(/&/g, "and")
    .replace(/ae/g, "e")
    .replace(/oe/g, "e")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeSystemLabel(system) {
  const clean = String(system || "")
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

function deriveSystemChip(system) {
  const clean = normalizeSystemLabel(system);
  if (!clean) return null;
  const normalized = normalizeSearch(clean);
  const match = SYSTEM_CHIP_RULES.find((rule) => rule.pattern.test(normalized));
  return match ? match.label : null;
}

function isCompactViewport() {
  return window.matchMedia("(max-width: 1199px)").matches;
}

function makeEntryKey(entry) {
  return `${entry.section || ""}::${entry.title || ""}`;
}

async function fetchJSON(url) {
  if (JSON_CACHE.has(url)) return JSON_CACHE.get(url);
  const p = fetch(url, { cache: CONFIG.fetchCacheMode }).then(async (res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
    return res.json();
  });
  JSON_CACHE.set(url, p);
  return p;
}

async function fetchJSONOptional(url) {
  try {
    return await fetchJSON(url);
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, mapper, onProgress) {
  if (!items.length) return [];
  const out = new Array(items.length);
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      out[idx] = await mapper(items[idx], idx);
      done += 1;
      if (onProgress) onProgress(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.name}|${it.system}|${it.freq ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapItem(it) {
  const name = String(it?.name ?? it?.etiology ?? it?.title ?? it?.label ?? "").trim();
  const system = normalizeSystemLabel(it?.system ?? it?.category ?? it?.group ?? "");
  const freqRaw = it?.freq ?? it?.frequency ?? it?.rank;
  const freq = freqRaw == null || freqRaw === "" ? undefined : String(freqRaw);
  return { name: name || "—", system, freq };
}

function normalizeEntry(title, section, data) {
  const itemsRaw =
    data?.items ||
    data?.differentials ||
    data?.etiologies ||
    data?.causes ||
    [];

  const items = dedupeItems((itemsRaw || []).map(mapItem)).filter((it) => it.name && it.name !== "—");

  return {
    title: String(title || data?.title || data?.presentation || "Untitled"),
    section: String(section || data?.section || ""),
    items,
  };
}

function prepareEntry(entry) {
  const items = (entry.items || []).map((it) => ({
    ...it,
    _systemChip: deriveSystemChip(it.system),
    _q: normalizeSearch(`${it.name} ${it.system} ${it.freq ?? ""}`),
  }));

  const out = {
    ...entry,
    items,
    _q: normalizeSearch(`${entry.title} ${entry.section}`),
    _isIncomplete: items.length === 0,
  };
  out._key = makeEntryKey(out);
  return out;
}

/* ------------------------------- Index Parse ------------------------------ */
function flattenIndexNode(system, node, out) {
  if (Array.isArray(node)) {
    node.forEach((name) => out.push(mapItem({ name, system })));
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [etiology, meta] of Object.entries(node)) {
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const freq = meta.freq ?? meta.frequency ?? meta.rank;
      if (freq != null) {
        out.push(mapItem({ name: etiology, system, freq }));
        continue;
      }

      const before = out.length;
      flattenIndexNode(system, meta, out);
      if (out.length === before && Object.keys(meta).length === 0) {
        out.push(mapItem({ name: etiology, system }));
      }
      continue;
    }

    if (Array.isArray(meta)) {
      if (meta.length) {
        meta.forEach((name) => out.push(mapItem({ name, system })));
      } else {
        out.push(mapItem({ name: etiology, system }));
      }
      continue;
    }

    out.push(mapItem({ name: etiology, system, freq: meta }));
  }
}

function parseIndexEntry(section, title, raw) {
  const items = [];
  if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([system, node]) => flattenIndexNode(system, node, items));
  }
  return normalizeEntry(title, section, { items });
}

function buildIndexLookup(indexObj) {
  const map = new Map();
  if (!indexObj || typeof indexObj !== "object") return map;
  Object.keys(indexObj).forEach((key) => map.set(normalizeTitleKey(key), key));
  return map;
}

function resolveIndexKey(title, indexObj, lookupMap) {
  if (!indexObj) return null;
  const candidates = [title, ...(TITLE_ALIASES[title] || [])];

  for (const cand of candidates) {
    if (Object.prototype.hasOwnProperty.call(indexObj, cand)) return cand;
  }

  for (const cand of candidates) {
    const key = lookupMap.get(normalizeTitleKey(cand));
    if (key) return key;
  }

  return null;
}

/* ------------------------------ File Fallback ----------------------------- */
function candidateSlugsForTitle(title) {
  return uniq([
    ...(FILE_SLUG_ALIASES[title] || []),
    slugify(title),
    underscorify(title),
  ]).filter(Boolean);
}

function candidateURLsForTitle(section, title) {
  const meta = SECTION_META[section];
  if (!meta) return [];

  const slugs = candidateSlugsForTitle(title);
  const subdirs = meta.folder === "clinical" ? ["", "other/", "todo/"] : [""];

  const urls = [];
  slugs.forEach((slug) => {
    subdirs.forEach((subdir) => {
      urls.push(`${PATHS.BASE_DIR}/${meta.folder}/${subdir}${slug}.json`);
    });
  });
  return uniq(urls);
}

async function loadFromPresentationFile(section, title) {
  const urls = candidateURLsForTitle(section, title);
  for (const url of urls) {
    const data = await fetchJSONOptional(url);
    if (data) return normalizeEntry(title, section, data);
  }
  return normalizeEntry(title, section, {});
}

/* ------------------------------ Data Loading ------------------------------ */
async function loadData(onProgress) {
  const [presentationList, clinicalIndex, nonClinicalIndex] = await Promise.all([
    fetchJSON(PATHS.PRESENTATION_LIST),
    fetchJSONOptional(PATHS.INDEX_SOURCES.clinical),
    fetchJSONOptional(PATHS.INDEX_SOURCES.nonClinical),
  ]);

  const indexBySource = {
    clinical: clinicalIndex,
    nonClinical: nonClinicalIndex,
  };

  const lookupBySource = {
    clinical: buildIndexLookup(clinicalIndex),
    nonClinical: buildIndexLookup(nonClinicalIndex),
  };

  const jobs = [];
  Object.entries(presentationList || {}).forEach(([section, arr]) => {
    (arr || []).forEach((obj) => {
      const title = typeof obj === "string" ? obj : obj?.name;
      if (title) jobs.push({ section, title: String(title) });
    });
  });

  const entries = await mapWithConcurrency(
    jobs,
    CONFIG.loadConcurrency,
    async ({ section, title }) => {
      const meta = SECTION_META[section] || null;
      const indexSourceKey = meta?.indexSource || null;
      const indexObj = indexSourceKey ? indexBySource[indexSourceKey] : null;
      const lookupMap = indexSourceKey ? lookupBySource[indexSourceKey] : null;

      if (indexObj && lookupMap) {
        const indexKey = resolveIndexKey(title, indexObj, lookupMap);
        if (indexKey) {
          const fromIndex = parseIndexEntry(section, title, indexObj[indexKey]);
          if (fromIndex.items.length > 0) return prepareEntry(fromIndex);
        }
      }

      const fromFile = await loadFromPresentationFile(section, title);
      return prepareEntry(fromFile);
    },
    onProgress
  );

  return entries;
}

/* -------------------------------- Rendering ------------------------------- */
function setError(message) {
  const el = errEl();
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
}

function clearError() {
  const el = errEl();
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function renderSystemsChips(allSystems, onChange) {
  const box = $("#systemChips");
  if (!box) return;

  box.innerHTML = "";
  allSystems.forEach((sys) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip${UI.systems.has(sys) ? " chip--on" : ""}`;
    chip.textContent = sys || "—";
    chip.addEventListener("click", () => {
      if (UI.systems.has(sys)) UI.systems.delete(sys);
      else UI.systems.add(sys);
      saveState();
      renderSystemsChips(allSystems, onChange);
      if (onChange) onChange();
    });
    box.appendChild(chip);
  });
}

function applyFilters(entries) {
  const q = normalizeSearch(UI.q.trim());
  const hasSystemFilter = UI.systems.size > 0;

  return entries
    .filter((e) => !UI.section || e.section === UI.section)
    .map((e) => {
      const bySystem = hasSystemFilter
        ? (e.items || []).filter((it) => it._systemChip && UI.systems.has(it._systemChip))
        : [...(e.items || [])];

      const titleHit = q ? e._q.includes(q) : false;
      const itemHits = q ? bySystem.filter((it) => it._q.includes(q)) : bySystem;
      const itemsFinal = titleHit ? bySystem : itemHits;

      return {
        ...e,
        items: itemsFinal,
      };
    })
    .filter((e) => {
      if (e.items.length > 0) return true;
      if (e._isIncomplete) {
        return false;
      }
      return q ? e._q.includes(q) : false;
    });
}

function emptyNode() {
  const d = document.createElement("div");
  d.className = "empty";
  d.innerHTML = "<div class=\"empty__title\">No matches</div><div class=\"empty__body\">Try broader terms or clear filters.</div>";
  return d;
}

function buildEtiologyTable(items) {
  const table = document.createElement("table");
  table.className = "soft-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const headers = ["Etiology", "System", "Frequency"];

  headers.forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  items.forEach((it) => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = it.name;
    tr.appendChild(tdName);

    const tdSystem = document.createElement("td");
    tdSystem.textContent = it.system || "—";
    tr.appendChild(tdSystem);

    const tdFreq = document.createElement("td");
    tdFreq.textContent = it.freq ?? "—";
    tr.appendChild(tdFreq);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function setDetailOverlayOpen(open) {
  const scrim = detailScrimEl();
  if (!isCompactViewport()) {
    document.body.classList.remove("detail-open");
    if (scrim) scrim.hidden = true;
    return;
  }

  document.body.classList.toggle("detail-open", open);
  if (scrim) scrim.hidden = !open;
}

function closeDetailOverlay() {
  setDetailOverlayOpen(false);
}

function currentSelectedEntry(entries) {
  if (!SESSION.selectedKey) return null;
  return entries.find((entry) => entry._key === SESSION.selectedKey) || null;
}

function renderDetailPanel(entries) {
  const panel = detailPanelEl();
  const titleEl = $("#detailTitle");
  const metaEl = $("#detailMeta");
  const badgeEl = $("#detailBadge");
  const countEl = $("#detailCount");
  const bodyEl = $("#detailBody");
  const emptyEl = $("#detailEmpty");

  if (!panel || !titleEl || !metaEl || !badgeEl || !countEl || !bodyEl || !emptyEl) return;

  const selected = currentSelectedEntry(entries);
  if (!selected) {
    titleEl.textContent = "No selection";
    metaEl.hidden = true;
    bodyEl.hidden = true;
    bodyEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }

  titleEl.textContent = selected.title;
  badgeEl.className = `badge${selected._isIncomplete ? " badge--coming" : ""}`;
  badgeEl.textContent = selected._isIncomplete ? "Coming soon" : (selected.section || "—");
  countEl.textContent = selected._isIncomplete
    ? "Etiologies not added yet"
    : `${selected.items.length} etiologies`;
  metaEl.hidden = false;

  bodyEl.innerHTML = "";
  if (selected._isIncomplete) {
    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = "This presentation is listed but the differential set has not been completed yet.";
    bodyEl.appendChild(note);
  } else {
    bodyEl.appendChild(buildEtiologyTable(selected.items));
  }

  bodyEl.hidden = false;
  emptyEl.hidden = true;
}

function selectEntry(entry, filteredEntries) {
  SESSION.selectedKey = entry._key;
  renderDetailPanel(filteredEntries);
  setDetailOverlayOpen(true);
}

function renderGrid(entries) {
  const host = hostEl();
  host.className = "grid";
  host.innerHTML = "";

  if (!entries.length) {
    host.appendChild(emptyNode());
    return;
  }

  const isInteractive = (el) => !!el.closest?.("button, a, input, select, textarea, .chip");

  entries.forEach((entry) => {
    const isSelected = SESSION.selectedKey === entry._key;

    const card = document.createElement("article");
    card.className = `card${entry._isIncomplete ? " card--coming" : ""}${isSelected ? " card--active" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(isSelected));

    const header = document.createElement("header");
    header.className = "card__hd";

    const title = document.createElement("h3");
    title.className = "card__title";
    title.textContent = entry.title;

    const badge = document.createElement("span");
    badge.className = `badge${entry._isIncomplete ? " badge--coming" : ""}`;
    badge.textContent = entry._isIncomplete ? "Coming soon" : (entry.section || "—");

    header.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "card__meta";
    meta.textContent = entry._isIncomplete
      ? "Etiologies not added yet"
      : `${entry.items.length} etiologies`;

    card.append(header, meta);
    host.appendChild(card);

    card.addEventListener("click", (ev) => {
      if (isInteractive(ev.target)) return;
      selectEntry(entry, entries);
      renderGrid(entries);
    });

    card.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      if (isInteractive(ev.target)) return;
      ev.preventDefault();
      selectEntry(entry, entries);
      renderGrid(entries);
    });
  });
}

function render(entries) {
  clearError();

  const filtered = applyFilters(entries);
  SESSION.filteredEntries = filtered;

  if (SESSION.selectedKey && !filtered.some((entry) => entry._key === SESSION.selectedKey)) {
    SESSION.selectedKey = null;
    closeDetailOverlay();
  }

  renderGrid(filtered);
  renderDetailPanel(filtered);
  writeHash();
  saveState();
}

/* ------------------------------- Wire controls ---------------------------- */
function wireUI(data) {
  const q = $("#q");
  const section = $("#section");
  const sectionDrawer = $("#sectionDrawer");
  const btnCloseDetail = $("#btnCloseDetail");
  const detailScrim = detailScrimEl();

  const systemsAll = uniqSorted(
    data
      .flatMap((e) => (e.items || []).map((it) => it._systemChip || ""))
      .filter(Boolean)
  );

  const rerender = () => render(data);
  renderSystemsChips(systemsAll, rerender);

  document.body.classList.add("compact");
  if (q) q.value = UI.q;
  if (section) section.value = UI.section;
  if (sectionDrawer) sectionDrawer.value = UI.section;

  if (q) {
    q.addEventListener(
      "input",
      debounce(() => {
        UI.q = q.value;
        rerender();
      }, CONFIG.searchDebounceMs)
    );
  }

  if (section) {
    section.addEventListener("change", () => {
      UI.section = section.value;
      if (sectionDrawer) sectionDrawer.value = UI.section;
      rerender();
    });
  }

  const btnOpen = $("#btnOpenFilters");
  const btnClose = $("#btnCloseFilters");
  const drawerScrim = $("#drawerScrim");
  if (btnOpen) btnOpen.addEventListener("click", openDrawer);
  if (btnClose) btnClose.addEventListener("click", closeDrawer);
  if (drawerScrim) drawerScrim.addEventListener("click", closeDrawer);

  if (btnCloseDetail) btnCloseDetail.addEventListener("click", closeDetailOverlay);
  if (detailScrim) detailScrim.addEventListener("click", closeDetailOverlay);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!isDrawerHidden()) {
        closeDrawer();
      } else if (document.body.classList.contains("detail-open")) {
        closeDetailOverlay();
      } else if (q === document.activeElement) {
        q.blur();
      }
    }

    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && q) {
      e.preventDefault();
      q.focus();
    }
  });

  window.addEventListener("resize", debounce(() => {
    setDetailOverlayOpen(false);
  }, 80));

  if (sectionDrawer) {
    sectionDrawer.addEventListener("change", () => {
      UI.section = sectionDrawer.value;
      if (section) section.value = UI.section;
    });
  }

  const btnClear = $("#btnClearFilters");
  const btnApply = $("#btnApplyFilters");

  const clearAllFilters = () => {
    UI.section = "";
    UI.systems.clear();

    if (section) section.value = "";
    if (sectionDrawer) sectionDrawer.value = "";

    renderSystemsChips(systemsAll, rerender);
    rerender();
  };

  if (btnClear) {
    btnClear.addEventListener("click", clearAllFilters);
  }

  if (btnApply) {
    btnApply.addEventListener("click", () => {
      closeDrawer();
      rerender();
    });
  }

  rerender();
}

/* ------------------------------- Drawer helpers --------------------------- */
function isDrawerHidden() {
  const drawer = $("#drawer");
  return !drawer || drawer.getAttribute("aria-hidden") === "true";
}

function openDrawer() {
  const drawer = $("#drawer");
  if (!drawer) return;
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("scrim-on");
}

function closeDrawer() {
  const drawer = $("#drawer");
  if (!drawer) return;
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("scrim-on");
}

/* ------------------------------ State & Hash ------------------------------ */
function snapshotState() {
  return {
    q: UI.q,
    section: UI.section,
    systems: [...UI.systems],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.stateKey);
    if (!raw) return;
    const s = JSON.parse(raw);
    UI.q = s.q ?? UI.q;
    UI.section = s.section ?? UI.section;
    UI.systems = new Set(s.systems || []);
  } catch {
    /* ignore state restore errors */
  }
}

function saveState() {
  try {
    localStorage.setItem(CONFIG.stateKey, JSON.stringify(snapshotState()));
  } catch {
    /* ignore state save errors */
  }
}

function readHash() {
  try {
    if (!location.hash) return;
    const s = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (typeof s.q === "string") UI.q = s.q;
    if (typeof s.section === "string") UI.section = s.section;
    if (Array.isArray(s.systems)) UI.systems = new Set(s.systems);
  } catch {
    /* ignore hash parse errors */
  }
}

function writeHash() {
  try {
    const hash = encodeURIComponent(JSON.stringify(snapshotState()));
    if (location.hash.slice(1) === hash) return;
    history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`);
  } catch {
    /* ignore hash write errors */
  }
}

/* ----------------------------------- Boot --------------------------------- */
(async function boot() {
  loadState();
  readHash();

  try {
    const data = await loadData();
    wireUI(data);
  } catch (err) {
    setError(err?.message || "Unexpected error");
  }
})();
