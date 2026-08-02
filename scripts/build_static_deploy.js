#!/usr/bin/env node

/**
 * USER SETTINGS
 * Adjust these repository-relative values if the public site layout changes.
 */
const OUTPUT_DIR = "dist";
const CLEAN_OUTPUT = true;
const COPY_TARGETS = [
  "index.html",
  "styles.css",
  "core_app.js",
  "core_style.css",
  "ct_icon.svg",
  "pages/calculators.html",
  "pharm/pharm_index.html",
  "pharm/pharm_app.js",
  "pharm/pharm_style.css",
  "pharm/assests/pharm_data_rxclass_enriched.json",
  "pharm/assests/MAIN_PHARM_CLASS_HIERARCHY.json",
  "pharm/assests/classes",
  "differentials/differentials_index.html",
  "differentials/differentials_app.js",
  "differentials/differentials_style.css",
  "differentials/Presentation_list.json",
  "differentials/clinical_presentation_index.json",
  "differentials/non-clinical_presentation_index.json",
  "differentials/data",
  "v1_writer/writer.html",
  "v1_writer/styles.css",
  "v1_writer/js/app.js",
  "v1_writer/templates",
];

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, OUTPUT_DIR);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyTarget(relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const destPath = path.join(outputDir, relativePath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing deploy target: ${relativePath}`);
  }

  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    ensureDir(path.dirname(destPath));
    fs.cpSync(sourcePath, destPath, { recursive: true });
    return;
  }

  ensureDir(path.dirname(destPath));
  fs.copyFileSync(sourcePath, destPath);
}

function walkFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function toRepoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function main() {
  if (CLEAN_OUTPUT) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  ensureDir(outputDir);

  COPY_TARGETS.forEach(copyTarget);

  const copiedFiles = walkFiles(outputDir)
    .map((absolutePath) => ({
      relativePath: toRepoRelative(absolutePath),
      size: fs.statSync(absolutePath).size,
    }))
    .sort((a, b) => b.size - a.size);

  const totalBytes = copiedFiles.reduce((sum, file) => sum + file.size, 0);

  console.log(`Built ${OUTPUT_DIR} with ${copiedFiles.length} files (${formatMiB(totalBytes)} total).`);
  copiedFiles.slice(0, 10).forEach((file) => {
    console.log(`${formatMiB(file.size).padStart(10)}  ${file.relativePath}`);
  });
}

main();
