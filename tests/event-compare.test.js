import { describe, expect, it } from "vitest";
import { compareEvents, eventDiffToMarkdown } from "../src/shared/event-compare.js";

describe("Event Compare", () => {
  it("groups same, changed and one-sided fields", () => {
    const diff = compareEvents([
      { "object.process.name": "cmd.exe", "src.ip": "1.1.1.1", severity: "low", left_only: 1 },
      { "object.process.name": "cmd.exe", "src.ip": "8.8.8.8", severity: "high", right_only: 2 },
    ]);
    expect(diff.rows.find((row) => row.field === "object.process.name")).toMatchObject({ group: "process", status: "same" });
    expect(diff.rows.find((row) => row.field === "src.ip")).toMatchObject({ group: "network", status: "changed" });
    expect(diff.rows.find((row) => row.field === "left_only").status).toBe("only");
    expect(eventDiffToMarkdown(diff)).toContain("## process");
  });

  it("supports exactly three events", () => {
    const diff = compareEvents([{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }]);
    expect(diff.eventCount).toBe(3);
    expect(() => compareEvents([{ uuid: "a" }])).toThrow("two or three");
  });

  it("compares nested objects canonically without dropping nested keys", () => {
    const same = compareEvents([{ raw: { alpha: { value: 1 }, beta: 2 } }, { raw: { beta: 2, alpha: { value: 1 } } }]);
    const changed = compareEvents([{ raw: { alpha: { value: 1 } } }, { raw: { alpha: { value: 2 } } }]);
    expect(same.rows[0].status).toBe("same");
    expect(changed.rows[0].status).toBe("changed");
  });
});
