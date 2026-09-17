// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createFilterEditor } from "@isaiandco/ape-share-core/ui/filter-editor";
import { normalizeCustomFilter } from "../src/siem/features/custom-filters.js";
import { applyManagedPolicy, importSettingsProfile } from "../src/shared/profiles.js";

it("edits user copies without mutating shipped templates and displays independent groups", () => {
  const root = document.createElement("div"); document.body.append(root);
  const builtin = { id: "host", name: "Host", template: "event_src.host = '${event_src.host}'" };
  const editor = createFilterEditor({ root, builtins: [builtin], normalize: normalizeCustomFilter, dialect: "maxpatrol-pdql" });
  editor.set({ userFilters: [], disabledBuiltinFilterIds: [] });
  expect([...root.querySelectorAll("h3")].map(node => node.textContent)).toEqual(["Встроенные", "Пользовательские"]);
  root.querySelector("details button").click();
  root.querySelector('input[type="checkbox"]').checked = false;
  const result = editor.read();
  expect(result.userFilters[0].id).toBe("host-copy");
  expect(result.disabledBuiltinFilterIds).toEqual(["host"]);
  expect(builtin.name).toBe("Host");
  editor.set(result);
  expect(editor.read()).toEqual(result);
});

it("migrates legacy profile and policy filters before defaults are merged", () => {
  const legacy = { customFilters: [{ id: "my-filter", template: "action = 'login'" }] };
  expect(applyManagedPolicy(legacy).settings.userFilters[0].id).toBe("my-filter");
  const managed = applyManagedPolicy({ userFilters: [] }, { defaults: legacy, lockedPaths: ["customFilters"] });
  expect(managed.settings.userFilters[0].id).toBe("my-filter");
  expect(managed.managed.lockedPaths).toContain("userFilters");
  const profile = { kind: "apepatrol-settings-profile", schemaVersion: 1, settings: legacy };
  expect(importSettingsProfile({ userFilters: [] }, profile, "merge").userFilters[0].id).toBe("my-filter");
});
