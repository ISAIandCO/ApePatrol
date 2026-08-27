import { describe, expect, it } from "vitest";
import { getAssetContext, utcOffset } from "../src/siem/features/asset-enrichment.js";

describe("asset enrichment", () => {
  it("uses asset ID and handles an empty result", async () => {
    let query;
    const client = {
      getAssets: async (input) => { query = input; return { token: "t" }; },
      getAssetGridData: async () => ({ records: [] }),
    };
    expect(await getAssetContext(client, { assetId: "asset-1" })).toMatchObject({ found: false });
    expect(query.additionalFilterParameters.assetIds).toEqual(["asset-1"]);
  });
  it("escapes a host fallback and optionally discovers EDR", async () => {
    let query;
    const client = {
      getAssets: async (input) => { query = input; return { token: "t" }; },
      getAssetGridData: async () => ({ records: [{ description: "server", xdrAgentId: "agent" }] }),
      discoverEdrAgent: async () => ({ agent: true }),
    };
    const result = await getAssetContext(client, { assetName: "host'or", includeEdr: true });
    expect(query.pdql).toContain("host\\'or");
    expect(result.edr).toEqual({ agent: true });
    expect(utcOffset()).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});
