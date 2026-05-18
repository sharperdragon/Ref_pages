#!/usr/bin/env python3
"""Populate blank HPI fields in clinical todo JSON files using Pocketbook PDF text.

This script is intentionally heuristic:
- It maps each presentation to its chapter in the PDF.
- It extracts chapter-level clues from CAUSES/HISTORY/EXAMINATION text.
- It applies item-level modifiers from diagnosis/system labels.

The goal is to replace empty arrays with structured, clinically plausible values
grounded in the source chapter text.
"""

from __future__ import annotations

import copy
import json
import re
import subprocess
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple


# -----------------------------
# USER SETTINGS (edit)
# -----------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
PDF_FILENAME = "Pocketbook of Differential Diagnosis (2021).pdf"

# Direct candidate paths checked first (fast path).
PDF_PATH_CANDIDATES: Sequence[Path] = (
    REPO_ROOT / "differentials" / "source" / PDF_FILENAME,
    Path.home() / "Downloads" / PDF_FILENAME,
    Path.home() / PDF_FILENAME,
)

# Optional recursive search roots checked if none of the direct candidates exist.
PDF_SEARCH_ROOTS: Sequence[Path] = (
    REPO_ROOT,
    Path.home(),
)
ENABLE_RECURSIVE_PDF_SEARCH = True

TODO_DIR = REPO_ROOT / "differentials" / "data" / "presentations" / "clinical" / "todo"
TEXT_CACHE_PATH = Path("/tmp/pocketbook_differential_text.txt")

WRITE_CHANGES = True
FORCE_REWRITE_HPI = True
MIN_CONTENT_PAGE = 20
HEADING_SCAN_LINES = 35


HPI_KEYS: Sequence[str] = (
    "onset",
    "progression",
    "palliate",
    "provoke",
    "quality",
    "timing",
    "region",
    "radiation",
    "severity",
    "clinical tests",
    "other symptoms",
)

PRESENTATION_TEXT_KEYS: Set[str] = {
    "onset",
    "progression",
    "palliate",
    "provoke",
    "quality",
    "timing",
}

ITEM_TEXT_KEYS: Set[str] = set(HPI_KEYS)


US_UK_REPLACEMENTS: Sequence[Tuple[str, str]] = (
    ("diarrhea", "diarrhoea"),
    ("dyspnea", "dyspnoea"),
    ("steatorrhea", "steatorrhoea"),
    ("fecal", "faecal"),
    ("hemat", "haemat"),
    ("hemo", "haemo"),
    ("gynecomastia", "gynaecomastia"),
    ("esophagus", "oesophagus"),
    ("calcemia", "calcaemia"),
    ("glycemia", "glycaemia"),
    ("natremia", "natraemia"),
    ("kalemia", "kalaemia"),
    ("magnesemia", "magnesaemia"),
    ("anemia", "anaemia"),
    ("leuk", "leuc"),
    ("cythemia", "cythaemia"),
    ("uremia", "uraemia"),
)

VALUE_LIMITS: Dict[str, int] = {
    "onset": 3,
    "progression": 2,
    "palliate": 2,
    "provoke": 3,
    "quality": 3,
    "timing": 3,
    "region": 2,
    "radiation": 2,
    "severity": 2,
    "clinical tests": 3,
    "other symptoms": 4,
}


def norm_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if ord(ch) < 128)
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "", value)
    return value


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if ord(ch) < 128)
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return re.sub(r"-{2,}", "-", value)


def clean_heading_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"^\d+\s+", "", line)
    line = re.sub(r"\s+\d+$", "", line)
    return line.strip(" -\t")


