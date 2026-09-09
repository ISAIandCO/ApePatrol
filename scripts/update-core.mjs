import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = "@isaiandco/ape-share-core";
const repository = "https://github.com/ISAIandCO/ApeShareCore.git";
const current = JSON.parse(await readFile(fileURLToPath(import.meta.resolve(`${name}/package.json`)), "utf8"));
const temporary = await mkdtemp(path.join(tmpdir(), "ape-core-update-"));
const versionParts = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : null;
try {
  execFileSync("git", ["clone", "--depth", "1", "--branch", "main", repository, temporary], { stdio: "pipe" });
  const candidate = JSON.parse(await readFile(path.join(temporary, "package.json"), "utf8"));
  const before = versionParts(current.version), after = versionParts(candidate.version);
  if (candidate.name !== name || !before || !after || after[0] !== 1 || before[0] !== after[0]) throw new Error("New major or unsupported core version requires manual adaptation");
  const difference = after.map((value, index) => value - before[index]).find(value => value !== 0) || 0;
  if (difference <= 0) { console.log(`No newer compatible core (${current.version})`); }
  else {
    const sha = execFileSync("git", ["-C", temporary, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid core commit");
    execFileSync("npm", ["install", "--ignore-scripts", "--save-exact", `${name}@https://codeload.github.com/ISAIandCO/ApeShareCore/tar.gz/${sha}`], { cwd: root, stdio: "inherit" });
    execFileSync("npm", ["version", "patch", "--no-git-tag-version", "--ignore-scripts"], { cwd: root, stdio: "inherit" });
    console.log(`Updated core ${current.version} -> ${candidate.version}; test and review before merging`);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
