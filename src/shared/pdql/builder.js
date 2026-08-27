import { formatPdqlValue, validatePdqlField } from "./escape.js";

export function buildEqualityPredicate(field, value) {
  return `${validatePdqlField(field)} = ${formatPdqlValue(value)}`;
}

export function buildInPredicate(field, values) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError("PDQL IN requires values");
  return `${validatePdqlField(field)} in ${formatPdqlValue(values)}`;
}

export function andPredicates(...predicates) {
  const valid = predicates.flat().filter((value) => typeof value === "string" && value.trim());
  if (!valid.length) return "";
  return valid.map((value) => `(${value})`).join(" and ");
}

export function orPredicates(...predicates) {
  const valid = predicates.flat().filter((value) => typeof value === "string" && value.trim());
  if (!valid.length) return "";
  return valid.map((value) => `(${value})`).join(" or ");
}
