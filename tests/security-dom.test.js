// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { setSafeText } from "../src/shared/dom.js";
import { renderMarkdown } from "../src/shared/markdown.js";

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

describe("AI Markdown", () => {
  it("renders common Markdown blocks without turning raw HTML into DOM", () => {
    const output = document.createElement("div");
    renderMarkdown(output, "# Result\n\n- **safe** item\n- `code`\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n<script>alert(1)</script>");
    expect(output.querySelector("h1")?.textContent).toBe("Result");
    expect(output.querySelectorAll("li")).toHaveLength(2);
    expect(output.querySelector("strong")?.textContent).toBe("safe");
    expect(output.querySelector("table td")?.textContent).toBe("A");
    expect(output.querySelector("script")).toBeNull();
    expect(output.textContent).toContain("<script>alert(1)</script>");
  });

  it("allows only HTTP(S) Markdown links and never embeds remote images", () => {
    const output = document.createElement("div");
    renderMarkdown(output, "[safe](https://example.com) [bad](javascript:alert) ![tracker](https://example.com/pixel.png)");
    expect([...output.querySelectorAll("a")].map((link) => link.href)).toEqual(["https://example.com/", "https://example.com/pixel.png"]);
    expect(output.querySelector("img")).toBeNull();
    expect(output.textContent).toContain("bad");
  });
});
