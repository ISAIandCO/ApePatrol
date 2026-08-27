import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(full));
    else if (/\.(?:js|html)$/.test(entry.name)) output.push(full);
  }
  return output;
}

describe("security invariants", () => {
  it("does not use raw HTML sinks for LLM or event data", async () => {
    const files = await sourceFiles("src");
    for (const file of files) expect(await readFile(file, "utf8"), file).not.toMatch(/\.innerHTML\s*=|\.insertAdjacentHTML\s*\(|\.html\s*\(/);
  });
  it("does not expose settings or rely on Zone.js internals", async () => {
    const text = (await Promise.all((await sourceFiles("src")).map((file) => readFile(file, "utf8")))).join("\n");
    expect(text).not.toContain("globalMonkeyOptions");
    expect(text).not.toContain("__zone_symbol__xhrURL");
  });
  it("contains no remotely loaded script", async () => {
    const html = (await Promise.all((await sourceFiles("src/static")).filter((file) => file.endsWith(".html")).map((file) => readFile(file, "utf8")))).join("\n");
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
  });
});
