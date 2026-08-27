import { describe, expect, it } from "vitest";
import { renderFilterTemplate, requiredTemplateFields } from "../src/siem/features/custom-filters.js";

describe("custom filter templates", () => {
  it("finds required fields", () => expect(requiredTemplateFields("src.ip='${src.ip}' and dst.ip='${dst.ip}'")).toEqual(["src.ip", "dst.ip"]));
  it("escapes attacker-controlled event values", () => {
    const rendered = renderFilterTemplate("subject.name = '${subject.name}'", { "subject.name": "x' or true or '" });
    expect(rendered.query).toBe("subject.name = 'x\\' or true or \\''");
  });
  it("reports missing fields", () => expect(renderFilterTemplate("src.ip='${src.ip}'", {}).missing).toEqual(["src.ip"]));
});
