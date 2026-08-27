import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporary = await mkdtemp(path.join(tmpdir(), "apepatrol-repro-"));
const first = path.join(temporary, "first");
const second = path.join(temporary, "second");

function build(out) {
  const result = spawnSync(process.execPath, ["scripts/build.mjs", `--out-dir=${out}`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function digest(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(directory, file));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

try {
  build(first);
  build(second);
  const firstHash = await digest(first);
  const secondHash = await digest(second);
  if (firstHash !== secondHash) throw new Error(`Non-reproducible dist: ${firstHash} != ${secondHash}`);
  console.log(`Reproducible dist SHA-256: ${firstHash}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
