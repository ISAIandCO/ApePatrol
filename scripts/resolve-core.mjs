import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const name = "@isaiandco/ape-share-core";
export const metadataPath = path.join(root, ".apesharecore.json");
const repository = "https://github.com/ISAIandCO/ApeShareCore.git";
const git = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const json = file => readFile(file, "utf8").then(JSON.parse);
export function compatible(pkg, major) {
  return pkg?.name === name && new RegExp(`^${major}\\.\\d+\\.\\d+$`).test(pkg.version);
}
export function selectRevision(revisions, readPackage, major) {
  for (const sha of revisions) {
    const pkg = readPackage(sha);
    if (compatible(pkg, major)) return { sha, version: pkg.version };
  }
  throw new Error(`No compatible ApeShareCore ${major}.x revision found`);
}
export async function installedCore() {
  const metadata = await json(metadataPath);
  const pkg = await json(path.join(root, "node_modules", name, "package.json"));
  const config = (await json(path.join(root, "package.json"))).apeShareCore;
  if (!compatible(pkg, config.major) || pkg.version !== metadata.version || !/^[a-f0-9]{40}$/.test(metadata.sha) || !/^sha512-/.test(metadata.integrity)) throw new Error("Installed core does not match build metadata");
  return metadata;
}
export async function prepareCore() {
  const config = (await json(path.join(root, "package.json"))).apeShareCore;
  if (!Number.isSafeInteger(config?.major) || config.major < 1) throw new Error("Configure apeShareCore.major");
  const pinned = process.env.APE_CORE_SHA;
  const source = process.env.APE_CORE_SOURCE;
  if (pinned && !/^[a-f0-9]{40}$/.test(pinned)) throw new Error("APE_CORE_SHA must be a full commit SHA");
  if (pinned && (!source || process.env.APE_CORE_PREPARED === "1")) {
    try { const current = await installedCore(); if (current.sha === pinned && current.source === (source ? "candidate" : "github")) return current; } catch { /* Resolve missing installation. */ }
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "ape-core-build-"));
  try {
    let selected;
    let archive;
    if (source) {
      const pkg = await json(path.join(source, "package.json"));
      if (!compatible(pkg, config.major)) throw new Error("Candidate core is incompatible");
      selected = { sha: git(["-C", source, "rev-parse", "HEAD"]), version: pkg.version };
      if (pinned && selected.sha !== pinned) throw new Error("Candidate source and APE_CORE_SHA disagree");
      archive = path.resolve(source);
    } else {
      const checkout = path.join(temporary, "repository");
      git(["clone", "--quiet", "--branch", "main", repository, checkout]);
      if (pinned) git(["-C", checkout, "fetch", "--quiet", "origin", pinned]);
      const revisions = pinned ? [pinned] : git(["-C", checkout, "rev-list", "--first-parent", "HEAD"]).split("\n");
      selected = selectRevision(revisions, sha => {
        try { return JSON.parse(git(["-C", checkout, "show", `${sha}:package.json`])); } catch { return null; }
      }, config.major);
      archive = `https://codeload.github.com/ISAIandCO/ApeShareCore/tar.gz/${selected.sha}`;
      try { const current = await installedCore(); if (current.sha === selected.sha && current.source === "github") return current; } catch { /* First build or npm ci removed core. */ }
    }
    const packed = JSON.parse(execFileSync("npm", ["pack", archive, "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }))[0];
    if (packed.name !== name || packed.version !== selected.version || !/^sha512-/.test(packed.integrity)) throw new Error("Unexpected core package");
    execFileSync("npm", ["install", "--no-save", "--package-lock=false", "--ignore-scripts", "--no-audit", "--no-fund", path.join(temporary, path.basename(packed.filename))], { cwd: root, stdio: "inherit" });
    const metadata = { schemaVersion: 1, name, ...selected, integrity: packed.integrity, source: source ? "candidate" : "github" };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await installedCore();
    return metadata;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
