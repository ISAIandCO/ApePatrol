// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { filterPdqlCompletions, pdqlCompletionRange, PdqlAutocompleteFeature } from "../src/siem/features/pdql-autocomplete.js";

describe("PDQL autocomplete", () => {
  it("finds the token immediately before the caret", () => {
    expect(pdqlCompletionRange("event_src.ho and src.ip", 12)).toEqual({ start: 0, end: 12, token: "event_src.ho" });
    expect(pdqlCompletionRange("src.ip !", 8)).toEqual({ start: 7, end: 8, token: "!" });
    expect(pdqlCompletionRange("src.ip = ", 9)).toBeNull();
  });

  it("deduplicates and prefix-filters taxonomy fields and operators", () => {
    expect(filterPdqlCompletions(["src.ip", "src.port", "src.ip", "subject.name"], "src.")).toEqual(["src.ip", "src.port"]);
    expect(filterPdqlCompletions(["in", "in_subnet", "contains"], "in")).toEqual(["in", "in_subnet"]);
  });

  it("binds the legacy editor and inserts a selected taxonomy field", async () => {
    document.body.innerHTML = '<textarea id="pdqlFilterText"></textarea>';
    const editor = document.querySelector("textarea");
    const feature = new PdqlAutocompleteFeature({ getEventMetadata: vi.fn().mockResolvedValue({ fields: [{ name: "event_src.host", filterable: true }] }) });
    feature.onDomChanged({ adapter: { getFilterEditor: () => editor } });
    editor.focus();
    editor.value = "event_s";
    editor.setSelectionRange(7, 7);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector("[role='option']")?.textContent).toBe("event_src.host"));
    document.querySelector("[role='option']").click();
    expect(editor.value).toBe("event_src.host");
    feature.unmount();
    expect(document.querySelector("[data-apepatrol-ui='pdql-autocomplete']")).toBeNull();
  });

  it("retries taxonomy loading after a transient metadata failure", async () => {
    document.body.innerHTML = '<textarea id="pdqlFilterText"></textarea>';
    const editor = document.querySelector("textarea");
    const getEventMetadata = vi.fn()
      .mockRejectedValueOnce(new Error("SIEM is still loading"))
      .mockResolvedValue({ fields: [{ name: "event_src.host", filterable: true }] });
    const feature = new PdqlAutocompleteFeature({ getEventMetadata });
    feature.onDomChanged({ adapter: { getFilterEditor: () => editor } });
    await vi.waitFor(() => expect(feature.loadPromise).toBeNull());
    editor.focus();
    editor.value = "event_s";
    editor.setSelectionRange(7, 7);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector("[role='option']")?.textContent).toBe("event_src.host"));
    expect(getEventMetadata).toHaveBeenCalledTimes(2);
    feature.unmount();
  });
});
