import { describe, expect, it } from "vitest";
import { filterProcessNodes } from "../src/siem/process/filters.js";

const nodes = [
  { id: "root", parentId: null, time: 1000, connectionCount: 1, event: { "object.process.name": "cmd.exe", "object.process.path": "C:/Windows/cmd.exe", "object.process.id": "10", "event_src.host": "host-a", msgid: "4688" } },
  { id: "child", parentId: "root", time: 2000, connectionCount: 2, event: { "object.process.name": "powershell.exe", "subject.account.name": "analyst", "object.process.id": "20", "event_src.host": "host-a", msgid: "1" } },
  { id: "grandchild", parentId: "child", time: 3000, connectionCount: 1, event: { "object.process.name": "whoami.exe", "object.process.id": "30", "event_src.host": "host-a", msgid: "1" } },
  { id: "isolated", parentId: null, time: 4000, connectionCount: 0, event: { "object.process.name": "cron", "event_src.host": "host-b", msgid: "execve" } },
];

describe("local process graph filters", () => {
  it("filters by normalized process fields without a SIEM request", () => {
    expect([...filterProcessNodes(nodes, { name: "power", account: "analyst", host: "host-a" })]).toEqual(["child"]);
    expect([...filterProcessNodes(nodes, { pid: "30", eventType: "1" })]).toEqual(["grandchild"]);
  });

  it("selects ancestors, descendants and direct relations", () => {
    expect([...filterProcessNodes(nodes, { relations: "ancestors" }, "grandchild")]).toEqual(["root", "child", "grandchild"]);
    expect([...filterProcessNodes(nodes, { relations: "descendants" }, "root")]).toEqual(["root", "child", "grandchild"]);
    expect([...filterProcessNodes(nodes, { relations: "direct" }, "child")]).toEqual(["root", "child", "grandchild"]);
  });

  it("filters time and isolated nodes", () => {
    expect([...filterProcessNodes(nodes, { timeFrom: 1500, timeTo: 3500, hideIsolated: true })]).toEqual(["child", "grandchild"]);
  });
});
