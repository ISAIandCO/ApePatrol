import { proxySiemApiRequest, proxySiemMutationRequest } from "./siem-proxy.js";
import { loadTableLists, normalizeTableRow, parseProxyJson, tableToken } from "./table-list.js";

const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export async function setIocDescription(origin, message, settings, {
  requestRead = proxySiemApiRequest,
  requestMutation = proxySiemMutationRequest,
} = {}) {
  const requestedToken = String(message?.token ?? "");
  if (!TOKEN_PATTERN.test(requestedToken)) throw new TypeError("Invalid IOC Table List token");
  const description = String(message?.description ?? "").trim();
  const username = String(message?.username ?? "").trim();
  if (!description || description.length > 500) throw new TypeError("IOC description must contain 1–500 characters");
  if (!username || username.length > 200) throw new TypeError("Invalid analyst username");

  const lists = await loadTableLists(origin, requestRead);
  const configuredList = lists.find((item) => [item?.name, item?.displayName, item?.title].includes(settings.iocListName));
  const configuredToken = tableToken(configuredList);
  if (!configuredToken || configuredToken !== requestedToken) {
    throw new Error("The requested IOC Table List does not match the configured list");
  }

  const row = normalizeTableRow(message?.row);
  while (row.length < 3) row.push("");
  row[2] = `${description} (${username})`;
  const response = await requestMutation(origin, {
    path: `/api/whitelists/${encodeURIComponent(configuredToken)}/insert`,
    method: "POST",
    body: JSON.stringify(row),
  });
  return {
    table: String(configuredList.name ?? configuredList.displayName ?? configuredList.title ?? settings.iocListName),
    response: parseProxyJson(response, "IOC description insertion"),
  };
}
