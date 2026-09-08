import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockName = "shared-core.lock.json";
const corePath = "src/shared/core";
const infrastructure = ["scripts/shared-core.mjs", "scripts/core-contracts.mjs"];
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function filesAt(base) {
  const names = await readdir(path.join(base, corePath), { withFileTypes: true });
  if (names.some(item => !item.isFile() || !/^[a-z0-9-]+\.js$/.test(item.name))) throw new Error("Core must contain only flat JavaScript modules");
  return [...names.map(item => `${corePath}/${item.name}`), ...infrastructure].sort();
}
async function snapshot(base) {
  return Object.fromEntries(await Promise.all((await filesAt(base)).map(async file => [file, digest(await readFile(path.join(base, file)))])));
}
async function verify(base) {
  const lock = JSON.parse(await readFile(path.join(base, lockName), "utf8"));
  if (lock.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(lock.version)) throw new Error("Invalid core lock format");
  const actual = await snapshot(base);
  if (JSON.stringify(actual) !== JSON.stringify(lock.files)) throw new Error(`Shared core differs from its lock: ${base}. Review changes and record a new core version.`);
  return lock;
}

if (args.includes("--record")) {
  const version = option("--version");
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error("Use --record --version X.Y.Z");
  let previous;
  try { previous = JSON.parse(await readFile(path.join(root, lockName), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const files = await snapshot(root);
  if (previous?.version === version && JSON.stringify(previous.files) !== JSON.stringify(files)) throw new Error("Changed core requires a new version");
  await writeFile(path.join(root, lockName), `${JSON.stringify({ schemaVersion: 1, version, files }, null, 2)}\n`);
  console.log(`Recorded shared core ${version}`);
} else if (args.includes("--from")) {
  const source = option("--from");
  if (!source || source.startsWith("--")) throw new Error("--from requires a peer repository path");
  const peer = path.resolve(source);
  const incoming = await verify(peer);
  // Refuse to overwrite unrecorded edits, and never copy product files or secrets.
  const current = await verify(root);
  for (const file of Object.keys(incoming.files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), await readFile(path.join(peer, file)));
  }
  for (const file of Object.keys(current.files)) if (!(file in incoming.files)) await rm(path.join(root, file));
  await writeFile(path.join(root, lockName), `${JSON.stringify(incoming, null, 2)}\n`);
  await verify(root);
  console.log(`Synced shared core ${incoming.version}; run both repositories' tests before publishing`);
} else {
  const current = await verify(root);
  if (args.includes("--peer")) {
    const peer = option("--peer");
    if (!peer || peer.startsWith("--")) throw new Error("--peer requires a peer repository path");
    const other = await verify(path.resolve(peer));
    if (JSON.stringify(current) !== JSON.stringify(other)) throw new Error("Repositories have different core versions or contents");
  }
  console.log(`Shared core ${current.version}: verified${args.includes("--peer") ? ", identical in both repositories" : ""}`);
}
