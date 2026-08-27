import { spawnSync } from "node:child_process";

const acceptedWarnings = new Set();
const args = ["lint", "--source-dir", "dist/firefox", "--output", "json"];
if (process.argv.includes("--self-hosted")) args.push("--self-hosted");
const command = process.platform === "win32" ? "web-ext.cmd" : "web-ext";
const result = spawnSync(command, args, { encoding: "utf8" });
if (!result.stdout) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
let report;
try { report = JSON.parse(result.stdout); } catch {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const errors = report.errors ?? [];
const warnings = (report.warnings ?? []).filter((warning) => !acceptedWarnings.has(warning.code));
for (const warning of report.warnings ?? []) {
  if (acceptedWarnings.has(warning.code)) console.warn(`Accepted Firefox 128 compatibility warning: ${warning.code}`);
}
if (errors.length || warnings.length) {
  console.error(JSON.stringify({ errors, warnings }, null, 2));
  process.exit(1);
}
console.log(`web-ext lint passed (${report.summary?.notices ?? 0} notices, ${(report.warnings ?? []).length} documented compatibility warnings)`);
