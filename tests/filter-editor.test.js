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

it("creates and deletes filters using fields without a JSON editor", () => {
  const root = document.createElement("div"); document.body.append(root);
  const editor = createFilterEditor({ root, builtins: [], normalize: normalizeCustomFilter, dialect: "maxpatrol-pdql", queryModes: [{ value: "where", label: "PDQL" }] });
  editor.set({});
  const click = text => [...root.querySelectorAll("button")].find(item => item.textContent === text).click();
  click("Создать фильтр");
  const card = root.querySelector(".user-filter-card");
  card.querySelector('[data-field="name"]').value = "Мой фильтр";
  card.querySelector('[data-field="template"]').value = "event_src.host = '${event_src.host}'";
  card.querySelector('[data-field="enabled"]').checked = false;
  card.querySelector('[data-field="platform"]').value = "unix";
  card.querySelector('[data-field="timeRange"]').value = "7d";
  const saved = editor.read().userFilters[0];
  expect(saved).toMatchObject({ name: "Мой фильтр", enabled: false, platforms: ["unix"], timeRange: "7d" });
  expect(saved.id).toBeTruthy();
  editor.set({ userFilters: [saved] });
  expect(editor.read().userFilters).toEqual([saved]);
  click("Удалить фильтр");
  expect(editor.read().userFilters).toEqual([]);
});

it("preserves multiline SQL drafts and comments during editing and checking", () => {
  const root = document.createElement("div"); document.body.append(root);
  const normalize = item => item.template.trim() ? { ...item } : null;
  const editor = createFilterEditor({ root, builtins: [], normalize, dialect: "test-sql", defaultMode: "sql", prepareTemplate: filter => filter.template });
  editor.set({});
  [...root.querySelectorAll("button")].find(item => item.textContent === "Создать фильтр").click();
  const template = "-- комментарий\nSELECT\n    Timestamp\nFROM `events`\n";
  root.querySelector('[data-field="template"]').value = template;
  expect(editor.read().userFilters[0]).toMatchObject({ mode: "sql", template });
  [...root.querySelectorAll("button")].find(item => item.textContent === "Проверить шаблон").click();
  expect(root.querySelector('[data-field="template"]').value).toBe(template);
  expect(root.querySelector(".user-filter-card pre").hidden).toBe(false);
  root.querySelector('[data-field="template"]').value = "";
  expect(() => editor.read()).toThrow();
  expect(root.querySelector(".filter-error").textContent).toBeTruthy();
});
