import { describe, expect, it, vi } from "vitest";
import {
  deduplicateProcessEvents,
  expansionRanges,
  fetchProcessPages,
  mergeLoadedRanges,
  seedProcessRange,
} from "../src/siem/process/progressive.js";

describe("progressive process queries", () => {
  it("starts from a bounded seed range and expands in explicit directions", () => {
    const seed = seedProcessRange("2026-01-01T12:00:00Z", 900);
    expect(Date.parse(seed.timeTo) - Date.parse(seed.timeFrom)).toBe(30 * 60_000);
    expect(expansionRanges(seed, "parents", 3600)).toEqual([{ timeFrom: "2026-01-01T10:45:00.000Z", timeTo: "2026-01-01T11:45:00.000Z" }]);
    expect(expansionRanges(seed, "both", 3600)).toHaveLength(2);
  });

  it("deduplicates events and merges adjacent loaded ranges", () => {
    const first = { uuid: "a", time: "2026-01-01T00:00:00Z" };
    const replacement = { uuid: "a", time: "2026-01-01T00:00:00Z", msgid: 1 };
    expect(deduplicateProcessEvents([first], [replacement, { uuid: "b", time: "2026-01-01T01:00:00Z" }])).toEqual([replacement, expect.objectContaining({ uuid: "b" })]);
    expect(mergeLoadedRanges([{ from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" }], [{ timeFrom: "2026-01-01T01:00:00Z", timeTo: "2026-01-01T02:00:00Z" }]))
      .toEqual([{ from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T02:00:00.000Z" }]);
  });

  it("pages with offsets until the provider returns a short page", async () => {
    const events = Array.from({ length: 230 }, (_, index) => ({ uuid: String(index), time: new Date(index * 1000).toISOString() }));
    const client = { searchEvents: vi.fn(({ offset, limit }) => events.slice(offset, offset + limit)) };
    const result = await fetchProcessPages(client, { where: "x", select: ["uuid"] }, { pageSize: 100, maxEvents: 500 });
    expect(result.events).toHaveLength(230);
    expect(result.pages).toBe(3);
    expect(result.nextOffset).toBe(230);
    expect(client.searchEvents.mock.calls.map(([call]) => call.offset)).toEqual([0, 100, 200]);
    expect(result.exhausted).toBe(true);
  });

  it("honours cancellation before making a request", async () => {
    const controller = new AbortController(); controller.abort(new Error("stop"));
    const client = { searchEvents: vi.fn() };
    await expect(fetchProcessPages(client, {}, { signal: controller.signal })).rejects.toThrow("stop");
    expect(client.searchEvents).not.toHaveBeenCalled();
  });

  it("continues past an overlapping page while keeping a finite page budget", async () => {
    const first = Array.from({ length: 25 }, (_, index) => ({ uuid: `first-${index}` }));
    const last = [{ uuid: "last" }];
    const client = { searchEvents: vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(last) };
    const result = await fetchProcessPages(client, {}, { pageSize: 25, maxEvents: 100 });
    expect(result.events).toHaveLength(26);
    expect(result.pages).toBe(3);
    expect(result.exhausted).toBe(true);
  });

  it("resumes pagination at an explicit cursor", async () => {
    const client = { searchEvents: vi.fn().mockResolvedValue([{ uuid: "next" }]) };
    const result = await fetchProcessPages(client, {}, { pageSize: 25, maxEvents: 50, startOffset: 250 });
    expect(client.searchEvents).toHaveBeenCalledWith(expect.objectContaining({ offset: 250 }));
    expect(result.nextOffset).toBe(251);
  });
});
