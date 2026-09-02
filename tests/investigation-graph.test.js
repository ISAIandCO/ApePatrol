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
      title: "Запущен процесс «cmd.exe»", description: "Хост: PC-1 · ID события: 4688",
    });
  });

  it("describes logons before falling back to rule names", () => {
    expect(describeInvestigationEvent({ msgid: "4624", "object.account.name": "analyst", correlation_name: "Interactive logon" })).toEqual({
      title: "Пользователь «analyst» вошёл в систему",
      description: "Правило корреляции: Interactive logon · ID события: 4624",
    });
  });

  it("distinguishes correlation and normalization rule fallbacks", () => {
    expect(describeInvestigationEvent({ correlation_name: "Suspicious activity" }).title).toBe("Сработало правило корреляции «Suspicious activity»");
    expect(describeInvestigationEvent({ normalization_rule_name: "Linux audit" }).title).toBe("Событие нормализовано правилом «Linux audit»");
    expect(describeInvestigationEvent({ "event_src.title": "unix_like", action: "start" })).toEqual({
      title: "Событие SIEM", description: "Источник события: unix_like · Действие: start",
    });
  });
});
