import { readFile, access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = "@isaiandco/ape-share-core";
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const spec = pkg.dependencies?.[name];
const match = /^https:\/\/codeload\.github\.com\/ISAIandCO\/ApeShareCore\/tar\.gz\/([a-f0-9]{40})$/.exec(spec || "");
if (!match) throw new Error("ApeShareCore must be pinned to an immutable Git commit");
const entry = lock.packages?.[`node_modules/${name}`];
if (lock.packages?.[""]?.dependencies?.[name] !== spec || entry?.resolved !== spec || !/^sha512-/.test(entry?.integrity || "") || entry.link) throw new Error("ApeShareCore package and lock disagree");
const installed = JSON.parse(await readFile(fileURLToPath(import.meta.resolve(`${name}/package.json`)), "utf8"));
if (installed.name !== name || !/^1\.\d+\.\d+$/.test(installed.version) || entry.version !== installed.version) throw new Error("Unsupported or mismatched ApeShareCore version");
try { await access(path.join(root, "src/shared/core")); throw new Error("Remove the duplicate in-repository core"); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (process.argv.includes("--built")) {
  async function scan(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await scan(file);
      else if (item.name.endsWith(".js") && /(?:from\s*|import\s*\(?\s*)["']@isaiandco\/ape-share-core/.test(await readFile(file, "utf8"))) throw new Error(`Unbundled core import in ${file}`);
    }
  }
  await scan(path.join(root, "dist/firefox"));
}
console.log(`ApeShareCore ${installed.version} at ${match[1]} verified`);
