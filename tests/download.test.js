import { describe, expect, it, vi } from "vitest";
import { downloadText } from "../src/shared/download.js";

describe("text downloads", () => {
  it("uses an extension-owned blob URL instead of a blocked data URL", async () => {
    vi.useFakeTimers();
    const downloads = { download: vi.fn().mockResolvedValue(7) };
    const urlApi = { createObjectURL: vi.fn().mockReturnValue("blob:extension/export"), revokeObjectURL: vi.fn() };
    await expect(downloadText("# Report", { filename: "report.md", mime: "text/markdown" }, downloads, urlApi)).resolves.toBe(7);
    expect(downloads.download).toHaveBeenCalledWith({ url: "blob:extension/export", filename: "report.md", saveAs: true });
    expect(downloads.download.mock.calls[0][0].url).not.toMatch(/^data:/);
    vi.runAllTimers();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:extension/export");
    vi.useRealTimers();
  });
});
