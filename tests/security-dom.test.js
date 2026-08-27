// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { setSafeText } from "../src/shared/dom.js";

describe("untrusted UI output", () => {
  it.each([
    ["LLM", "<img src=x onerror=alert(1)><script>alert(1)</script>"],
    ["event", "<svg onload=alert(1)>"],
  ])("renders malicious %s content as inert text", (_source, payload) => {
    const output = document.createElement("div");
    setSafeText(output, payload);
    expect(output.textContent).toBe(payload);
    expect(output.querySelector("script, img, svg")).toBeNull();
  });
});
