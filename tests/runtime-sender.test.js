import { describe, expect, it } from "vitest";
import { isExtensionPageSender } from "../src/shared/runtime-sender.js";

const extensionRoot = "moz-extension://f780e496-3121-44ec-b413-427ba8f91b82/";

describe("extension message sender validation", () => {
  it("accepts an options page opened in a Firefox tab", () => {
    expect(isExtensionPageSender({
      tab: { id: 7, url: `${extensionRoot}options.html` },
      url: `${extensionRoot}options.html`,
    }, extensionRoot)).toBe(true);
  });

  it("accepts other pages belonging to this extension", () => {
    expect(isExtensionPageSender({ url: `${extensionRoot}popup.html` }, extensionRoot)).toBe(true);
  });

  it("rejects content scripts even when they have a sender tab", () => {
    expect(isExtensionPageSender({
      tab: { id: 7, url: "https://192.168.1.1/" },
      url: "https://192.168.1.1/",
    }, extensionRoot)).toBe(false);
  });

  it("rejects another extension and malformed or missing URLs", () => {
    expect(isExtensionPageSender({ url: "moz-extension://another-uuid/options.html" }, extensionRoot)).toBe(false);
    expect(isExtensionPageSender({ url: "not a URL" }, extensionRoot)).toBe(false);
    expect(isExtensionPageSender({ tab: { id: 7 } }, extensionRoot)).toBe(false);
  });
});
