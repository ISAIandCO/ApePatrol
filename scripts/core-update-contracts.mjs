import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function candidate(version) {
  const root = await mkdtemp(path.join(tmpdir(), "ape-update-test-"));
  try {
    await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "bin"));
    await writeFile(path.join(root, "scripts/update-core.mjs"), await readFile(new URL("./update-core.mjs", import.meta.url)));
    const installed = path.join(root, "node_modules/@isaiandco/ape-share-core"); await mkdir(installed, { recursive: true });
    await writeFile(path.join(installed, "package.json"), JSON.stringify({ name: "@isaiandco/ape-share-core", version: "1.0.0", exports: { "./package.json": "./package.json" } }));
    await writeFile(path.join(root, "bin/git"), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='clone')fs.writeFileSync(args.at(-1)+'/package.json',JSON.stringify({name:'@isaiandco/ape-share-core',version:process.env.APE_TEST_VERSION}));else process.stdout.write('a'.repeat(40));`, { mode: 0o755 });
    await writeFile(path.join(root, "bin/npm"), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.APE_TEST_LOG,JSON.stringify(process.argv.slice(2))+'\\n');`, { mode: 0o755 });
    const log = path.join(root, "calls");
    const result = spawnSync(process.execPath, [path.join(root, "scripts/update-core.mjs")], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, APE_TEST_VERSION: version, APE_TEST_LOG: log } });
    let calls = []; try { calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse); } catch (error) { if (error.code !== "ENOENT") throw error; }
    return { ...result, calls };
  } finally { await rm(root, { recursive: true, force: true }); }
}
test("updater does not touch an already installed version", async () => {
  const result = await candidate("1.0.0"); assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.calls, []);
});
test("updater rejects incompatible major before installing anything", async () => {
  const result = await candidate("2.0.0"); assert.notEqual(result.status, 0); assert.match(result.stderr, /manual adaptation/); assert.deepEqual(result.calls, []);
});
test("updater pins a newer compatible release and bumps the consumer version", async () => {
  const result = await candidate("1.1.0"); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls[0], ["install", "--ignore-scripts", "--save-exact", `@isaiandco/ape-share-core@https://codeload.github.com/ISAIandCO/ApeShareCore/tar.gz/${"a".repeat(40)}`]);
  assert.deepEqual(result.calls[1], ["version", "patch", "--no-git-tag-version", "--ignore-scripts"]);
});
