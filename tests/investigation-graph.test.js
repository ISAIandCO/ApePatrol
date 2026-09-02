import { describe, expect, it } from "vitest";
import { buildEntitySearchPredicate, buildInvestigationGraph, describeInvestigationEvent, sortWorkspaceItems } from "../src/shared/investigation-graph.js";

const item = (uuid, time, fields = {}) => ({ type: "event", value: uuid, snapshot: { uuid, time, ...fields }, createdAt: Date.parse(time) });

describe("investigation relationship graph", () => {
  it("merges subject and object roles into the same account and process entities", () => {
    const graph = buildInvestigationGraph([
      item("logon", "2026-09-01T10:00:00Z", { "subject.account.name": "Analyst", "event_src.host": "PC-1", "src.ip": "192.0.2.10" }),
      item("process", "2026-09-01T10:01:00Z", { "object.account.name": "analyst", "event_src.host": "pc-1", "dst.ip": "192.0.2.10" }),
    ]);
    const shared = graph.nodes.filter((node) => node.kind === "entity" && node.connectionCount === 2);
    expect(shared.map((node) => node.entityType).sort()).toEqual(["account", "host", "ip"]);
    expect(graph.edges).toHaveLength(6);
  });

  it("can hide one-event properties without hiding the event nodes", () => {
    const graph = buildInvestigationGraph([item("one", "2026-09-01T10:00:00Z", { "src.ip": "192.0.2.1" })], { sharedOnly: true });
    expect(graph.nodes).toEqual([expect.objectContaining({ id: "event:one" })]);
    expect(graph.edges).toHaveLength(0);
  });

  it("sorts events by SIEM time while retaining original indexes for actions", () => {
    const sorted = sortWorkspaceItems([
      item("late", "2026-09-01T11:00:00Z"),
      { type: "note", value: "note", createdAt: 1 },
      item("early", "2026-09-01T10:00:00Z"),
    ]);
    expect(sorted.map(({ item: entry }) => entry.value)).toEqual(["early", "late", "note"]);
    expect(sorted.map(({ index }) => index)).toEqual([2, 0, 1]);
    expect(sortWorkspaceItems([item("late", "2026-09-01T11:00:00Z"), { type: "note", value: "note" }, item("early", "2026-09-01T10:00:00Z")], "added").map(({ item: entry }) => entry.value)).toEqual(["late", "note", "early"]);
  });

  it("builds a role-independent escaped PDQL predicate", () => {
    const graph = buildInvestigationGraph([item("one", "2026-09-01T10:00:00Z", { "subject.account.name": "o'brien" })]);
    const predicate = buildEntitySearchPredicate(graph.nodes.filter((node) => node.entityType === "account"));
    expect(predicate).toContain("subject.account.name = 'o\\'brien'");
    expect(predicate).toContain("object.account.name = 'o\\'brien'");
  });

  it("creates a readable event description from common fields", () => {
    expect(describeInvestigationEvent({ msgid: "4688", "event_src.host": "PC-1", "object.process.name": "cmd.exe" })).toEqual({
      title: "Событие 4688", description: "ID 4688 · хост PC-1 · cmd.exe",
    });
  });
});
