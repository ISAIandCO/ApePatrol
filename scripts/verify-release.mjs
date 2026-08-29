import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifest = JSON.parse(await readFile("dist/firefox/manifest.json", "utf8"));
const version = packageJson.version;
const failures = [];

if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) failures.push("package-lock version differs from package.json");
if (manifest.version !== version || manifest.version_name !== `${version} (target: MP SIEM 27.3)`) failures.push("built manifest version differs from package.json");
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) failures.push(`tag ${process.env.GITHUB_REF_NAME} differs from v${version}`);
if (process.env.GITHUB_SHA) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (head !== process.env.GITHUB_SHA) failures.push(`checked out commit ${head} differs from GITHUB_SHA ${process.env.GITHUB_SHA}`);
}
if (failures.length) throw new Error(`Release verification failed:\n- ${failures.join("\n- ")}`);
console.log(`Release metadata verified for ApePatrol ${version}`);
