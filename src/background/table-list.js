import { proxySiemApiRequest, proxySiemMutationRequest } from "./siem-proxy.js";

const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_COLUMNS = 64;
const MAX_CELL_LENGTH = 4096;

export function parseProxyJson(response, operation) {
  if (response.status < 200 || response.status >= 300) throw new Error(`${operation} failed with HTTP ${response.status}`);
  if (!response.bodyText) return null;
  if (!response.contentType.includes("json")) throw new Error(`${operation} returned a non-JSON response`);
  try {
    return JSON.parse(response.bodyText);
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

export function tableItems(value) {
  if (Array.isArray(value)) return value;
  return value?.items ?? value?.lists ?? [];
}

export function normalizeTableRow(row) {
  if (!Array.isArray(row) || row.length < 1 || row.length > MAX_COLUMNS) {
    throw new TypeError("Table List row has an invalid number of columns");
  }
  return row.map((cell) => {
    if (cell === null || typeof cell === "boolean" || typeof cell === "number") return cell;
    if (typeof cell !== "string") throw new TypeError("Table List cells must be scalar values");
    if (cell.length > MAX_CELL_LENGTH) throw new TypeError("Table List cell is too long");
    return cell;
  });
}

export function tableToken(table) {
  const value = table?.token ?? table?.id;
  return value === undefined || value === null ? null : String(value);
}

export async function loadTableLists(origin, request = proxySiemApiRequest) {
  const response = await request(origin, { path: "/api/events/v2/table_lists", method: "GET" });
  return tableItems(parseProxyJson(response, "Table List discovery"));
}

export async function applyTableListMutation(origin, message, {
  requestRead = proxySiemApiRequest,
  requestMutation = proxySiemMutationRequest,
} = {}) {
  if (message?.confirmed !== true) throw new Error("Explicit confirmation is required");
  const operation = message?.operation;
  if (!["add", "remove"].includes(operation)) throw new TypeError("Unsupported Table List operation");
  const requestedToken = String(message?.token ?? "");
  if (!TOKEN_PATTERN.test(requestedToken)) throw new TypeError("Invalid Table List token");
  const row = normalizeTableRow(message?.row);
  const lists = await loadTableLists(origin, requestRead);
  const table = lists.find((item) => tableToken(item) === requestedToken);
  if (!table) throw new Error("The requested Table List is not available on this SIEM instance");
  const response = await requestMutation(origin, {
    path: `/api/whitelists/${encodeURIComponent(requestedToken)}/${operation === "add" ? "insert" : "remove"}`,
    method: "POST",
    body: JSON.stringify(row),
  });
  return {
    table: String(table.name ?? table.displayName ?? table.title ?? requestedToken),
    response: parseProxyJson(response, "Table List mutation"),
  };
}