def dedupe(values: Iterable[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out


def discover_pdf_path() -> Path:
    for candidate in PDF_PATH_CANDIDATES:
        if candidate.exists():
            return candidate

    if ENABLE_RECURSIVE_PDF_SEARCH:
        for search_root in PDF_SEARCH_ROOTS:
            if not search_root.exists():
                continue
            matches = sorted(search_root.rglob(PDF_FILENAME))
            if matches:
                return matches[0]

    candidate_paths = "\n  - ".join(str(path) for path in PDF_PATH_CANDIDATES)
    search_roots = "\n  - ".join(str(path) for path in PDF_SEARCH_ROOTS)
    raise FileNotFoundError(
        "Could not find the source PDF.\n"
        f"Checked candidate paths:\n  - {candidate_paths}\n"
        f"Recursive search roots:\n  - {search_roots}\n"
        "Set PDF_PATH_CANDIDATES in USER SETTINGS to your local PDF path."
    )


def load_pdf_text(pdf_path: Path) -> str:
    if TEXT_CACHE_PATH.exists():
        return TEXT_CACHE_PATH.read_text(errors="ignore")

    cmd = ["pdftotext", "-layout", str(pdf_path), "-"]
    text = subprocess.check_output(cmd).decode("utf-8", "ignore")
    TEXT_CACHE_PATH.write_text(text)
    return text


def heading_variants(presentation: str) -> Set[str]:
    variants: Set[str] = {presentation}
    lower = presentation.lower()

    for us, uk in US_UK_REPLACEMENTS:
        if us in lower:
            variants.add(re.sub(us, uk, presentation, flags=re.IGNORECASE))
        if uk in lower:
            variants.add(re.sub(uk, us, presentation, flags=re.IGNORECASE))

    variants.add(presentation.replace("&", "and"))
    variants.add(presentation.replace(" and ", " "))
    variants.add(presentation.replace("-", " "))

    return {norm_text(v) for v in variants}


def has_causes_marker(page: str, next_page: str | None) -> bool:
    if re.search(r"^\s*CAUSES(?:\s|$)", page, re.MULTILINE):
        return True
    if next_page and re.search(r"^\s*CAUSES(?:\s|$)", next_page, re.MULTILINE):
        return True
    return False


def find_start_page(pages: Sequence[str], presentation: str) -> int | None:
    variants = heading_variants(presentation)
    candidates: List[int] = []

    for i in range(MIN_CONTENT_PAGE, len(pages) + 1):
        page = pages[i - 1]
        next_page = pages[i] if i < len(pages) else None
        if not has_causes_marker(page, next_page):
            continue

        lines = page.splitlines()[:HEADING_SCAN_LINES]
        for line in lines:
            cleaned = clean_heading_line(line)
            if not cleaned:
                continue
            if cleaned[0] in {"●", "•", "-"}:
                continue
            letters = re.sub(r"[^A-Za-z]+", "", cleaned)
            if not letters or letters != letters.upper():
                continue
            if norm_text(cleaned) in variants:
                candidates.append(i)
                break

    if not candidates:
        return None

    return min(candidates)


def build_chapter_blocks(
    pages: Sequence[str], boundary_presentations: Sequence[str], target_presentations: Sequence[str]
) -> Tuple[Dict[str, str], Dict[str, Tuple[int, int]], List[str]]:
    starts: Dict[str, int] = {}
    missing_targets: List[str] = []

    for presentation in dedupe(boundary_presentations):
        start = find_start_page(pages, presentation)
        if start is not None:
            starts[presentation] = start

    sorted_starts = sorted(starts.items(), key=lambda x: x[1])
    ranges: Dict[str, Tuple[int, int]] = {}
    for idx, (presentation, start_page) in enumerate(sorted_starts):
        end_page = len(pages)
        if idx + 1 < len(sorted_starts):
            next_start = sorted_starts[idx + 1][1]
            end_page = max(start_page, next_start - 1)
        ranges[presentation] = (start_page, end_page)

    blocks: Dict[str, str] = {}
    for presentation in target_presentations:
        if presentation not in ranges:
            missing_targets.append(presentation)
            continue
        start_page, end_page = ranges[presentation]
        blocks[presentation] = "\n".join(pages[start_page - 1 : end_page])

    return blocks, ranges, missing_targets


TOKEN_RULES: Dict[str, Sequence[Tuple[str, Sequence[str]]]] = {
    "onset": (
        (r"\b(sudden|abrupt|thunderclap|immediate)\b", ("sudden", "acute")),
        (r"\bacute\b", ("acute",)),
        (r"\bsubacute\b", ("subacute",)),
        (r"\b(chronic|long-standing|longstanding)\b", ("chronic",)),
        (r"\binsidious\b", ("insidious",)),
        (r"\bgradual\b", ("gradual",)),
        (r"\b(recurrent|episodic|relapsing)\b", ("relapsing",)),
        (r"\bhours?\b", ("hours",)),
        (r"\bdays?\b", ("days",)),
        (r"\bmonths?\b", ("months",)),
        (r"\brapid\b", ("rapid",)),
    ),
    "progression": (
        (r"\b(progressive|worsening|deteriorat)\w*\b", ("worsening",)),
        (r"\b(improv|resolv|recover)\w*\b", ("improving",)),
        (r"\b(stable|persistent|unchanged)\b", ("stable",)),
    ),
    "palliate": (
        (r"\brest\b", ("rest",)),
        (r"\bantacid", ("antacids",)),
        (r"\bppi\b|proton pump inhibitor", ("ppi",)),
        (r"\bh2\b|\bh2-receptor\b", ("h2-blocker",)),
        (r"\bnitrate", ("nitrates",)),
        (r"leaning forward|sit(?:ting)? forward", ("leaning-forward",)),
        (r"\bnpo\b|nil by mouth", ("npo",)),
        (r"\bheat\b", ("heat",)),
        (r"\bice\b|cold compress", ("ice",)),
        (r"\belevation\b", ("elevation",)),
        (r"\bcompression\b", ("compression",)),
        (r"\bmassage\b", ("massage",)),
        (r"alcohol cessation|stop(?:ping)? alcohol", ("alcohol-cessation",)),
        (r"smoking cessation|stop(?:ping)? smoking", ("smoking-cessation",)),
    ),
    "provoke": (
        (r"\bmovement\b|moving", ("movement",)),
        (r"\bcough(?:ing)?\b", ("coughing",)),
        (r"deep breath|deep breathing|inspiration", ("deep-breathing",)),
        (r"\bexercise\b|exertion", ("exercise", "exertion")),
        (r"oral intake|eating|swallowing", ("oral-intake", "eating")),
        (r"fatty meal", ("fatty-meals",)),
        (r"\balcohol\b", ("alcohol",)),
        (r"spicy food", ("spicy-food",)),
        (r"large meals?", ("large-meals",)),
        (r"\bcaffeine\b", ("caffeine",)),
        (r"\bnsaids?\b", ("nsaids",)),
        (r"\bmenses\b|menstruation", ("menses",)),
        (r"\burination\b|micturition", ("urination",)),
        (r"\bdefecation\b", ("defecation",)),
        (r"\btouch\b", ("Touch",)),
        (r"lying down|recumb", ("lying-down",)),
        (r"\bwalking\b|walk", ("walking",)),
        (r"cold drinks?", ("cold-drinks",)),
        (r"\bstress\b", ("stress",)),
        (r"empty stomach|fasting", ("empty-stomach",)),
        (r"\bpressure\b", ("pressure",)),
        (r"\bmeals?\b", ("meals",)),
        (r"\bdehydrat", ("dehydration",)),
    ),
    "quality": (
        (r"\bcolic\w*\b", ("colicky",)),
        (r"\bcramp\w*\b", ("cramping",)),
        (r"\bburn\w*\b", ("burning",)),
        (r"\bgnaw\w*\b", ("gnawing",)),
        (r"\bsharp\b", ("sharp",)),
        (r"\bdull\b", ("dull",)),
        (r"\bach\w*\b", ("aching",)),
        (r"\bstab\w*\b", ("stabbing",)),
        (r"\bpressure\b", ("pressure",)),
        (r"\btear\w*\b", ("tearing",)),
        (r"\bthrobb\w*\b", ("throbbing",)),
        (r"\btender\w*\b", ("tender",)),
        (r"\btight\w*\b", ("tightness",)),
        (r"\bcrush\w*\b", ("crushing",)),
        (r"\bpleurit\w*\b", ("pleuritic",)),
        (r"\bripp\w*\b", ("ripping",)),
        (r"\blimp(?:ing)?\b", ("limp", "limping")),
        (r"\bwaddl\w*\b", ("waddling",)),
        (r"\bshuffl\w*\b", ("shuffling",)),
        (r"\bcircumduction\b", ("circumduction",)),
        (r"\bfocal weakness\b", ("focal-weakness",)),
        (r"\bgeneralized weakness\b", ("generalized-weakness",)),
        (r"\bproximal weakness\b", ("proximal-weakness",)),
        (r"\bdistal weakness\b", ("distal-weakness",)),
        (r"\bmyalgia\b|muscle pain", ("myalgia",)),
        (r"\bheavy\b", ("heaviness",)),
        (r"\bfirm\b", ("firm",)),
        (r"\bfluctuan\w*\b", ("fluctuant",)),
        (r"\bwarm\b", ("warm",)),
    ),
    "timing": (
        (r"\bconstant\b", ("constant",)),
        (r"\bintermittent\b", ("intermittent",)),
        (r"\bepisodic\b", ("episodic",)),
        (r"\bcyclical\b", ("cyclical",)),
        (r"\bnocturnal\b|at night", ("nocturnal",)),
        (r"\bmorning\b", ("morning",)),
        (r"\bevening\b", ("evening",)),
        (r"\bpostprandial\b|after meals?", ("postprandial",)),
        (r"\bpreprandial\b|before meals?", ("preprandial",)),
        (r"\bpost[- ]?exertional\b", ("post-exertional",)),
        (r"\bpost[- ]?traumatic\b", ("post-traumatic",)),
        (r"\bpersistent\b", ("persistent",)),
        (r"\bpost[- ]?defecation\b", ("post-defecation",)),
        (r"\bdaytime\b", ("daytime",)),
        (r"\bwith activity\b", ("with-activity",)),
    ),
    "region": (
        (r"right upper quadrant|\bruq\b", ("ruq",)),
        (r"right lower quadrant|\brlq\b", ("rlq",)),
        (r"left upper quadrant|\bluq\b", ("luq",)),
        (r"left lower quadrant|\bllq\b", ("llq",)),
        (r"\bepigastr", ("epigastrium",)),
        (r"\bperiumbil", ("periumbilical",)),
        (r"\bsuprapubic\b", ("suprapubic",)),
        (r"\bdiffuse\b|generalized", ("diffuse",)),
        (r"right flank", ("right-flank", "flank")),
        (r"left flank", ("left-flank", "flank")),
        (r"\bflank\b|\bloin\b", ("flank", "loin")),
        (r"\bneck\b|cervical|throat|laryn", ("neck",)),
        (r"\bface\b|facial|lip|jaw|sinus", ("face",)),
        (r"\bretrosternal\b|\bcentral chest\b", ("retrosternal",)),
        (r"\bchest\b|thoracic", ("lower-chest",)),
        (r"\bperianal\b", ("perianal",)),
        (r"\brect\w*\b", ("rectum",)),
        (r"\banal\b", ("anal-canal",)),
        (r"\bbuttock", ("buttocks",)),
        (r"\bpelvic\b", ("pelvic",)),
        (r"\bgroin\b", ("groin",)),
        (r"\bshoulder\b", ("shoulder",)),
        (r"\barm\b", ("arm",)),
        (r"\belbow\b", ("elbow",)),
        (r"\bforearm\b", ("forearm",)),
        (r"\bwrist\b", ("wrist",)),
        (r"\bhand\b", ("hand",)),
        (r"\bhip\b", ("hip",)),
        (r"\bthigh\b", ("thigh",)),
        (r"\bknee\b", ("knee",)),
        (r"\bleg\b|lower limb", ("leg",)),
        (r"\bcalf\b", ("calf",)),
        (r"\bankle\b", ("ankle",)),
        (r"\bfoot\b", ("foot",)),
        (r"\bfinger", ("fingers",)),
        (r"\btoe", ("toes",)),
        (r"\bnail", ("nails",)),
        (r"\bscalp\b|occipital|temporal", ("scalp",)),
        (r"\blow back\b|lumbar|backache", ("low-back",)),
        (r"\babdomen|abdominal", ("abdomen",)),
    ),
    "radiation": (
        (r"radiat\w* to the back|to the back", ("back",)),
        (r"right scap", ("right-scapula",)),
        (r"left scap", ("left-scapula",)),
        (r"shoulder tip", ("shoulder-tip",)),
        (r"right shoulder", ("right-shoulder",)),
        (r"left shoulder", ("left-shoulder",)),
        (r"\bgroin\b", ("groin",)),
        (r"\bflank\b", ("flank",)),
        (r"\bchest\b", ("chest",)),
        (r"\bjaw\b", ("jaw",)),
        (r"\blegs?\b", ("legs",)),
        (r"\barm\b", ("arm",)),
        (r"\bhand\b", ("hand",)),
    ),
    "severity": (
        (r"\b(catastrophic|collapse|shock|life[- ]threatening)\b", ("catastrophic", "severe")),
        (r"\bsevere\b|worst ever|excruciating", ("severe",)),
        (r"\bmoderate\b", ("moderate",)),
        (r"\bmild\b", ("mild",)),
    ),
    "clinical tests": (
        (r"digital rectal|dre", ("digital-rectal-exam",)),
        (r"\banoscopy\b", ("anoscopy",)),
        (r"\bpalpat\w*\b", ("palpation",)),
        (r"\bpercuss\w*\b", ("percussion",)),
        (r"\bauscultat\w*\b", ("auscultation",)),
        (r"orthostatic", ("orthostatic-blood-pressure",)),
        (r"straight leg raise", ("straight-leg-raise",)),
        (r"\bromberg\b", ("romberg-test",)),
        (r"\bgait\b", ("gait-assessment",)),
        (r"\bbabinski\b", ("babinski-sign",)),
        (r"\breflex", ("reflex-testing",)),
        (r"\bsensory", ("sensory-testing",)),
        (r"\bmotor", ("motor-strength-testing",)),
        (r"\bcoordination", ("coordination-test",)),
        (r"cranial nerve", ("cranial-nerve-exam",)),
        (r"ankle[- ]brachial", ("ankle-brachial-index",)),
        (r"capillary refill", ("capillary-refill",)),
        (r"peripheral pulse", ("peripheral-pulse-assessment",)),
        (r"carotid bruit", ("carotid-bruit",)),
        (r"chest percussion", ("chest-percussion",)),
        (r"\bfremitus\b", ("fremitus",)),
        (r"\begophony\b", ("egophony",)),
        (r"tracheal deviation", ("tracheal-deviation",)),
        (r"lung auscultation", ("lung-auscultation",)),
        (r"shifting dullness", ("shifting-dullness",)),
        (r"fluid wave", ("fluid-wave-test",)),
        (r"\bguaiac\b", ("guaiac-test",)),
        (r"suprapubic tenderness", ("suprapubic-tenderness",)),
        (r"bladder scan", ("bladder-scan",)),
        (r"urine dipstick|urinalysis", ("urine-dipstick",)),
        (r"thyroid palpation", ("thyroid-palpation",)),
        (r"\botoscopy\b", ("otoscopy",)),
        (r"visual field", ("visual-field-test",)),
        (r"\bweber\b", ("weber-test",)),
        (r"\brinne\b", ("rinne-test",)),
        (r"slit lamp", ("slit-lamp-exam",)),
        (r"skin scraping", ("skin-scraping",)),
    ),
    "other symptoms": (
        (r"\bfever|pyrexia\b", ("fever",)),
        (r"\bnausea\b", ("nausea",)),
        (r"\bvomit\w*\b", ("vomiting",)),
        (r"\bweight loss\b|cachectic", ("weight-loss",)),
        (r"\bweight gain\b", ("weight-gain",)),
        (r"\bcough\w*\b", ("cough",)),
        (r"\bdyspn\w*|shortness of breath\b", ("dyspnea", "shortness-of-breath")),
        (r"\bdizziness|vertigo\b", ("dizziness",)),
        (r"\bsyncope\b|faint", ("syncope",)),
        (r"\bpalpitation", ("palpitations",)),
        (r"\bhematuria\b", ("hematuria",)),
        (r"\bhematemesis\b", ("hematemesis",)),
        (r"\bhemoptysis\b", ("hemoptysis",)),
        (r"\bdiarrh\w*\b", ("diarrhea",)),
        (r"\bconstipat\w*\b", ("constipation",)),
        (r"\babdominal pain\b|colicky abdominal pain", ("abdominal-pain",)),
        (r"\babdominal swelling|distension\b", ("abdominal-swelling", "distension")),
        (r"\bdehydrat\w*\b", ("dehydration",)),
        (r"\bchest pain\b", ("chest-pain",)),
        (r"\bpleuritic\b", ("pleuritic-pain",)),
        (r"\bhoarseness\b", ("hoarseness",)),
        (r"\bvisual\b", ("visual-problem",)),
        (r"\bphotophobia\b", ("photophobia",)),
        (r"\brace\b|tachycard\w*\b", ("tachycardia",)),
        (r"\bitch\w*\b|prurit\w*\b", ("itching",)),
        (r"\bjaundice\b", ("jaundice",)),
        (r"\bnight sweats?\b", ("night-sweats",)),
        (r"\bmalaise\b", ("malaise",)),
        (r"\bfatigue\b|tiredness", ("fatigue",)),
        (r"\brash\b", ("rash",)),
        (r"\bneck stiffness\b", ("neck-stiffness",)),
        (r"\bseizure|convulsion\b", ("seizure",)),
        (r"\bweakness\b", ("limb-weakness",)),
        (r"\bnumbness\b", ("numbness",)),
        (r"\bparesthesia|tingling\b", ("paresthesia",)),
        (r"\bpolyuria\b", ("polyuria",)),
        (r"\bpolydipsia\b|thirst", ("polydipsia",)),
        (r"\burinary frequency\b", ("urinary-frequency",)),
        (r"\burinary urgency\b", ("urinary-urgency",)),
        (r"\bnocturia\b", ("nocturia",)),
        (r"\bdysuria\b", ("dysuria",)),
        (r"\burinary retention\b", ("urinary-retention",)),
        (r"\burinary incontinence\b", ("urinary-incontinence",)),
        (r"\bshock\b|hypotension", ("shock", "hypotension")),
        (r"\bcyanosis\b", ("cyanosis",)),
        (r"\bdeaf\w*\b|hearing loss", ("deafness", "reduced-hearing")),
        (r"\btremor\b", ("tremor",)),
        (r"\bhallucination", ("hallucinations",)),
        (r"\bcoma\b|unconscious", ("coma", "altered-mental-status")),
        (r"\bstroke\b", ("stroke-symptoms",)),
        (r"\breflux\b|heartburn", ("reflux-symptoms", "heartburn")),
        (r"\bodynophagia\b", ("odynophagia",)),
        (r"\bsore throat\b", ("sore-throat",)),
    ),
}


def extract_tokens(
    text: str,
    include_keys: Set[str] | None = None,
    max_per_key: int | None = None,
) -> Dict[str, List[str]]:
    text = text.lower()
    out: Dict[str, List[str]] = defaultdict(list)
    for key, rules in TOKEN_RULES.items():
        if include_keys is not None and key not in include_keys:
            continue
        for pattern, tokens in rules:
            if re.search(pattern, text):
                out[key].extend(tokens)
        out[key] = dedupe(out[key])
        if max_per_key is not None:
            out[key] = out[key][:max_per_key]
    return out


def merge_hpi(base: Dict[str, List[str]], addition: Dict[str, List[str]]) -> Dict[str, List[str]]:
    merged = copy.deepcopy(base)
    for key in HPI_KEYS:
        vals = list(merged.get(key, [])) + list(addition.get(key, []))
        merged[key] = dedupe(vals)
    return merged


def make_blank_hpi() -> Dict[str, List[str]]:
    return {key: [] for key in HPI_KEYS}


def presentation_fallbacks(presentation: str) -> Dict[str, List[str]]:
    slug = slugify(presentation)
    hpi = make_blank_hpi()

    if "headache" in slug:
        hpi["region"] = ["scalp"]
        hpi["quality"] = ["throbbing"]
        hpi["timing"] = ["intermittent"]
        hpi["clinical tests"] = ["cranial-nerve-exam"]
        hpi["other symptoms"] = ["nausea", "photophobia"]
    if "diarr" in slug or "constipation" in slug or "steator" in slug:
        hpi["region"] = ["abdomen"]
        hpi["quality"] = ["cramping"]
        hpi["timing"] = ["intermittent"]
        hpi["clinical tests"] = ["palpation", "auscultation"]
        hpi["other symptoms"] = ["abdominal-pain"]
    if "dysphagia" in slug or "throat" in slug or "voice" in slug:
        hpi["region"] = ["neck"]
        hpi["clinical tests"] = ["palpation"]
        hpi["other symptoms"] = ["odynophagia", "sore-throat"]
    if "ear" in slug or "deafness" in slug:
        hpi["region"] = ["face"]
        hpi["clinical tests"] = ["otoscopy", "weber-test", "rinne-test"]
        hpi["other symptoms"] = ["deafness"]
    if "eye" in slug or "visual" in slug:
        hpi["clinical tests"] = ["slit-lamp-exam", "visual-field-test"]
        hpi["other symptoms"] = ["visual-problem"]
    if "neck" in slug:
        hpi["region"] = ["neck"]
        hpi["clinical tests"] = ["palpation"]
        hpi["other symptoms"] = ["neck-pain"]
    if "leg" in slug:
        hpi["region"] = ["leg"]
        hpi["clinical tests"] = ["inspection", "palpation"]
        hpi["other symptoms"] = ["pain"]
    if "foot" in slug:
        hpi["region"] = ["foot"]
        hpi["clinical tests"] = ["inspection", "palpation"]
        hpi["other symptoms"] = ["foot-pain"]
    if "backache" in slug:
        hpi["region"] = ["low-back"]
        hpi["provoke"] = ["movement"]
        hpi["clinical tests"] = ["straight-leg-raise", "palpation"]
        hpi["other symptoms"] = ["backache"]
    if "joint" in slug:
        hpi["region"] = ["n/a"]
        hpi["quality"] = ["aching"]
        hpi["clinical tests"] = ["inspection", "palpation"]
        hpi["other symptoms"] = ["pain"]
    if any(
        key in slug
        for key in (
            "hematuria",
            "polyuria",
            "urinary",
            "urethral",
            "kidney",
            "vaginal-discharge",
        )
    ):
        hpi["region"] = ["suprapubic", "flank"]
        hpi["clinical tests"] = ["urine-dipstick", "suprapubic-tenderness"]
        hpi["other symptoms"] = ["dysuria"]
    if any(key in slug for key in ("dyspnoea", "hemoptysis", "cyanosis", "palpitations", "shock")):
        hpi["region"] = ["retrosternal", "lower-chest"]
        hpi["clinical tests"] = ["auscultation", "orthostatic-blood-pressure"]
        hpi["other symptoms"] = ["shortness-of-breath"]
    if any(key in slug for key in ("ascites", "hepatomegaly", "splenomegaly", "jaundice", "hematemesis")):
        hpi["region"] = ["abdomen"]
        hpi["clinical tests"] = ["palpation", "percussion", "shifting-dullness"]
        hpi["other symptoms"] = ["abdominal-swelling"]
    if "hirsutism" in slug or "gynecomastia" in slug or "pruritus" in slug:
        hpi["region"] = ["n/a"]
        hpi["onset"] = ["gradual"]
        hpi["timing"] = ["persistent"]
    if any(key in slug for key in ("coma", "hallucinations", "tremor")):
        hpi["region"] = ["n/a"]
        hpi["clinical tests"] = ["cranial-nerve-exam", "motor-strength-testing"]
        hpi["other symptoms"] = ["altered-mental-status"]

    return hpi


def add_if_missing(bucket: Dict[str, List[str]], key: str, values: Sequence[str]) -> None:
    current = list(bucket.get(key, []))
    current.extend(values)
    bucket[key] = dedupe(current)


def item_modifiers(
    hpi: Dict[str, List[str]], item_name: str, system: str, presentation_slug: str
) -> Dict[str, List[str]]:
    text = f"{item_name} {system}".lower()

    infectious = bool(
        re.search(
            r"(infect|sepsis|bacterial|viral|fungal|protozo|parasite|abscess|tb|tuberc|meningitis|encephalitis|cholera|clostridium)",
            text,
        )
    )
    neoplastic = bool(re.search(r"(cancer|carcinoma|tumou?r|neoplasm|adenoma|malignan)", text))
    vascular = bool(re.search(r"(vascular|embol|thromb|aneurysm|stroke|infarct|haemorrhag|ischemi|dissection)", text))
    traumatic = bool(re.search(r"(trauma|injury|fracture|contusion)", text))
    inflammatory = bool(re.search(r"(inflamm|arthritis|colitis|crohn|ulcerative|vasculitis)", text))
    obstructive = bool(re.search(r"(obstruct|retention|stricture|impaction|occlusion)", text))
    endocrine_metabolic = bool(
        re.search(r"(diabet|thyro|endocrine|metabolic|electrolyte|uremi|hepatic|renal failure|hypo|hyper)", text)
    )
    functional_psych = bool(re.search(r"(functional|psychological|anxiety|depression|irritable)", text))
    drug_related = bool(re.search(r"(drug|withdrawal|alcohol|cocaine|amphetamine|medication|toxin)", text))

    if infectious:
        add_if_missing(hpi, "onset", ["acute", "subacute"])
        add_if_missing(hpi, "progression", ["worsening"])
        add_if_missing(hpi, "severity", ["moderate"])
        add_if_missing(hpi, "other symptoms", ["fever", "malaise"])

    if neoplastic:
        add_if_missing(hpi, "onset", ["insidious", "chronic"])
        add_if_missing(hpi, "progression", ["worsening"])
        add_if_missing(hpi, "severity", ["moderate", "severe"])
        add_if_missing(hpi, "other symptoms", ["weight-loss"])

    if vascular:
        add_if_missing(hpi, "onset", ["sudden", "acute"])
        add_if_missing(hpi, "progression", ["worsening"])
        add_if_missing(hpi, "severity", ["severe"])

    if traumatic:
        add_if_missing(hpi, "onset", ["sudden", "acute"])
        add_if_missing(hpi, "provoke", ["movement"])
        add_if_missing(hpi, "timing", ["post-traumatic"])
        add_if_missing(hpi, "quality", ["sharp"])

    if inflammatory:
        add_if_missing(hpi, "onset", ["subacute", "chronic"])
        add_if_missing(hpi, "timing", ["intermittent"])
        add_if_missing(hpi, "quality", ["aching"])

    if obstructive:
        add_if_missing(hpi, "progression", ["worsening"])
        add_if_missing(hpi, "timing", ["constant"])
        add_if_missing(hpi, "severity", ["severe"])

    if endocrine_metabolic:
        add_if_missing(hpi, "onset", ["gradual", "chronic"])
        add_if_missing(hpi, "progression", ["stable", "worsening"])

    if functional_psych:
        add_if_missing(hpi, "onset", ["gradual", "chronic"])
        add_if_missing(hpi, "progression", ["stable"])
        add_if_missing(hpi, "timing", ["intermittent"])
        add_if_missing(hpi, "severity", ["mild", "moderate"])

    if drug_related:
        add_if_missing(hpi, "provoke", ["alcohol"])
        add_if_missing(hpi, "other symptoms", ["nausea"])

    if re.search(r"\b(stone|calcul|colic)\b", text):
        add_if_missing(hpi, "onset", ["sudden"])
        add_if_missing(hpi, "quality", ["colicky"])
        add_if_missing(hpi, "severity", ["severe"])
        add_if_missing(hpi, "radiation", ["groin"])

    if re.search(r"\b(neuropathy|neuritis|nerve)\b", text):
        add_if_missing(hpi, "onset", ["chronic"])
        add_if_missing(hpi, "quality", ["aching"])
        add_if_missing(hpi, "other symptoms", ["numbness", "paresthesia"])

    if re.search(r"\b(hypertension|pre-eclampsia)\b", text):
        add_if_missing(hpi, "severity", ["severe"])
        add_if_missing(hpi, "other symptoms", ["headache"])

    if "headache" in presentation_slug:
        add_if_missing(hpi, "region", ["scalp"])
    if "diarr" in presentation_slug:
        add_if_missing(hpi, "other symptoms", ["abdominal-pain", "dehydration"])
    if "urinary" in presentation_slug or "hematuria" in presentation_slug:
        add_if_missing(hpi, "provoke", ["urination"])
        add_if_missing(hpi, "other symptoms", ["dysuria"])

    return hpi


def extract_item_text(block: str, item_name: str) -> str:
    item_tokens = [
        tok
        for tok in re.findall(r"[a-z]{4,}", item_name.lower())
        if tok not in {"with", "from", "than", "other", "acute", "chronic"}
    ]
    if not item_tokens:
        return ""

    sentences = re.split(r"(?<=[\.\?!])\s+|\n+", block.lower())
    hits: List[str] = []
    for idx, sentence in enumerate(sentences):
        if any(tok in sentence for tok in item_tokens):
            start = max(0, idx - 1)
            end = min(len(sentences), idx + 2)
            hits.extend(sentences[start:end])

    return " ".join(dedupe([s.strip() for s in hits if s.strip()]))


def finalize_hpi(hpi: Dict[str, List[str]]) -> Dict[str, List[str]]:
    final = copy.deepcopy(hpi)

    if not final["onset"]:
        final["onset"] = ["n/a"]
    if not final["progression"]:
        final["progression"] = ["n/a"]
    if not final["palliate"]:
        final["palliate"] = ["n/a"]
    if not final["provoke"]:
        final["provoke"] = ["n/a"]
    if not final["quality"]:
        final["quality"] = ["n/a"]
    if not final["timing"]:
        final["timing"] = ["n/a"]
    if not final["region"]:
        final["region"] = ["n/a"]
    if not final["radiation"]:
        final["radiation"] = ["n/a"]
    if not final["severity"]:
        final["severity"] = ["moderate"]
    if not final["clinical tests"]:
        final["clinical tests"] = ["n/a"]
    if not final["other symptoms"]:
        final["other symptoms"] = ["none"]

    for key in HPI_KEYS:
        final[key] = dedupe(final.get(key, []))
        limit = VALUE_LIMITS.get(key)
        if limit is not None:
            final[key] = final[key][:limit]

    return final


def load_todo_docs(todo_dir: Path) -> List[Tuple[Path, Dict]]:
    docs: List[Tuple[Path, Dict]] = []
    for path in sorted(todo_dir.glob("*.json")):
        if path.name.startswith("."):
            continue
        with path.open("r") as f:
            docs.append((path, json.load(f)))
    return docs


def load_all_clinical_presentations(clinical_root: Path) -> List[str]:
    names: List[str] = []
    for path in sorted(clinical_root.rglob("*.json")):
        if path.name.startswith("."):
            continue
        try:
            doc = json.loads(path.read_text())
        except Exception:
            continue
        pres = doc.get("presentation")
        if isinstance(pres, str) and pres.strip():
            names.append(pres.strip())
    return dedupe(names)


def is_item_blank(item: Dict) -> bool:
    hpi = item.get("hpi")
    if not isinstance(hpi, dict):
        return True
    return all(not hpi.get(key) for key in HPI_KEYS)


def fill_docs(docs: List[Tuple[Path, Dict]], chapter_blocks: Dict[str, str]) -> Tuple[int, int]:
    updated_files = 0
    updated_items = 0

    for path, doc in docs:
        if doc.get("locked") is True:
            continue

        presentation = doc.get("presentation", "")
        block = chapter_blocks.get(presentation, "")
        pres_defaults = merge_hpi(
            presentation_fallbacks(presentation),
            extract_tokens(block, include_keys=PRESENTATION_TEXT_KEYS, max_per_key=2),
        )
        pres_slug = slugify(presentation)

        file_changed = False
        items = doc.get("items", [])
        for item in items:
            if not FORCE_REWRITE_HPI and not is_item_blank(item):
                continue

            item_name = str(item.get("name", ""))
            item_system = str(item.get("system", ""))
            item_text = extract_item_text(block, item_name)

            hpi = make_blank_hpi()
            hpi = merge_hpi(hpi, pres_defaults)
            hpi = merge_hpi(hpi, extract_tokens(item_text, include_keys=ITEM_TEXT_KEYS, max_per_key=2))
            hpi = item_modifiers(hpi, item_name, item_system, pres_slug)
            hpi = finalize_hpi(hpi)

            item["hpi"] = hpi
            file_changed = True
            updated_items += 1

        if file_changed:
            updated_files += 1
            if WRITE_CHANGES:
                with path.open("w") as f:
                    json.dump(doc, f, indent=2, ensure_ascii=False)
                    f.write("\n")

    return updated_files, updated_items


def validate_no_blanks(todo_dir: Path) -> List[str]:
    failures: List[str] = []
    for path in sorted(todo_dir.glob("*.json")):
        if path.name.startswith("."):
            continue
        doc = json.loads(path.read_text())
        for idx, item in enumerate(doc.get("items", []), start=1):
            hpi = item.get("hpi", {})
            for key in HPI_KEYS:
                if not hpi.get(key):
                    failures.append(f"{path.name} item#{idx} missing {key}")
    return failures


def main() -> None:
    if not TODO_DIR.exists():
        raise FileNotFoundError(f"TODO_DIR does not exist: {TODO_DIR}")

    pdf_path = discover_pdf_path()
    text = load_pdf_text(pdf_path)
    pages = text.split("\f")

    docs = load_todo_docs(TODO_DIR)
    target_presentations = [doc.get("presentation", "") for _, doc in docs]
    boundary_presentations = load_all_clinical_presentations(TODO_DIR.parent)
    chapter_blocks, chapter_ranges, missing = build_chapter_blocks(
        pages, boundary_presentations, target_presentations
    )

    if missing:
        print("Warning: missing chapter matches for:")
        for name in missing:
            print(f"  - {name}")

    for name in target_presentations:
        if name in chapter_ranges:
            start, end = chapter_ranges[name]
            print(f"Mapped: {name} -> pages {start}-{end}")

    updated_files, updated_items = fill_docs(docs, chapter_blocks)
    print(f"Updated files: {updated_files}")
    print(f"Updated items: {updated_items}")

    if WRITE_CHANGES:
        failures = validate_no_blanks(TODO_DIR)
        if failures:
            print("Validation failures:")
            for fail in failures[:50]:
                print(f"  - {fail}")
            if len(failures) > 50:
                print(f"  ... and {len(failures) - 50} more")
        else:
            print("Validation passed: no empty HPI arrays remain in todo JSON files.")


if __name__ == "__main__":
    main()
