import { describe, expect, it, vi } from "vitest";
import { setIocDescription } from "../src/background/ioc-description.js";

const settings = { iocListName: "IOCs_Value" };

describe("specialized IOC description operation", () => {
  it("resolves the configured list and performs only the exact insertion", async () => {
    const request = vi.fn(async (_origin, message) => {
      if (message.path === "/api/events/v2/table_lists") {
        return { status: 200, contentType: "application/json", bodyText: JSON.stringify([{ name: "IOCs_Value", token: "ioc-list" }]) };
      }
      return { status: 204, contentType: "", bodyText: "" };
    });
    await expect(setIocDescription("https://siem.example", {
      token: "ioc-list",
      row: ["8.8.8.8", "ip", "native value"],
      description: "DNS resolver",
      username: "analyst",
    }, settings, { requestRead: request, requestMutation: request })).resolves.toMatchObject({ table: "IOCs_Value" });
    expect(request).toHaveBeenLastCalledWith("https://siem.example", {
      path: "/api/whitelists/ioc-list/insert",
      method: "POST",
      body: JSON.stringify(["8.8.8.8", "ip", "DNS resolver (analyst)"]),
    });
  });

  it("rejects a forged token before the mutation", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify([{ name: "IOCs_Value", token: "real-list" }]),
    }));
    await expect(setIocDescription("https://siem.example", {
      token: "forged-list",
      row: ["8.8.8.8", "ip"],
      description: "test",
      username: "analyst",
    }, settings, { requestRead: request, requestMutation: request })).rejects.toThrow("does not match");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects nested cells and oversized descriptions", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify([{ name: "IOCs_Value", token: "ioc-list" }]),
    }));
    await expect(setIocDescription("https://siem.example", {
      token: "ioc-list", row: [{ nested: true }], description: "test", username: "analyst",
    }, settings, { requestRead: request, requestMutation: request })).rejects.toThrow("scalar");
    await expect(setIocDescription("https://siem.example", {
      token: "ioc-list", row: ["ioc"], description: "x".repeat(501), username: "analyst",
    }, settings, { requestRead: request, requestMutation: request })).rejects.toThrow("1–500");
  });
});
