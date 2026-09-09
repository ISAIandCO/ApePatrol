// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EventFieldActions } from "../src/siem/features/event-actions.js";

let actions;
afterEach(() => { actions?.unmount(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it("the shared provider module preserves the existing SIEM menu on success and failure", async () => {
  const sendMessage = vi.fn().mockResolvedValueOnce({ ok: true, result: { provider: "ThreatFox", verdict: "malicious", summary: "THREATFOX_REPORT_RESULT" } })
    .mockResolvedValueOnce({ ok: false, error: "provider unavailable" });
  vi.stubGlobal("browser", { runtime: { sendMessage } });
  const anchor = document.createElement("button"); document.body.append(anchor);
  anchor.getBoundingClientRect = () => ({ left: 20, right: 40, top: 20, bottom: 40 });
  actions = new EventFieldActions({ features: { investigationWorkspace: false }, externalProviders: [] });
  actions.openMenu(anchor, "src.ip", "8.8.8.8", { uuid: "event", time: "2026-09-09T00:00:00Z" });
  const menu = actions.actionMenu;
  const button = [...menu.querySelectorAll("button")].find(item => item.textContent === "ThreatFox API");
  expect(sendMessage).not.toHaveBeenCalled();
  button.click();
  await vi.waitFor(() => { expect(menu.textContent).toContain("THREATFOX_REPORT_RESULT"); expect(button.disabled).toBe(false); });
  expect(sendMessage).toHaveBeenLastCalledWith({ type: "enrichment:ioc", provider: "threatfox", ioc: { type: "ip", value: "8.8.8.8" } });
  expect(actions.actionMenu).toBe(menu); expect(button.disabled).toBe(false);
  button.click();
  await vi.waitFor(() => expect(menu.textContent).toContain("provider unavailable"));
  expect(button.textContent).toBe("ThreatFox API"); expect(button.disabled).toBe(false);
  expect(actions.actionMenu).toBe(menu);
});
