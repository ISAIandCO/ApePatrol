import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = new URL("../dist/firefox/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const failures = [];

if (manifest.content_scripts?.length) failures.push("static content_scripts are forbidden");
if (manifest.host_permissions?.length) failures.push("persistent host_permissions are forbidden");
if (manifest.background?.service_worker) failures.push("Firefox artifact must use background scripts");
if (manifest.name !== "ApePatrol") failures.push("unexpected product name");
if (manifest.browser_specific_settings?.gecko?.id !== "apepatrol@isaiandco.local") failures.push("unexpected Gecko ID");
if (manifest.browser_specific_settings?.gecko?.strict_min_version !== "140.0") failures.push("unexpected Firefox baseline");

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    if (entry.isFile() && /\.(?:js|html|json)$/.test(entry.name)) {
      const text = await readFile(file, "utf8");
      for (const forbidden of ["globalMonkeyOptions", "jquery-ui-1.12.1", "__zone_symbol__xhrURL"]) {
        if (text.includes(forbidden)) failures.push(`${path.relative(root.pathname, file)} contains ${forbidden}`);
      }
      for (const forbidden of [/world\s*:\s*["']MAIN["']/, /window\.postMessage\s*\(/, /window\.fetch\s*=/, /XMLHttpRequest\.prototype\.(?:open|send)\s*=/]) {
        if (forbidden.test(text)) failures.push(`${path.relative(root.pathname, file)} contains forbidden MAIN-world network instrumentation`);
      }
    }
  }
}
await scan(root.pathname);

if (failures.length) {
  throw new Error(`Policy verification failed:\n- ${failures.join("\n- ")}`);
}
