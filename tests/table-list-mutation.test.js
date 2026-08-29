import { describe, expect, it, vi } from "vitest";
import { applyTableListMutation } from "../src/background/table-list.js";

describe("specialized Table List mutations", () => {
  it("requires confirmation and verifies the token against SIEM metadata", async () => {
    const requestRead = vi.fn(async () => ({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify([{ name: "Allowed", token: "allowed-list" }]),
    }));
    const requestMutation = vi.fn(async () => ({ status: 204, contentType: "", bodyText: "" }));
    await expect(applyTableListMutation("https://siem.example", {
      operation: "add", token: "allowed-list", row: ["value"], confirmed: false,
    }, { requestRead, requestMutation })).rejects.toThrow("confirmation");
    await expect(applyTableListMutation("https://siem.example", {
      operation: "remove", token: "other-list", row: ["value"], confirmed: true,
    }, { requestRead, requestMutation })).rejects.toThrow("not available");
    expect(requestMutation).not.toHaveBeenCalled();
  });

  it("uses the specialized mutation transport", async () => {
    const requestRead = vi.fn(async () => ({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify([{ name: "Allowed", token: "allowed-list" }]),
    }));
    const requestMutation = vi.fn(async () => ({ status: 204, contentType: "", bodyText: "" }));
    await applyTableListMutation("https://siem.example", {
      operation: "remove", token: "allowed-list", row: ["value", "type"], confirmed: true,
    }, { requestRead, requestMutation });
    expect(requestMutation).toHaveBeenCalledWith("https://siem.example", {
      path: "/api/whitelists/allowed-list/remove",
      method: "POST",
      body: JSON.stringify(["value", "type"]),
    });
  });
});
