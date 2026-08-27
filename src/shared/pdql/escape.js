export function escapePdqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function validatePdqlField(field) {
  if (typeof field !== "string" || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(field)) {
    throw new TypeError(`Invalid PDQL field: ${String(field)}`);
  }
  return field;
}

export function formatPdqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("PDQL numeric value must be finite");
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatPdqlValue).join(", ")}]`;
  return `'${escapePdqlString(value)}'`;
}
