import { describe, expect, it } from "vitest";
import { addWorkspaceItem, createWorkspace, sanitizeWorkspaceSnapshot, workspaceToJson, workspaceToMarkdown } from "../src/shared/workspace.js";

describe("Investigation Workspace model", () => {
  it("redacts secret-like snapshot fields before persistence/export", () => {
    const snapshot = sanitizeWorkspaceSnapshot({ uuid: "event", password: "no", nested: { apiToken: "no", host: "pc" } });
    expect(snapshot).toEqual({ uuid: "event", nested: { host: "pc" } });
  });

  it("deduplicates pinned objects while refreshing their snapshot", () => {
    const workspace = createWorkspace({ title: "Case", siemOrigin: "https://siem.example" }, 1, "case-id");
    const first = addWorkspaceItem(workspace, { type: "ioc", value: "ip:8.8.8.8", snapshot: { score: 1 } }, 2);
    const second = addWorkspaceItem(first, { type: "ioc", value: "ip:8.8.8.8", snapshot: { score: 2 } }, 3);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].snapshot.score).toBe(2);
    expect(second.items[0].createdAt).toBe(2);
  });

  it("exports ticket-ready Markdown and JSON without secrets", () => {
    const workspace = addWorkspaceItem(createWorkspace({ title: "IR-42", notes: "Check host" }, 1, "case-id"), { type: "event", value: "uuid", snapshot: { uuid: "uuid", authorization: "secret" } }, 2);
    expect(workspaceToMarkdown(workspace)).toContain("# IR-42");
    expect(workspaceToMarkdown(workspace)).toContain("## Analyst notes");
    expect(workspaceToJson(workspace)).not.toContain("secret");
  });

  it("rejects a snapshot larger than the per-item storage budget", () => {
    const oversized = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field${index}`, "x".repeat(20_000)]));
    const workspace = createWorkspace({ title: "Case" }, 1, "case-id");
    expect(() => addWorkspaceItem(workspace, { type: "event", value: "uuid", snapshot: oversized }, 2)).toThrow("exceeds 1 MiB");
  });
});
