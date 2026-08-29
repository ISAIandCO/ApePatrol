export const ERROR_CODES = Object.freeze({
  SIEM_NOT_CONNECTED: "SIEM_NOT_CONNECTED",
  SIEM_UNSUPPORTED_VERSION: "SIEM_UNSUPPORTED_VERSION",
  SIEM_PERMISSION_DENIED: "SIEM_PERMISSION_DENIED",
  SIEM_API_ERROR: "SIEM_API_ERROR",
  FEATURE_DISABLED: "FEATURE_DISABLED",
  PROVIDER_PERMISSION_REQUIRED: "PROVIDER_PERMISSION_REQUIRED",
  PROVIDER_RATE_LIMIT: "PROVIDER_RATE_LIMIT",
  PROVIDER_AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROCESS_LIMIT_REACHED: "PROCESS_LIMIT_REACHED",
  PROCESS_QUERY_ABORTED: "PROCESS_QUERY_ABORTED",
  GRAPH_SOURCE_TAB_CLOSED: "GRAPH_SOURCE_TAB_CLOSED",
  AI_PAYLOAD_TOO_LARGE: "AI_PAYLOAD_TOO_LARGE",
  AI_PERMISSION_REQUIRED: "AI_PERMISSION_REQUIRED",
  UNKNOWN: "UNKNOWN",
});

const KIND_CODES = Object.freeze({
  unauthorized: ERROR_CODES.SIEM_PERMISSION_DENIED,
  forbidden: ERROR_CODES.SIEM_PERMISSION_DENIED,
  unsupported: ERROR_CODES.SIEM_UNSUPPORTED_VERSION,
  http: ERROR_CODES.SIEM_API_ERROR,
  network: ERROR_CODES.SIEM_API_ERROR,
  timeout: ERROR_CODES.SIEM_API_ERROR,
  cancelled: ERROR_CODES.PROCESS_QUERY_ABORTED,
  "feature-unavailable": ERROR_CODES.FEATURE_DISABLED,
});

export class ApePatrolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ApePatrolError";
    this.code = ERROR_CODES[code] ?? code ?? ERROR_CODES.UNKNOWN;
    this.kind = details.kind;
    this.cause = details.cause;
  }
}

export function normalizeError(error, fallbackCode = ERROR_CODES.UNKNOWN) {
  const message = typeof error?.message === "string" && error.message ? error.message : "Unexpected ApePatrol error";
  const code = error?.code ?? KIND_CODES[error?.kind] ?? fallbackCode;
  return { code, message };
}
