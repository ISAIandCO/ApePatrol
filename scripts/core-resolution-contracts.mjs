import test from "node:test";
import assert from "node:assert/strict";
import { compatible, selectRevision, name } from "./resolve-core.mjs";
const pkg = version => ({ name, version });
test("uses the newest compatible revision including fixes without a version bump", () => {
  const history = { newest: pkg("1.0.0"), older: pkg("1.0.0") };
  assert.deepEqual(selectRevision(Object.keys(history), sha => history[sha], 1), { sha: "newest", version: "1.0.0" });
});
test("a new major on main does not force consumers to upgrade", () => {
  const history = { newest: pkg("2.0.0"), compatible: pkg("1.4.2"), old: pkg("1.0.0") };
  assert.deepEqual(selectRevision(Object.keys(history), sha => history[sha], 1), { sha: "compatible", version: "1.4.2" });
});
test("missing packages, wrong identity and prereleases are not compatible releases", () => {
  assert.equal(compatible(null, 1), false);
  assert.equal(compatible({ name: "other", version: "1.0.0" }, 1), false);
  assert.equal(compatible(pkg("1.1.0-beta"), 1), false);
  assert.throws(() => selectRevision(["wrong"], () => pkg("2.0.0"), 1), /No compatible/);
});

test("new exports require the minimum minor without pinning a particular revision", () => {
  const history = { newest: pkg("1.3.0"), required: pkg("1.2.0"), old: pkg("1.1.9") };
  assert.deepEqual(selectRevision(Object.keys(history), sha => history[sha], 1, 2), { sha: "newest", version: "1.3.0" });
  assert.throws(() => selectRevision(["old"], sha => history[sha], 1, 2), /No compatible/);
});
