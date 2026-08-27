import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argValue = (name) => {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
};
const outDir = path.resolve(root, argValue("--out-dir") ?? "dist/firefox");
const selfHosted = process.argv.includes("--self-hosted");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const updateUrl = "https://github.com/ISAIandCO/siem-monkey-firefox/releases/latest/download/updates.json";

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: {
    background: path.join(root, "src/background/background.js"),
    content: path.join(root, "src/content/main.js"),
    popup: path.join(root, "src/popup/popup.js"),
    options: path.join(root, "src/options/options.js"),
    "network-interceptor": path.join(root, "src/page-bridge/network-interceptor.js"),
  },
  bundle: true,
  entryNames: "[name]",
  format: "iife",
  platform: "browser",
  target: "firefox140",
  outdir: outDir,
  legalComments: "eof",
  sourcemap: false,
  minify: false,
});

for (const file of ["popup.html", "popup.css", "options.html", "options.css", "content.css"]) {
  await cp(path.join(root, "src/static", file), path.join(outDir, file));
}
await cp(path.join(root, "img"), path.join(outDir, "img"), { recursive: true });

const manifestTemplate = await readFile(path.join(root, "src/manifest.firefox.json"), "utf8");
const manifest = JSON.parse(manifestTemplate
  .replaceAll("__VERSION__", packageJson.version)
  .replace("__SELF_HOSTED_UPDATE_URL__", updateUrl));
if (!selfHosted) delete manifest.browser_specific_settings.gecko.update_url;
await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
