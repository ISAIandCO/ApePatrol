import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { root, installedCore } from "./resolve-core.mjs";
const core = await installedCore();
if (process.env.APE_CORE_SHA && process.env.APE_CORE_SHA !== core.sha) throw new Error("Unexpected core revision in this build");
if (process.argv.includes("--built")) {
  const output = path.join(root, "dist/firefox");
  const recorded = JSON.parse(await readFile(path.join(output, "apesharecore-build.json"), "utf8"));
  if (JSON.stringify(recorded) !== JSON.stringify(core)) throw new Error("Artifact used a different core");
  async function scan(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await scan(file);
      else if (item.name.endsWith(".js") && /(?:from\s*|import\s*\(?\s*)["']@isaiandco\/ape-share-core/.test(await readFile(file, "utf8"))) throw new Error(`Unbundled core import in ${file}`);
    }
  }
  await scan(output);
}
console.log(`ApeShareCore ${core.version} at ${core.sha} verified`);
