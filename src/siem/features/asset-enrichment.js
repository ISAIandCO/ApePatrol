import { escapePdqlString } from "../../shared/pdql/escape.js";

function utcOffset() {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export async function getAssetContext(client, { assetId, assetName, includeEdr = false, signal } = {}) {
  if (!assetId && !assetName) throw new Error("Current event has no asset identifier or host name");
  const request = {
    pdql: assetId
      ? "select(Host.@Description as description, Host.Softs<XDRAgent>.AgentID as xdrAgentId)"
      : `filter(Host[@Name = '${escapePdqlString(assetName)}']) | select(Host.@Description as description, Host.Softs<XDRAgent>.AgentID as xdrAgentId)`,
    additionalFilterParameters: assetId ? { assetIds: [assetId] } : {},
    includeNestedGroups: false,
    utcOffset: utcOffset(),
  };
  const tokenResponse = await client.getAssets(request, { signal });
  const token = tokenResponse?.token;
  if (typeof token !== "string" || !token) throw new Error("Asset API returned no query token");
  const data = await client.getAssetGridData(token, { signal, limit: 1 });
  const record = (Array.isArray(data?.records) ? data.records : [])[0];
  if (!record) return { found: false, description: null, xdrAgentId: null, edr: null };
  let edr = null;
  if (includeEdr && record.xdrAgentId) {
    try { edr = await client.discoverEdrAgent(record.xdrAgentId, { signal }); } catch { edr = null; }
  }
  return { found: true, description: record.description ?? null, xdrAgentId: record.xdrAgentId ?? null, edr };
}

export { utcOffset };
