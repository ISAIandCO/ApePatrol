const REDACTED_KEYS = /authorization|api.?key|password|token|cookie|secret/i;

function redact(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? "[redacted]" : redact(item, seen)]));
}

export function createLogger(enabled = false) {
  return {
    debug(message, details) {
      if (enabled) console.debug(`[ApePatrol] ${message}`, details === undefined ? "" : redact(details));
    },
    warn(message) {
      console.warn(`[ApePatrol] ${message}`);
    },
  };
}
