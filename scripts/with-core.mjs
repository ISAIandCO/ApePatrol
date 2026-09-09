import { spawnSync } from "node:child_process";
import { prepareCore } from "./resolve-core.mjs";
const core = await prepareCore();
console.log(`ApeShareCore ${core.version} (${core.sha})`);
const [command, ...args] = process.argv.slice(2);
if (command) {
  const result = spawnSync(command === "node" ? process.execPath : command, args, {
    stdio: "inherit", env: { ...process.env, APE_CORE_SHA: core.sha, APE_CORE_PREPARED: "1" },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
