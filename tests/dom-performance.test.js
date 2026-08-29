// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiemDomController } from "../src/siem/dom/controller.js";
import { getRootDiscoveryStats, resetRootDiscoveryStats, SiemDomAdapter } from "../src/siem/dom/r27_3.js";

afterEach(() => vi.useRealTimers());

describe("incremental DOM processing", () => {
  it("does not repeat a full deep-root scan for one field mutation", () => {
    document.body.replaceChildren();
    const card = document.createElement("article");
    card.className = "event-card";
    card.innerHTML = "<mc-dt>uuid</mc-dt><mc-dd>event-1</mc-dd>";
    document.body.append(card);
    const adapter = new SiemDomAdapter();
    resetRootDiscoveryStats();
    expect(adapter.extractEvent().uuid).toBe("event-1");
    const before = getRootDiscoveryStats();
    const label = document.createElement("mc-dt");
    label.textContent = "src.ip";
    const value = document.createElement("mc-dd");
    value.textContent = "8.8.8.8";
    card.append(label, value);
    adapter.refreshFieldRoots([{ target: card, addedNodes: [label, value], removedNodes: [] }]);
    expect(adapter.extractEvent()["src.ip"]).toBe("8.8.8.8");
    const after = getRootDiscoveryStats();
    expect(after.fullScans).toBe(before.fullScans);
    expect(after.incrementalScans).toBeGreaterThan(before.incrementalScans);
  });

  it("coalesces a 500-mutation storm into one extraction window", async () => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const adapter = {
      getRoot: () => document.body,
      getObservationRoots: () => [document.body],
      filterMutationRecords: (records) => records,
      refreshFieldRoots: vi.fn(),
      getEventUuid: () => "event-1",
      extractEvent: vi.fn(() => ({ uuid: "event-1" })),
    };
    const feature = { onDomChanged: vi.fn(), onEventChanged: vi.fn(), unmount: vi.fn() };
    const controller = new SiemDomController(adapter, [feature], { debounceMs: 100 });
    controller.start();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 500; index += 1) fragment.append(document.createElement("span"));
    document.body.append(fragment);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(101);
    expect(adapter.extractEvent).toHaveBeenCalledTimes(1);
    expect(feature.onDomChanged).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});
